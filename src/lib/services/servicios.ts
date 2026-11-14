import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol, type Rol } from "../permisos";
import { ErrorNegocio, hoy as hoyLima, inicioDiaLima, MEDIOS, r2, sumarDias } from "../util";
import { montoOCero, texto } from "../validacion";
import { datosEmpresa } from "../empresa";

const { servicio, atencionServicio, cliente, producto, lote, sesionCaja, movimientoCaja, usuario, auditoria } = schema;

export const TIPOS_SERVICIO = ["PRESION", "GLUCOSA", "INYECTABLE", "TEMPERATURA", "ANTROPOMETRIA", "OTRO"] as const;
export const VIAS = { IM: "Intramuscular", SC: "Subcutánea", ID: "Intradérmica", IV: "Intravenosa" } as const;
type Via = keyof typeof VIAS;

const TODOS_VENDEN: Rol[] = ["ADMIN", "QF", "CAJERO", "VENDEDOR"];
const PROFESIONAL: Rol[] = ["ADMIN", "QF"];

/**
 * Catálogo inicial. Buenas prácticas: lo no invasivo (presión, temperatura, peso y talla) lo puede hacer el personal de atención;
 * lo invasivo (glucosa capilar e inyectables) solo el químico farmacéutico o el administrador, con receta y consentimiento
 * para inyectables. La vía intravenosa exige un profesional de salud y que la botica esté autorizada para ese servicio.
 */
const CATALOGO_INICIAL = [
  { codigo: "PA", nombre: "Toma de presión arterial", tipo: "PRESION", precio: 0, roles: TODOS_VENDEN, descripcion: "Con 5 minutos de reposo, sentado y con el brazo a la altura del corazón." },
  { codigo: "GLU", nombre: "Glucosa capilar", tipo: "GLUCOSA", precio: 5, roles: PROFESIONAL, descripcion: "Punción en la yema del dedo con lanceta descartable." },
  { codigo: "TEMP", nombre: "Control de temperatura", tipo: "TEMPERATURA", precio: 0, roles: TODOS_VENDEN },
  { codigo: "IMC", nombre: "Peso, talla e índice de masa corporal", tipo: "ANTROPOMETRIA", precio: 0, roles: TODOS_VENDEN },
  { codigo: "INY-IM", nombre: "Inyectable intramuscular", tipo: "INYECTABLE", via: "IM", precio: 3, roles: PROFESIONAL, requiereReceta: true, requiereConsentimiento: true },
  { codigo: "INY-SC", nombre: "Inyectable subcutáneo", tipo: "INYECTABLE", via: "SC", precio: 3, roles: PROFESIONAL, requiereReceta: true, requiereConsentimiento: true },
  { codigo: "INY-ID", nombre: "Inyectable intradérmico", tipo: "INYECTABLE", via: "ID", precio: 3, roles: PROFESIONAL, requiereReceta: true, requiereConsentimiento: true },
  { codigo: "INY-IV", nombre: "Inyectable intravenoso", tipo: "INYECTABLE", via: "IV", precio: 10, roles: PROFESIONAL, requiereReceta: true, requiereConsentimiento: true, descripcion: "Solo si la botica está autorizada y lo aplica un profesional de salud." },
] as const;

/** Carga el catálogo inicial si aún no hay servicios (idempotente). */
export async function asegurarCatalogo(db: Db) {
  const [n] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(servicio);
  if ((n?.n ?? 0) > 0) return;
  await db.insert(servicio).values(CATALOGO_INICIAL.map((s, i) => ({
    codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, via: "via" in s ? s.via : null, precio: s.precio, roles: [...s.roles],
    requiereReceta: "requiereReceta" in s ? s.requiereReceta : false, requiereConsentimiento: "requiereConsentimiento" in s ? s.requiereConsentimiento : false,
    descripcion: "descripcion" in s ? s.descripcion : null, orden: i,
  }))).onConflictDoNothing();
}

export async function listarServicios(db: Db, user: Sesion, todos = false) {
  await asegurarCatalogo(db);
  const rows = await db.select().from(servicio).where(todos ? undefined : eq(servicio.activo, true)).orderBy(asc(servicio.orden), asc(servicio.id));
  return rows.map((s) => ({ ...s, puedoRealizar: tieneRol(user.roles, ...(s.roles as Rol[])) }));
}

export const esquemaServicio = z.object({
  nombre: texto(3).max(80),
  descripcion: z.string().trim().max(250).nullable().optional(),
  precio: montoOCero,
  precioExterno: montoOCero.nullable().optional(),
  roles: z.array(z.enum(["ADMIN", "QF", "CAJERO", "VENDEDOR"])).min(1, "elige al menos un perfil"),
  requiereReceta: z.boolean(),
  requiereConsentimiento: z.boolean(),
  activo: z.boolean(),
});

/** El administrador ajusta precio, perfiles y requisitos; los invasivos nunca bajan de químico farmacéutico. */
export async function editarServicio(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaServicio>) {
  if (!user.roles.includes("ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "Solo el administrador edita el catálogo de servicios.", 403);
  const [s] = await db.select().from(servicio).where(eq(servicio.id, id));
  if (!s) throw new ErrorNegocio("NO_EXISTE", "El servicio no existe.", 404);
  const invasivo = s.tipo === "INYECTABLE" || s.tipo === "GLUCOSA";
  if (invasivo && input.roles.some((r) => r === "CAJERO" || r === "VENDEDOR"))
    throw new ErrorNegocio("BUENAS_PRACTICAS", "Los procedimientos invasivos (inyectables y glucosa) solo los realiza el químico farmacéutico o el administrador.", 422);
  if (s.tipo === "INYECTABLE" && (!input.requiereReceta || !input.requiereConsentimiento))
    throw new ErrorNegocio("BUENAS_PRACTICAS", "Los inyectables siempre requieren receta médica y consentimiento del paciente.", 422);
  await db.update(servicio).set({ ...input, descripcion: input.descripcion || null, precioExterno: s.tipo === "INYECTABLE" ? input.precioExterno ?? null : null }).where(eq(servicio.id, id));
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "EDITAR_SERVICIO", entidad: "servicio", entidadId: id, detalle: input });
  return { id };
}

// ── Clasificación de resultados (referencial; no reemplaza la consulta médica) ──────────────────────────────

/** Presión arterial según la guía AHA/ACC 2017 (mmHg). */
export function clasificarPresion(sis: number, dia: number) {
  if (sis > 180 || dia > 120) return { clasificacion: "Crisis hipertensiva", derivar: true, urgente: true };
  if (sis < 90 || dia < 60) return { clasificacion: "Presión baja", derivar: true, urgente: false };
  if (sis >= 140 || dia >= 90) return { clasificacion: "Hipertensión estadio 2", derivar: true, urgente: false };
  if (sis >= 130 || dia >= 80) return { clasificacion: "Hipertensión estadio 1", derivar: true, urgente: false };
  if (sis >= 120) return { clasificacion: "Presión elevada", derivar: false, urgente: false };
  return { clasificacion: "Normal", derivar: false, urgente: false };
}

/** Glucosa capilar (mg/dL) según la condición de la toma (criterios ADA). */
export function clasificarGlucosa(valor: number, condicion: "AYUNAS" | "POSTPRANDIAL" | "ALEATORIA") {
  if (valor < 70) return { clasificacion: "Hipoglucemia", derivar: true, urgente: valor < 54 };
  if (condicion === "AYUNAS") {
    if (valor >= 126) return { clasificacion: "Elevada (posible diabetes)", derivar: true, urgente: valor >= 250 };
    if (valor >= 100) return { clasificacion: "Alterada en ayunas", derivar: true, urgente: false };
    return { clasificacion: "Normal", derivar: false, urgente: false };
  }
  if (valor >= 200) return { clasificacion: "Elevada (posible diabetes)", derivar: true, urgente: valor >= 300 };
  if (valor >= 140) return { clasificacion: "Alterada", derivar: true, urgente: false };
  return { clasificacion: "Normal", derivar: false, urgente: false };
}

export function clasificarTemperatura(t: number) {
  if (t >= 39.5) return { clasificacion: "Fiebre alta", derivar: true, urgente: true };
  if (t >= 38) return { clasificacion: "Fiebre", derivar: true, urgente: false };
  if (t >= 37.5) return { clasificacion: "Febrícula", derivar: false, urgente: false };
  if (t < 35) return { clasificacion: "Hipotermia", derivar: true, urgente: true };
  return { clasificacion: "Normal", derivar: false, urgente: false };
}

export function clasificarImc(peso: number, tallaCm: number) {
  const imc = Math.round((peso / (tallaCm / 100) ** 2) * 10) / 10;
  const clasificacion = imc < 18.5 ? "Bajo peso" : imc < 25 ? "Normal" : imc < 30 ? "Sobrepeso" : imc < 35 ? "Obesidad grado I" : imc < 40 ? "Obesidad grado II" : "Obesidad grado III";
  return { imc, clasificacion, derivar: imc < 18.5 || imc >= 30, urgente: false };
}

// ── Registro de atenciones ───────────────────────────────────────────────────────────────────────────────

const num = (min: number, max: number, nombre: string) => z.number({ invalid_type_error: `escribe ${nombre}`, required_error: `escribe ${nombre}` }).min(min, `${nombre}: mínimo ${min}`).max(max, `${nombre}: máximo ${max}`);
const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha no válida");

export const esquemaAtencion = z.object({
  servicioId: z.number().int(),
  paciente: z.object({
    doc: z.string().trim().regex(/^(\d{8}|[A-Z0-9]{9,12})$/i, "DNI de 8 dígitos o carné de extranjería").optional().or(z.literal("")),
    nombre: texto(3, "escribe el nombre del paciente").max(120),
    edad: z.number().int().min(0).max(120).optional(),
    sexo: z.enum(["F", "M"]).optional(),
    telefono: z.string().trim().max(20).optional(),
  }),
  presion: z.object({ sistolica: num(50, 300, "la sistólica"), diastolica: num(30, 200, "la diastólica"), pulso: num(30, 220, "el pulso").optional(), brazo: z.enum(["IZQUIERDO", "DERECHO"]), reposo: z.literal(true, { errorMap: () => ({ message: "confirma que el paciente reposó 5 minutos antes de la toma" }) }) }).optional(),
  glucosa: z.object({ valor: num(20, 600, "el valor"), condicion: z.enum(["AYUNAS", "POSTPRANDIAL", "ALEATORIA"]) }).optional(),
  temperatura: z.object({ valor: num(30, 44, "la temperatura"), zona: z.enum(["AXILAR", "ORAL", "TIMPANICA", "FRONTAL"]) }).optional(),
  antropometria: z.object({ peso: num(1, 350, "el peso"), talla: num(40, 230, "la talla") }).optional(),
  inyectable: z.object({
    origen: z.enum(["INTERNO", "EXTERNO"]),
    loteId: z.number().int().optional(), // INTERNO: lote de la botica
    producto: z.string().trim().max(120).optional(), // EXTERNO: lo que trae el paciente
    lote: z.string().trim().max(40).optional(),
    vencimiento: fechaISO.optional(),
    dosis: texto(1, "escribe la dosis").max(60),
    sitio: texto(2, "indica el sitio de aplicación").max(60),
    receta: z.object({ medico: texto(3, "escribe el nombre del médico"), cmp: z.string().trim().regex(/^\d{3,6}$/, "CMP de 3 a 6 dígitos"), fecha: fechaISO }),
    verificaciones: z.object({
      pacienteCorrecto: z.boolean(), medicamentoCorrecto: z.boolean(), dosisCorrecta: z.boolean(), viaCorrecta: z.boolean(), horaCorrecta: z.boolean(),
      alergiasConsultadas: z.boolean(), observacionPosterior: z.boolean(),
    }),
    consentimiento: z.boolean(),
    reaccionAdversa: z.string().trim().max(250).optional(),
  }).optional(),
  observacion: z.string().trim().max(500).optional(),
  medioPago: z.enum(MEDIOS).default("EFECTIVO"),
  sinCosto: z.boolean().default(false), // cortesía: solo administrador o QF
  cobradoEnVenta: z.boolean().default(false), // ya se cobró como línea de una venta en Vender: aquí solo queda el registro clínico
});

const referencia = (id: number) => `SRV-${String(id).padStart(6, "0")}`;

/**
 * Registra la atención aplicando las reglas del servicio. Si tiene precio, se cobra en la caja abierta de quien atiende
 * (ingreso «Servicio farmacéutico»), así entra al cierre como cualquier otro cobro.
 */
export async function registrarAtencion(db: Db, user: Sesion, input: z.infer<typeof esquemaAtencion>) {
  const [s] = await db.select().from(servicio).where(eq(servicio.id, input.servicioId));
  if (!s || !s.activo) throw new ErrorNegocio("NO_EXISTE", "El servicio no existe o está inactivo.", 404);
  if (!tieneRol(user.roles, ...(s.roles as Rol[]))) throw new ErrorNegocio("SIN_PERMISO", `${s.nombre} lo realiza solo: ${s.roles.join(", ").toLowerCase()}.`, 403);
  const hoy = hoyLima();
  let resultados: Record<string, number | string | boolean | null> = {};
  let c: { clasificacion: string; derivar: boolean; urgente: boolean } | null = null;
  const datosInyectable: Partial<typeof atencionServicio.$inferInsert> = {};

  if (s.tipo === "PRESION") {
    if (!input.presion) throw new ErrorNegocio("DATOS", "Escribe la presión sistólica y diastólica.");
    const p = input.presion;
    if (p.diastolica >= p.sistolica) throw new ErrorNegocio("DATOS", "La diastólica debe ser menor que la sistólica. Revisa la toma.");
    c = clasificarPresion(p.sistolica, p.diastolica);
    resultados = { sistolica: p.sistolica, diastolica: p.diastolica, pulso: p.pulso ?? null, brazo: p.brazo };
  } else if (s.tipo === "GLUCOSA") {
    if (!input.glucosa) throw new ErrorNegocio("DATOS", "Escribe el valor de glucosa.");
    c = clasificarGlucosa(input.glucosa.valor, input.glucosa.condicion);
    resultados = { valor: input.glucosa.valor, condicion: input.glucosa.condicion };
  } else if (s.tipo === "TEMPERATURA") {
    if (!input.temperatura) throw new ErrorNegocio("DATOS", "Escribe la temperatura.");
    c = clasificarTemperatura(input.temperatura.valor);
    resultados = { valor: input.temperatura.valor, zona: input.temperatura.zona };
  } else if (s.tipo === "ANTROPOMETRIA") {
    if (!input.antropometria) throw new ErrorNegocio("DATOS", "Escribe el peso y la talla.");
    const r = clasificarImc(input.antropometria.peso, input.antropometria.talla);
    c = r;
    resultados = { peso: input.antropometria.peso, talla: input.antropometria.talla, imc: r.imc };
  } else if (s.tipo === "INYECTABLE") {
    const i = input.inyectable;
    if (!i) throw new ErrorNegocio("DATOS", "Completa los datos del inyectable.");
    // Buenas prácticas de administración: receta vigente, los 5 correctos, alergias, consentimiento y observación posterior.
    if (s.requiereReceta && i.receta.fecha > hoy) throw new ErrorNegocio("RECETA", "La fecha de la receta no puede ser futura.");
    if (s.requiereReceta && i.receta.fecha < sumarDias(hoy, -30)) throw new ErrorNegocio("RECETA", "La receta tiene más de 30 días: pide una receta vigente.");
    const v = i.verificaciones;
    const faltan = [!v.pacienteCorrecto && "paciente", !v.medicamentoCorrecto && "medicamento", !v.dosisCorrecta && "dosis", !v.viaCorrecta && "vía", !v.horaCorrecta && "hora"].filter(Boolean);
    if (faltan.length) throw new ErrorNegocio("CINCO_CORRECTOS", `Verifica los 5 correctos antes de aplicar: falta ${faltan.join(", ")}.`, 422);
    if (!v.alergiasConsultadas) throw new ErrorNegocio("ALERGIAS", "Pregunta al paciente si tiene alergias antes de aplicar.", 422);
    if (s.requiereConsentimiento && !i.consentimiento) throw new ErrorNegocio("CONSENTIMIENTO", "Falta el consentimiento del paciente (o de su apoderado).", 422);
    if (!v.observacionPosterior) throw new ErrorNegocio("OBSERVACION", "Observa al paciente al menos 15 minutos después de la aplicación y confírmalo.", 422);
    if (s.via === "IV" && !tieneRol(user.roles, "QF", "ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "La vía intravenosa la aplica solo un profesional de salud.", 403);
    if (i.origen === "INTERNO") {
      if (!i.loteId) throw new ErrorNegocio("LOTE", "Elige el producto y el lote de la botica que se aplicó.");
      const [l] = await db.select({ l: lote, nombre: producto.nombre }).from(lote).innerJoin(producto, eq(producto.id, lote.productoId)).where(eq(lote.id, i.loteId));
      if (!l) throw new ErrorNegocio("LOTE", "El lote no existe.", 404);
      if (l.l.vencimiento <= hoy || l.l.estado !== "ACTIVO") throw new ErrorNegocio("VENCIDO", `El lote ${l.l.numero} está vencido o bloqueado: no se puede aplicar.`, 422);
      Object.assign(datosInyectable, { productoId: l.l.productoId, loteId: l.l.id, productoTexto: l.nombre, loteTexto: l.l.numero, vencimientoProducto: l.l.vencimiento });
    } else {
      if (!i.producto || i.producto.length < 3) throw new ErrorNegocio("PRODUCTO", "Escribe el medicamento que trae el paciente.");
      if (!i.lote) throw new ErrorNegocio("LOTE", "Anota el lote del medicamento que trae el paciente.");
      if (!i.vencimiento) throw new ErrorNegocio("VENCIDO", "Anota la fecha de vencimiento del medicamento que trae el paciente.");
      if (i.vencimiento <= hoy) throw new ErrorNegocio("VENCIDO", "El medicamento que trae el paciente está vencido: no se aplica.", 422);
      Object.assign(datosInyectable, { productoTexto: i.producto, loteTexto: i.lote, vencimientoProducto: i.vencimiento });
    }
    Object.assign(datosInyectable, {
      productoOrigen: i.origen, dosis: i.dosis, sitioAplicacion: i.sitio, receta: i.receta, consentimiento: i.consentimiento,
      verificaciones: v, reaccionAdversa: i.reaccionAdversa || null,
    });
    resultados = { via: s.via ?? null };
    // Una reacción adversa se deriva y se notifica (farmacovigilancia).
    c = i.reaccionAdversa ? { clasificacion: "Reacción adversa registrada", derivar: true, urgente: true } : { clasificacion: "Aplicado sin incidencias", derivar: false, urgente: false };
  }

  const sinCosto = input.sinCosto && tieneRol(user.roles, "ADMIN", "QF");
  // El inyectable con medicamento que trae el paciente puede tener otro precio.
  const base = s.tipo === "INYECTABLE" && input.inyectable?.origen === "EXTERNO" && s.precioExterno != null ? s.precioExterno : s.precio;
  const precio = sinCosto || input.cobradoEnVenta ? 0 : r2(base);
  return db.transaction(async (tx) => {
    let sesionId: number | null = null;
    if (precio > 0) {
      const [ses] = await tx.select({ id: sesionCaja.id }).from(sesionCaja).where(and(eq(sesionCaja.usuarioId, user.id), eq(sesionCaja.estado, "ABIERTA"))).orderBy(desc(sesionCaja.id)).limit(1);
      if (!ses) throw new ErrorNegocio("SIN_CAJA", `Abre tu caja para cobrar ${s.nombre} (S/ ${precio.toFixed(2)}).`);
      sesionId = ses.id;
    }
    let clienteId: number | null = null;
    const doc = input.paciente.doc?.trim();
    if (doc) {
      const [cl] = await tx.insert(cliente).values({ tipoDoc: /^\d{8}$/.test(doc) ? "DNI" : "CE", numero: doc, nombre: input.paciente.nombre, telefono: input.paciente.telefono || null })
        .onConflictDoUpdate({ target: cliente.numero, set: { nombre: input.paciente.nombre, ...(input.paciente.telefono ? { telefono: input.paciente.telefono } : {}) } }).returning({ id: cliente.id });
      clienteId = cl.id;
    }
    const [a] = await tx.insert(atencionServicio).values({
      servicioId: s.id, usuarioId: user.id, clienteId, pacienteDoc: doc || null, pacienteNombre: input.paciente.nombre, pacienteEdad: input.paciente.edad ?? null, pacienteSexo: input.paciente.sexo ?? null,
      resultados, clasificacion: c?.clasificacion ?? null, derivar: c?.derivar ?? false, observacion: input.observacion || null,
      precio, medioPago: precio > 0 ? input.medioPago : null, sesionId, cobradoEnVenta: input.cobradoEnVenta, ...datosInyectable,
    }).returning();
    if (precio > 0) {
      const [m] = await tx.insert(movimientoCaja).values({ sesionId: sesionId!, usuarioId: user.id, tipo: "INGRESO", concepto: "Servicio farmacéutico", medio: input.medioPago, monto: precio, comprobante: `${referencia(a.id)} · ${s.nombre}` }).returning({ id: movimientoCaja.id });
      await tx.update(atencionServicio).set({ movimientoCajaId: m.id }).where(eq(atencionServicio.id, a.id));
    }
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "REGISTRAR_ATENCION", entidad: "atencion_servicio", entidadId: a.id, detalle: { servicio: s.codigo, precio, sinCosto, cobradoEnVenta: input.cobradoEnVenta, derivar: c?.derivar ?? false } });
    return { id: a.id, referencia: referencia(a.id), servicio: s.nombre, clasificacion: c?.clasificacion ?? null, derivar: c?.derivar ?? false, urgente: c?.urgente ?? false, precio, resultados };
  });
}

export const esquemaAnulacionAtencion = z.object({ motivo: texto(5, "escribe el motivo (mínimo 5 caracteres)").max(250) });

/** Anula una atención mal registrada; si se cobró, el ingreso sale de la caja mientras siga abierta. */
export async function anularAtencion(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaAnulacionAtencion>) {
  const [a] = await db.select().from(atencionServicio).where(eq(atencionServicio.id, id));
  if (!a || a.estado === "ANULADA") throw new ErrorNegocio("NO_EXISTE", "La atención no existe o ya fue anulada.", 404);
  if (a.usuarioId !== user.id && !tieneRol(user.roles, "ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "Solo quien la registró o el administrador la anula.", 403);
  return db.transaction(async (tx) => {
    if (a.movimientoCajaId) {
      const [s] = a.sesionId ? await tx.select({ estado: sesionCaja.estado }).from(sesionCaja).where(eq(sesionCaja.id, a.sesionId)) : [];
      if (s?.estado !== "ABIERTA") throw new ErrorNegocio("CAJA_CERRADA", "La caja de ese cobro ya se cerró: regulariza la diferencia en el cierre y anula sin devolver el dinero.", 409);
      const [m] = await tx.select().from(movimientoCaja).where(eq(movimientoCaja.id, a.movimientoCajaId));
      if (m) {
        await tx.delete(movimientoCaja).where(eq(movimientoCaja.id, m.id));
        await tx.insert(auditoria).values({ usuarioId: user.id, accion: "ELIMINAR_MOVIMIENTO_CAJA", entidad: "movimiento_caja", entidadId: m.id, detalle: { sesionId: m.sesionId, tipo: m.tipo, concepto: m.concepto, medio: m.medio, monto: m.monto, comprobante: m.comprobante, registradoPor: m.usuarioId, registradoEn: m.fecha, motivo: `Anulación de ${referencia(a.id)}: ${input.motivo}` } });
      }
    }
    await tx.update(atencionServicio).set({ estado: "ANULADA", anuladaPor: user.id, motivoAnulacion: input.motivo }).where(eq(atencionServicio.id, id));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "ANULAR_ATENCION", entidad: "atencion_servicio", entidadId: id, detalle: { motivo: input.motivo } });
    return { id, estado: "ANULADA" };
  });
}

/** Historial de atenciones con filtros; quien no es administrador ni QF ve las que realizó. */
export async function listarAtenciones(db: Db, user: Sesion, q: { desde?: string; hasta?: string; buscar?: string; servicioId?: number; derivar?: boolean }) {
  const hoy = hoyLima();
  const desde = q.desde ?? sumarDias(hoy, -30);
  const hasta = q.hasta ?? hoy;
  const cond = [gte(atencionServicio.fecha, inicioDiaLima(desde)), lt(atencionServicio.fecha, inicioDiaLima(sumarDias(hasta, 1)))];
  if (!tieneRol(user.roles, "ADMIN", "QF", "CONTADOR")) cond.push(eq(atencionServicio.usuarioId, user.id));
  if (q.servicioId) cond.push(eq(atencionServicio.servicioId, q.servicioId));
  if (q.derivar) cond.push(eq(atencionServicio.derivar, true));
  if (q.buscar?.trim()) { const t = `%${q.buscar.trim()}%`; cond.push(or(ilike(atencionServicio.pacienteNombre, t), ilike(atencionServicio.pacienteDoc, t))!); }
  const rows = await db.select({ a: atencionServicio, servicio: servicio.nombre, tipo: servicio.tipo, via: servicio.via, atendio: usuario.nombre })
    .from(atencionServicio).innerJoin(servicio, eq(servicio.id, atencionServicio.servicioId)).innerJoin(usuario, eq(usuario.id, atencionServicio.usuarioId))
    .where(and(...cond)).orderBy(desc(atencionServicio.fecha)).limit(300);
  return rows.map(({ a, ...r }) => ({ ...a, ...r, referencia: referencia(a.id) }));
}

/** Historial clínico breve de un paciente por su documento (p. ej. las últimas tomas de presión). */
export async function historialPaciente(db: Db, doc: string) {
  const rows = await db.select({ a: atencionServicio, servicio: servicio.nombre, tipo: servicio.tipo })
    .from(atencionServicio).innerJoin(servicio, eq(servicio.id, atencionServicio.servicioId))
    .where(and(eq(atencionServicio.pacienteDoc, doc), eq(atencionServicio.estado, "REGISTRADA"))).orderBy(desc(atencionServicio.fecha)).limit(20);
  const [cl] = await db.select().from(cliente).where(eq(cliente.numero, doc));
  return { paciente: cl ?? null, atenciones: rows.map(({ a, ...r }) => ({ id: a.id, referencia: referencia(a.id), fecha: a.fecha, ...r, resultados: a.resultados, clasificacion: a.clasificacion, derivar: a.derivar })) };
}

export async function detalleAtencion(db: Db, user: Sesion, id: number) {
  const [r] = await db.select({ a: atencionServicio, servicio: servicio.nombre, tipo: servicio.tipo, via: servicio.via, atendio: usuario.nombre })
    .from(atencionServicio).innerJoin(servicio, eq(servicio.id, atencionServicio.servicioId)).innerJoin(usuario, eq(usuario.id, atencionServicio.usuarioId)).where(eq(atencionServicio.id, id));
  if (!r) throw new ErrorNegocio("NO_EXISTE", "La atención no existe.", 404);
  if (!tieneRol(user.roles, "ADMIN", "QF", "CONTADOR") && r.a.usuarioId !== user.id) throw new ErrorNegocio("SIN_PERMISO", "Solo puedes ver las atenciones que realizaste.", 403);
  return { ...r.a, servicio: r.servicio, tipo: r.tipo, via: r.via, viaNombre: r.via ? VIAS[r.via as Via] : null, atendio: r.atendio, referencia: referencia(r.a.id), empresa: datosEmpresa() };
}
