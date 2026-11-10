import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { monto, montoOCero, texto } from "../validacion";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol, verCostos } from "../permisos";
import { ErrorNegocio, MEDIOS, r2, type Medio } from "../util";
import { filas } from "../sqlrows";
import { parametros } from "./parametros";
import { anularVenta, esquemaVenta, registrarVenta } from "./ventas";

const { caja, sesionCaja, movimientoCaja, venta, ventaPago, usuario, cliente, comision, auditoria, regularizacionCierre } = schema;

export const CONCEPTOS_CAJA = {
  INGRESO: ["Sencillo para vuelto", "Reposición de efectivo", "Otro ingreso"],
  EGRESO: ["Pago menor a proveedor", "Limpieza y mantenimiento", "Movilidad", "Útiles de oficina", "Otro egreso"],
} as const;

// Un cierre con observaciones (EN_CIERRE) ya entregó el dinero: no bloquea la caja para el siguiente turno.
const ABIERTAS = ["ABIERTA"];

export async function sesionDelUsuario(db: Db, usuarioId: number) {
  const [s] = await db.select().from(sesionCaja)
    .where(and(eq(sesionCaja.usuarioId, usuarioId), inArray(sesionCaja.estado, ABIERTAS)))
    .orderBy(desc(sesionCaja.id)).limit(1);
  return s ?? null;
}

export async function estadoCaja(db: Db, user: Sesion) {
  const sesion = await sesionDelUsuario(db, user.id);
  const cajas = await db.select().from(caja).orderBy(caja.nombre);
  const principal = await cajaPrincipal(db);
  const [ocupada] = await db.select({ usuario: usuario.nombre }).from(sesionCaja).innerJoin(usuario, eq(usuario.id, sesionCaja.usuarioId))
    .where(and(eq(sesionCaja.cajaId, principal.id), inArray(sesionCaja.estado, ABIERTAS)));
  let resumen = null;
  if (sesion) {
    const [v] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(venta)
      .where(and(eq(venta.sesionId, sesion.id), eq(venta.estado, "EMITIDA")));
    const movimientos = await db.select().from(movimientoCaja).where(eq(movimientoCaja.sesionId, sesion.id)).orderBy(desc(movimientoCaja.id));
    const porMedio = await db.select({ medio: ventaPago.medio, total: sql<number>`coalesce(sum(${ventaPago.monto}),0)`.mapWith(Number) })
      .from(ventaPago).innerJoin(venta, eq(venta.id, ventaPago.ventaId))
      .where(and(eq(venta.sesionId, sesion.id), eq(venta.estado, "EMITIDA"))).groupBy(ventaPago.medio);
    const [an] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(venta)
      .where(and(eq(venta.sesionId, sesion.id), eq(venta.estado, "ANULADA")));
    const ventas = MEDIOS.map((m) => ({ medio: m, total: r2(porMedio.find((p) => p.medio === m)?.total ?? 0) }));
    resumen = {
      tickets: v?.n ?? 0, movimientos, ventas, totalVentas: r2(ventas.reduce((a, x) => a + x.total, 0)), anuladas: an?.n ?? 0,
      esperado: await calcularEsperado(db, sesion.id),
      virtuales: await pagosVirtuales(db, sesion.id),
    };
  }
  const porAprobar = await db.select({ id: sesionCaja.id, cerradaEn: sesionCaja.cerradaEn, diferencia: sesionCaja.diferencia }).from(sesionCaja)
    .where(and(eq(sesionCaja.usuarioId, user.id), eq(sesionCaja.estado, "EN_CIERRE"))).orderBy(desc(sesionCaja.id)).limit(5);
  return { porAprobar, sesion: sesion ? { id: sesion.id, cajaId: sesion.cajaId, turno: sesion.turno, abiertaEn: sesion.abiertaEn, estado: sesion.estado, montoApertura: sesion.fondoInicial, caja: cajas.find((c) => c.id === sesion.cajaId)?.nombre } : null, caja: { nombre: principal.nombre, ocupadaPor: ocupada?.usuario ?? null }, resumen, conceptos: CONCEPTOS_CAJA };
}

/** La botica trabaja con una sola caja: la primera registrada (se crea si no existe). */
async function cajaPrincipal(db: Db) {
  const [c] = await db.select().from(caja).orderBy(caja.id).limit(1);
  if (c) return c;
  const [nueva] = await db.insert(caja).values({ nombre: "CAJA 01" }).onConflictDoNothing().returning();
  return nueva ?? (await db.select().from(caja).orderBy(caja.id).limit(1))[0];
}

/** Abrir caja: turno y el efectivo con que se empieza, digitado como un solo monto. */
export const esquemaApertura = z.object({
  turno: z.enum(["MAÑANA", "TARDE", "NOCHE", "COMPLETO"]),
  monto: montoOCero,
  observacion: z.string().trim().max(250).optional(),
});

export async function abrirCaja(db: Db, user: Sesion, input: z.infer<typeof esquemaApertura>) {
  const principal = await cajaPrincipal(db);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from caja where id = ${principal.id} for update`);
    if (await sesionDelUsuario(tx, user.id)) throw new ErrorNegocio("YA_TIENE_CAJA", "Ya tienes la caja abierta.");
    const [ocupada] = await tx.select({ usuario: usuario.nombre }).from(sesionCaja).innerJoin(usuario, eq(usuario.id, sesionCaja.usuarioId))
      .where(and(eq(sesionCaja.cajaId, principal.id), inArray(sesionCaja.estado, ABIERTAS)));
    if (ocupada) throw new ErrorNegocio("CAJA_OCUPADA", `La caja está abierta por ${ocupada.usuario}. Debe cerrarla antes de que abras tu turno.`, 409);
    const [s] = await tx.insert(sesionCaja).values({
      cajaId: principal.id, usuarioId: user.id, turno: input.turno, fondoInicial: r2(input.monto), conteoApertura: null,
      observacionApertura: input.observacion || null, estado: "ABIERTA",
    }).returning();
    return s;
  });
}

export const esquemaMovimiento = z.object({
  tipo: z.enum(["INGRESO", "EGRESO"]),
  concepto: texto(3),
  medio: z.enum(MEDIOS).default("EFECTIVO"),
  monto,
  comprobante: z.string().optional(),
});

export async function registrarMovimiento(db: Db, user: Sesion, input: z.infer<typeof esquemaMovimiento>) {
  const s = await sesionDelUsuario(db, user.id);
  if (!s || s.estado !== "ABIERTA") throw new ErrorNegocio("SIN_CAJA", "Abre tu caja para registrar movimientos.");
  const permitidos = CONCEPTOS_CAJA[input.tipo] as readonly string[];
  if (!permitidos.includes(input.concepto)) throw new ErrorNegocio("CONCEPTO_INVALIDO", "Elige un concepto de la lista.");
  const [m] = await db.insert(movimientoCaja).values({ sesionId: s.id, usuarioId: user.id, ...input, monto: r2(input.monto), comprobante: input.comprobante ?? null }).returning();
  return m;
}

export const esquemaEliminacion = z.object({ motivo: z.string().trim().min(5, "escribe por qué lo eliminas (mínimo 5 caracteres)") });

/** Quita un ingreso o egreso registrado por error. Solo con la caja abierta, con motivo, y queda en la auditoría. */
export async function eliminarMovimiento(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaEliminacion>) {
  const [m] = await db.select().from(movimientoCaja).where(eq(movimientoCaja.id, id));
  if (!m) throw new ErrorNegocio("NO_EXISTE", "El movimiento ya no existe.", 404);
  const [s] = await db.select().from(sesionCaja).where(eq(sesionCaja.id, m.sesionId));
  if (!s || s.estado !== "ABIERTA") throw new ErrorNegocio("CAJA_CERRADA", "Solo se pueden eliminar movimientos mientras la caja está abierta.");
  if (s.usuarioId !== user.id && !user.roles.includes("ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "Solo puedes eliminar movimientos de tu propia caja.", 403);
  await db.transaction(async (tx) => {
    await tx.delete(movimientoCaja).where(eq(movimientoCaja.id, id));
    await tx.insert(auditoria).values({
      usuarioId: user.id, accion: "ELIMINAR_MOVIMIENTO_CAJA", entidad: "movimiento_caja", entidadId: id,
      detalle: { sesionId: m.sesionId, tipo: m.tipo, concepto: m.concepto, medio: m.medio, monto: m.monto, comprobante: m.comprobante, registradoPor: m.usuarioId, registradoEn: m.fecha, motivo: input.motivo },
    });
  });
  return { id, eliminado: true };
}

type FilaEliminacion = { id: number; fecha: string; eliminado_por: string; eliminado_por_id: number; detalle: Record<string, unknown>; sesion_id: number | null; caja: string | null; cajero: string | null; cajero_id: number | null; estado: string | null };

function mapearEliminacion(r: FilaEliminacion) {
  const d = r.detalle ?? {};
  return {
    id: r.id, fecha: r.fecha, eliminadoPor: r.eliminado_por, sesionId: r.sesion_id, caja: r.caja, cajero: r.cajero, estadoSesion: r.estado,
    porOtraPersona: r.cajero_id !== null && Number(r.eliminado_por_id) !== Number(r.cajero_id),
    tipo: String(d.tipo ?? ""), concepto: String(d.concepto ?? ""), medio: String(d.medio ?? ""), monto: Number(d.monto ?? 0),
    comprobante: (d.comprobante as string | null) ?? null, motivo: (d.motivo as string | undefined) ?? null, registradoEn: (d.registradoEn as string | undefined) ?? null,
  };
}

const consultaEliminaciones = (condicion: ReturnType<typeof sql>) => sql`
  select a.id, a.fecha, u.nombre as eliminado_por, a.usuario_id as eliminado_por_id, a.detalle,
    s.id as sesion_id, c.nombre as caja, uc.nombre as cajero, s.usuario_id as cajero_id, s.estado
  from auditoria a
  join usuario u on u.id = a.usuario_id
  left join sesion_caja s on s.id = (a.detalle->>'sesionId')::int
  left join caja c on c.id = s.caja_id
  left join usuario uc on uc.id = s.usuario_id
  where a.accion = 'ELIMINAR_MOVIMIENTO_CAJA' and ${condicion}
  order by a.id desc limit 500`;

/** Registro de todos los ingresos y egresos eliminados de las cajas, para revisión del administrador y el contador. */
export async function listarEliminaciones(db: Db, dias = 30) {
  const rows = await filas<FilaEliminacion>(db, consultaEliminaciones(sql`a.fecha >= now() - make_interval(days => ${dias})`));
  return rows.map(mapearEliminacion);
}

export async function calcularEsperado(db: Db, sesionId: number): Promise<Record<Medio, number>> {
  const [s] = await db.select().from(sesionCaja).where(eq(sesionCaja.id, sesionId));
  if (!s) throw new ErrorNegocio("NO_EXISTE", "La sesión de caja no existe.", 404);
  const esperado = Object.fromEntries(MEDIOS.map((m) => [m, 0])) as Record<Medio, number>;
  esperado.EFECTIVO = s.fondoInicial;
  const pagos = await db.select({ medio: ventaPago.medio, total: sql<number>`coalesce(sum(${ventaPago.monto}),0)`.mapWith(Number) })
    .from(ventaPago).innerJoin(venta, eq(venta.id, ventaPago.ventaId))
    .where(and(eq(venta.sesionId, sesionId), eq(venta.estado, "EMITIDA"))).groupBy(ventaPago.medio);
  for (const p of pagos) esperado[p.medio as Medio] += p.total;
  const movs = await db.select({ tipo: movimientoCaja.tipo, medio: movimientoCaja.medio, total: sql<number>`coalesce(sum(${movimientoCaja.monto}),0)`.mapWith(Number) })
    .from(movimientoCaja).where(and(eq(movimientoCaja.sesionId, sesionId), isNull(movimientoCaja.ventaId))).groupBy(movimientoCaja.tipo, movimientoCaja.medio);
  for (const m of movs) esperado[m.medio as Medio] += m.tipo === "INGRESO" ? m.total : -m.total;
  for (const k of MEDIOS) esperado[k] = r2(esperado[k]);
  return esperado;
}

/** Cada cobro que no es en efectivo (ventas e ingresos manuales), para que el cajero confirme que llegó. */
export async function pagosVirtuales(db: Db, sesionId: number) {
  const ventas = await db.select({ id: ventaPago.id, ventaId: ventaPago.ventaId, medio: ventaPago.medio, monto: ventaPago.monto, serie: venta.serie, numero: venta.numero, fecha: venta.fecha })
    .from(ventaPago).innerJoin(venta, eq(venta.id, ventaPago.ventaId))
    .where(and(eq(venta.sesionId, sesionId), eq(venta.estado, "EMITIDA"), ne(ventaPago.medio, "EFECTIVO"))).orderBy(venta.fecha, ventaPago.id);
  const ingresos = await db.select().from(movimientoCaja)
    .where(and(eq(movimientoCaja.sesionId, sesionId), eq(movimientoCaja.tipo, "INGRESO"), ne(movimientoCaja.medio, "EFECTIVO"), isNull(movimientoCaja.ventaId))).orderBy(movimientoCaja.fecha);
  return [
    ...ventas.map((v) => ({ clave: `V${v.id}`, ventaId: v.ventaId as number | null, origen: "Venta", referencia: `${v.serie}-${v.numero}`, medio: v.medio as Medio, monto: r2(v.monto), fecha: v.fecha })),
    ...ingresos.map((m) => ({ clave: `M${m.id}`, ventaId: null as number | null, origen: "Ingreso", referencia: m.comprobante || m.concepto, medio: m.medio as Medio, monto: r2(m.monto), fecha: m.fecha })),
  ].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha));
}

const sumaVirtual = (x: Record<string, number> | null | undefined) => r2(MEDIOS.filter((m) => m !== "EFECTIVO").reduce((a, m) => a + (x?.[m] ?? 0), 0));

/**
 * Cierre declarado: el cajero escribe el efectivo que tiene. Los pagos virtuales (Yape, Plin, tarjeta, transferencia)
 * se dan por conformes; solo marca los que no cuadran y escribe el monto que realmente se registró en la app o el voucher.
 */
export const esquemaCierre = z.object({
  efectivo: montoOCero,
  /** Solo los pagos virtuales que no cuadran: monto realmente registrado (0 si no llegó), por su clave (V… venta, M… ingreso). */
  noCuadran: z.record(z.string().max(20), montoOCero).default({}),
  observacion: z.string().trim().max(250).optional(),
});


export async function cerrarCaja(db: Db, user: Sesion, input: z.input<typeof esquemaCierre>) {
  const s = await sesionDelUsuario(db, user.id);
  if (!s) throw new ErrorNegocio("SIN_CAJA", "No tienes una caja abierta.");
  const esperado = await calcularEsperado(db, s.id);
  const virtuales = await pagosVirtuales(db, s.id);
  // Lo no marcado llegó completo; lo marcado, por el monto que escribió el cajero.
  const recibidos: Record<string, number> = Object.fromEntries(virtuales.map((v) => [v.clave, v.monto]));
  for (const [c, m] of Object.entries(input.noCuadran ?? {})) if (c in recibidos) recibidos[c] = r2(m);
  const pendientes = virtuales.filter((v) => Math.abs(recibidos[v.clave] - v.monto) >= 0.005);
  const contado = { ...esperado, EFECTIVO: r2(input.efectivo) };
  // Lo virtual parte del sistema y se ajusta por lo que llegó con otro monto (los egresos virtuales ya están en el sistema).
  for (const v of pendientes) contado[v.medio] = r2(contado[v.medio] + recibidos[v.clave] - v.monto);
  const diferencia = r2(MEDIOS.reduce((a, m) => a + contado[m] - esperado[m], 0));
  const { umbral_diferencia_caja: umbral } = await parametros(db);
  const obs = observacionesCierre({ diferencia, umbral, pendientes, recibidos });
  // Con observaciones el cierre espera la aprobación del administrador: diferencia total sobre la tolerancia
  // o algún pago virtual que no cuadra (a favor o en contra); el administrador puede regularizarlos.
  const requiereValidacion = obs.length > 0;
  const estado = requiereValidacion ? "EN_CIERRE" : "CERRADA";
  await db.update(sesionCaja).set({
    conteoCierre: null, contado, contadoDeclarado: contado, esperado, diferencia, fondoSiguiente: null, retiro: contado.EFECTIVO,
    pagosNoConfirmados: pendientes.map((p) => p.clave), pagosRecibidos: recibidos,
    observacion: input.observacion || null, estado, cerradaEn: new Date(), validadoPor: null,
  }).where(eq(sesionCaja.id, s.id));
  return {
    sesionId: s.id, estado, requiereValidacion, diferencia, observaciones: obs,
    efectivo: { sistema: esperado.EFECTIVO, declarado: contado.EFECTIVO },
    virtual: { sistema: sumaVirtual(esperado), declarado: sumaVirtual(contado), noCuadran: pendientes.length },
  };
}

const NOMBRE_MEDIO: Record<Medio, string> = { EFECTIVO: "Efectivo", YAPE: "Yape", PLIN: "Plin", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };
const soles2 = (n: number) => `S/ ${Math.abs(n).toFixed(2)}`;

/** Por qué un cierre necesita la aprobación del administrador, en palabras del día a día. */
function observacionesCierre({ diferencia, umbral, pendientes, recibidos }: {
  diferencia: number; umbral: number; pendientes: { clave: string; referencia: string; medio: Medio; monto: number }[]; recibidos: Record<string, number> | null;
}) {
  const o: string[] = [];
  if (Math.abs(diferencia) > umbral + 0.004) o.push(`${diferencia < 0 ? "Faltante" : "Sobrante"} de ${soles2(diferencia)} (tolerancia ${soles2(umbral)})`);
  for (const v of pendientes) {
    const r = recibidos?.[v.clave] ?? 0;
    const d = r2(r - v.monto);
    o.push(r < 0.005
      ? `${v.referencia} · ${NOMBRE_MEDIO[v.medio]}: no llegó (${soles2(v.monto)})`
      : `${v.referencia} · ${NOMBRE_MEDIO[v.medio]}: se registró ${soles2(r)} de ${soles2(v.monto)} (${d < 0 ? "faltan" : "sobran"} ${soles2(d)})`);
  }
  return o;
}

export const esquemaValidacion = z.object({
  sesionId: z.number().int(), login: z.string().optional(), password: z.string().optional(),
  observacion: z.string().trim().min(10, "detalla la observación (mínimo 10 caracteres): qué pasó y qué se hizo"),
});

/**
 * El administrador aprueba un cierre con observaciones detallando qué pasó; recién ahí la caja queda cerrada.
 * Si el administrador cerró su propia caja, se aprueba a sí mismo y queda registrado en la auditoría.
 */
export async function validarCierre(db: Db, user: Sesion, input: z.infer<typeof esquemaValidacion>) {
  const [s] = await db.select().from(sesionCaja).where(eq(sesionCaja.id, input.sesionId));
  if (!s || s.estado !== "EN_CIERRE") throw new ErrorNegocio("NO_PENDIENTE", "Este cierre no espera aprobación.");
  let validador = user.roles.includes("ADMIN") ? user.id : null;
  if (!validador) {
    if (!input.login || !input.password) throw new ErrorNegocio("CREDENCIALES", "Solo el administrador aprueba un cierre con observaciones.", 403);
    const [a] = await db.select().from(usuario).where(and(eq(usuario.login, input.login), eq(usuario.activo, true)));
    if (!a || !a.roles.includes("ADMIN") || !(await bcrypt.compare(input.password, a.passwordHash))) throw new ErrorNegocio("CREDENCIALES", "Usuario o clave de administrador incorrectos.", 401);
    validador = a.id;
  }
  await db.update(sesionCaja).set({ estado: "CERRADA", validadoPor: validador, validadoEn: new Date(), observacionValidacion: input.observacion }).where(eq(sesionCaja.id, s.id));
  await db.insert(auditoria).values({ usuarioId: validador, accion: "VALIDAR_CIERRE", entidad: "sesion_caja", entidadId: s.id, detalle: { diferencia: s.diferencia, pendientes: s.pagosNoConfirmados ?? [], observacion: input.observacion, autoaprobado: validador === s.usuarioId } });
  return { sesionId: s.id, estado: "CERRADA" };
}

/**
 * Vuelve a calcular el cierre tras regularizar. Parte de lo que el cajero declaró y suma lo que el administrador
 * verificó después (pagos que sí llegaron, ingresos convertidos en venta, pagos que en realidad fueron por otro medio virtual).
 * Los cierres anteriores a la declaración virtual usan lo confirmado por el cajero.
 */
async function recalcularCierre(tx: Db, sesionId: number, resuelta?: string) {
  const [s] = await tx.select().from(sesionCaja).where(eq(sesionCaja.id, sesionId));
  const esperado = await calcularEsperado(tx, sesionId);
  const quedan = new Set((s.pagosNoConfirmados ?? []).filter((c) => c !== resuelta));
  const pendientes = (await pagosVirtuales(tx, sesionId)).filter((v) => quedan.has(v.clave));
  let contado: Record<Medio, number>;
  const regs = await tx.select().from(regularizacionCierre).where(eq(regularizacionCierre.sesionId, sesionId));
  if (s.contadoDeclarado) {
    contado = Object.fromEntries(MEDIOS.map((m) => [m, r2(s.contadoDeclarado?.[m] ?? 0)])) as Record<Medio, number>;
    for (const g of regs) {
      const verificado = g.accion === "CONFIRMADO" || g.accion === "CONVERTIDO_EN_VENTA" || (g.accion === "CAMBIO_MEDIO" && g.medio !== "EFECTIVO");
      // Se suma lo que faltaba respecto a lo que el cajero ya registró de ese pago.
      if (verificado && g.medio) contado[g.medio as Medio] = r2(contado[g.medio as Medio] + g.monto - (s.pagosRecibidos?.[g.clave] ?? 0));
    }
  } else {
    contado = { ...esperado };
    for (const p of pendientes) contado[p.medio] = r2(contado[p.medio] - p.monto);
  }
  // El efectivo parte de lo que el cajero declaró al cerrar (retiro) y suma lo que el administrador regularizó después.
  contado.EFECTIVO = r2((s.retiro ?? s.contado?.EFECTIVO ?? 0) + efectoEnEfectivo(regs));
  const diferencia = r2(MEDIOS.reduce((a, m) => a + contado[m] - esperado[m], 0));
  await tx.update(sesionCaja).set({ contado, esperado, diferencia, pagosNoConfirmados: pendientes.map((p) => p.clave) }).where(eq(sesionCaja.id, sesionId));
  return { diferencia, pendientes: pendientes.length };
}

type FilaRegularizacion = { accion: string; monto: number };
/** Cuánto cambia el efectivo contado: el dinero repuesto entra, el sobrante devuelto sale y el recuento corrige. */
const efectoEnEfectivo = (regs: FilaRegularizacion[]) =>
  r2(regs.reduce((a, g) => a + (g.accion === "REPOSICION" || g.accion === "AJUSTE_CONTEO" ? g.monto : g.accion === "SOBRANTE_DEVUELTO" ? -g.monto : 0), 0));
/** Lo que queda resuelto sin mover el efectivo: el faltante que asume el cajero y el sobrante que queda para la botica. */
const resueltoSinMover = (regs: FilaRegularizacion[]) =>
  r2(regs.reduce((a, g) => a + (g.accion === "CARGO_CAJERO" ? g.monto : g.accion === "SOBRANTE_INGRESO" ? -g.monto : 0), 0));

/** Estado del efectivo de un cierre: negativo = faltante por regularizar; positivo = sobrante por regularizar. */
function efectivoDelCierre(s: { esperado: Record<string, number> | null; contado: Record<string, number> | null; retiro: number | null }, regs: FilaRegularizacion[]) {
  const sistema = r2(s.esperado?.EFECTIVO ?? 0);
  const contado = r2(s.contado?.EFECTIVO ?? 0);
  const diferencia = r2(contado - sistema);
  return { sistema, declarado: r2(s.retiro ?? contado), contado, diferencia, porRegularizar: r2(diferencia + resueltoSinMover(regs)) };
}

export const esquemaRegularizacionEfectivo = z.discriminatedUnion("accion", [
  // El cajero (u otra persona) completó después el dinero que faltaba.
  z.object({ accion: z.literal("REPOSICION"), monto, comentario: texto(5) }),
  // El faltante no se recupera: queda como cargo (deuda) a nombre del cajero.
  z.object({ accion: z.literal("CARGO_CAJERO"), monto, comentario: texto(5) }),
  // Sobró efectivo: se devolvió al cliente (p. ej. vuelto de menos) o queda como ingreso de la botica.
  z.object({ accion: z.literal("SOBRANTE_DEVUELTO"), monto, comentario: texto(5) }),
  z.object({ accion: z.literal("SOBRANTE_INGRESO"), monto, comentario: texto(5) }),
  // El cajero contó mal: el administrador recuenta y escribe el efectivo real.
  z.object({ accion: z.literal("AJUSTE_CONTEO"), efectivoContado: montoOCero, comentario: texto(5) }),
]);

/** El administrador regulariza la diferencia de efectivo de un cierre; el cierre se recalcula. */
export async function regularizarEfectivo(db: Db, user: Sesion, sesionId: number, input: z.infer<typeof esquemaRegularizacionEfectivo>) {
  if (!user.roles.includes("ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "Solo el administrador regulariza el efectivo del cierre.", 403);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from sesion_caja where id = ${sesionId} for update`);
    const [s] = await tx.select().from(sesionCaja).where(eq(sesionCaja.id, sesionId));
    if (!s) throw new ErrorNegocio("NO_EXISTE", "La sesión de caja no existe.", 404);
    if (s.estado === "ABIERTA") throw new ErrorNegocio("ABIERTA", "Se regulariza después del cierre de caja.");
    const regs = await tx.select().from(regularizacionCierre).where(eq(regularizacionCierre.sesionId, sesionId));
    const ef = efectivoDelCierre(s, regs);
    let monto: number;
    if (input.accion === "AJUSTE_CONTEO") {
      monto = r2(input.efectivoContado - ef.contado);
      if (Math.abs(monto) < 0.005) throw new ErrorNegocio("SIN_CAMBIO", "El recuento es igual al efectivo contado.");
    } else {
      monto = r2(input.monto);
      const faltante = -ef.porRegularizar, sobrante = ef.porRegularizar;
      if (input.accion === "REPOSICION" || input.accion === "CARGO_CAJERO") {
        if (faltante < 0.005) throw new ErrorNegocio("SIN_FALTANTE", "Este cierre no tiene faltante de efectivo por regularizar.");
        if (monto > faltante + 0.005) throw new ErrorNegocio("MONTO_MAYOR", `El faltante por regularizar es S/ ${faltante.toFixed(2)}.`, 422);
      } else {
        if (sobrante < 0.005) throw new ErrorNegocio("SIN_SOBRANTE", "Este cierre no tiene sobrante de efectivo por regularizar.");
        if (monto > sobrante + 0.005) throw new ErrorNegocio("MONTO_MAYOR", `El sobrante por regularizar es S/ ${sobrante.toFixed(2)}.`, 422);
      }
    }
    const cargo = input.accion === "CARGO_CAJERO";
    const [reg] = await tx.insert(regularizacionCierre).values({
      sesionId, clave: "EFECTIVO", origen: "Efectivo", accion: input.accion, medio: "EFECTIVO", monto, comentario: input.comentario, usuarioId: user.id,
      ...(cargo ? { cargoUsuarioId: s.usuarioId, cargoEstado: "PENDIENTE" } : {}),
    }).returning();
    const r = await recalcularCierre(tx, sesionId);
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "REGULARIZAR_EFECTIVO", entidad: "sesion_caja", entidadId: sesionId, detalle: { regularizacionId: reg.id, accion: input.accion, monto, comentario: input.comentario } });
    const [fin] = await tx.select().from(sesionCaja).where(eq(sesionCaja.id, sesionId));
    return { id: reg.id, accion: reg.accion, monto, ...r, efectivo: efectivoDelCierre(fin, [...regs, reg]) };
  });
}

/** Cargos por faltantes de efectivo: el administrador y el contador ven todos; cada cajero, los suyos. */
export async function listarCargos(db: Db, user: Sesion, estado?: "PENDIENTE" | "PAGADO") {
  const todos = tieneRol(user.roles, "ADMIN", "CONTADOR");
  const rows = await filas<{ id: number; sesion_id: number; monto: string; comentario: string | null; fecha: string; cajero: string; cajero_id: number; estado: string; pagado_en: string | null; pagado_por: string | null; registrado_por: string }>(db, sql`
    select g.id, g.sesion_id, g.monto, g.comentario, g.fecha, uc.nombre as cajero, uc.id as cajero_id, g.cargo_estado as estado, g.cargo_pagado_en as pagado_en, up.nombre as pagado_por, ur.nombre as registrado_por
    from regularizacion_cierre g
    join usuario uc on uc.id = g.cargo_usuario_id
    join usuario ur on ur.id = g.usuario_id
    left join usuario up on up.id = g.cargo_pagado_por
    where g.accion = 'CARGO_CAJERO' ${todos ? sql`` : sql`and g.cargo_usuario_id = ${user.id}`} ${estado ? sql`and g.cargo_estado = ${estado}` : sql``}
    order by g.cargo_estado desc, g.id desc limit 300`);
  return rows.map((r) => ({ id: r.id, sesionId: r.sesion_id, monto: Number(r.monto), comentario: r.comentario, fecha: r.fecha, cajero: r.cajero, cajeroId: r.cajero_id, estado: r.estado, pagadoEn: r.pagado_en, pagadoPor: r.pagado_por, registradoPor: r.registrado_por }));
}

/** El cajero pagó su cargo: se marca como pagado (no cambia el cierre, que ya quedó regularizado con el cargo). */
export async function pagarCargo(db: Db, user: Sesion, id: number) {
  if (!user.roles.includes("ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "Solo el administrador registra el pago de un cargo.", 403);
  const [g] = await db.select().from(regularizacionCierre).where(eq(regularizacionCierre.id, id));
  if (!g || g.accion !== "CARGO_CAJERO") throw new ErrorNegocio("NO_EXISTE", "El cargo no existe.", 404);
  if (g.cargoEstado === "PAGADO") throw new ErrorNegocio("YA_PAGADO", "Ese cargo ya está pagado.");
  await db.update(regularizacionCierre).set({ cargoEstado: "PAGADO", cargoPagadoEn: new Date(), cargoPagadoPor: user.id }).where(eq(regularizacionCierre.id, id));
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "PAGAR_CARGO_CAJERO", entidad: "regularizacion_cierre", entidadId: id, detalle: { monto: g.monto, cajeroId: g.cargoUsuarioId, sesionId: g.sesionId } });
  return { id, estado: "PAGADO" };
}

const operacion = z.string().trim().max(40).optional();
export const esquemaRegularizacion = z.discriminatedUnion("accion", [
  // El pago sí llegó: se confirma con el número de operación.
  z.object({ accion: z.literal("CONFIRMAR"), clave: z.string(), operacion: z.string().trim().min(3, "escribe el n.º de operación o voucher").max(40), comentario: z.string().trim().max(250).optional() }),
  // El cliente pagó con otro medio (p. ej. en efectivo o por Plin en vez de Yape).
  z.object({ accion: z.literal("CAMBIAR_MEDIO"), clave: z.string(), medio: z.enum(MEDIOS), operacion, comentario: texto(5) }),
  // El dinero nunca llegó: se anula la venta y el stock vuelve a su lote.
  z.object({ accion: z.literal("ANULAR_VENTA"), clave: z.string(), comentario: texto(5) }),
  // Un ingreso que en realidad fue una venta: se registran los productos y el vendedor.
  z.object({
    accion: z.literal("CONVERTIR_EN_VENTA"), clave: z.string(), vendedorId: z.number().int(),
    tipoComprobante: esquemaVenta.shape.tipoComprobante, cliente: esquemaVenta.shape.cliente,
    items: esquemaVenta.shape.items, operacion, comentario: z.string().trim().max(250).optional(),
  }),
]);

const ROLES_VENDEN = ["CAJERO", "VENDEDOR", "QF", "ADMIN"] as const;

/** El administrador completa un pago virtual o ingreso que el cajero no confirmó al cerrar; el cierre se recalcula. */
export async function regularizarPago(db: Db, user: Sesion, sesionId: number, input: z.infer<typeof esquemaRegularizacion>) {
  if (!user.roles.includes("ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "Solo el administrador regulariza los pagos del cierre.", 403);
  return db.transaction(async (tx) => {
    const [s] = await filas<{ id: number; estado: string; pagos_no_confirmados: string[] | null }>(tx, sql`select id, estado, pagos_no_confirmados from sesion_caja where id = ${sesionId} for update`);
    if (!s) throw new ErrorNegocio("NO_EXISTE", "La sesión de caja no existe.", 404);
    if (s.estado === "ABIERTA") throw new ErrorNegocio("ABIERTA", "Se regulariza después del cierre de caja.");
    if (!(s.pagos_no_confirmados ?? []).includes(input.clave)) throw new ErrorNegocio("YA_REGULARIZADO", "Ese pago ya está confirmado o regularizado.");
    const item = (await pagosVirtuales(tx, sesionId)).find((v) => v.clave === input.clave);
    if (!item) throw new ErrorNegocio("NO_EXISTE", "Ese pago ya no está en el cierre.", 404);
    const id = Number(input.clave.slice(1));
    const esVenta = input.clave.startsWith("V");
    let ventaId: number | null = null;
    let medio = item.medio;

    if (input.accion === "CAMBIAR_MEDIO") {
      if (input.medio === item.medio) throw new ErrorNegocio("MISMO_MEDIO", "Elige un medio distinto al registrado.");
      medio = input.medio;
      if (esVenta) await tx.update(ventaPago).set({ medio: input.medio }).where(eq(ventaPago.id, id));
      else await tx.update(movimientoCaja).set({ medio: input.medio }).where(eq(movimientoCaja.id, id));
    } else if (input.accion === "ANULAR_VENTA") {
      if (!esVenta) throw new ErrorNegocio("NO_ES_VENTA", "Solo se anulan ventas; un ingreso que no llegó se deja como faltante o se convierte en venta.");
      const [vp] = await tx.select({ ventaId: ventaPago.ventaId }).from(ventaPago).where(eq(ventaPago.id, id));
      ventaId = vp.ventaId;
      await anularVenta(tx, user, ventaId, { motivo: `Regularización del cierre ${String(sesionId).padStart(6, "0")}: ${input.comentario}` });
    } else if (input.accion === "CONVERTIR_EN_VENTA") {
      if (esVenta) throw new ErrorNegocio("YA_ES_VENTA", "Ese pago ya pertenece a una venta.");
      const [mov] = await tx.select().from(movimientoCaja).where(eq(movimientoCaja.id, id));
      const [vend] = await tx.select({ id: usuario.id, roles: usuario.roles, activo: usuario.activo }).from(usuario).where(eq(usuario.id, input.vendedorId));
      if (!vend || !vend.roles.some((r) => (ROLES_VENDEN as readonly string[]).includes(r))) throw new ErrorNegocio("VENDEDOR", "Elige a la persona que hizo la venta.");
      const v = await registrarVenta(tx, {
        actor: user, vendedor: vend, sesionId, fecha: mov.fecha, totalObjetivo: mov.monto,
        input: { items: input.items, tipoComprobante: input.tipoComprobante, cliente: input.cliente, pagos: [{ medio: mov.medio, monto: mov.monto }] },
      });
      ventaId = v.id;
      await tx.update(movimientoCaja).set({ ventaId: v.id }).where(eq(movimientoCaja.id, id));
    }

    const [reg] = await tx.insert(regularizacionCierre).values({
      sesionId, clave: input.clave, origen: item.origen, accion: input.accion === "CONFIRMAR" ? "CONFIRMADO" : input.accion === "ANULAR_VENTA" ? "VENTA_ANULADA" : input.accion === "CONVERTIR_EN_VENTA" ? "CONVERTIDO_EN_VENTA" : "CAMBIO_MEDIO",
      referencia: item.referencia, medioAnterior: item.medio, medio, monto: item.monto,
      operacion: "operacion" in input ? input.operacion || null : null, ventaId, comentario: input.comentario || null, usuarioId: user.id,
    }).returning();
    // La venta nueva (si se convirtió un ingreso) entra ya confirmada: el administrador verificó el dinero.
    const r = await recalcularCierre(tx, sesionId, input.clave);
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "REGULARIZAR_CIERRE", entidad: "sesion_caja", entidadId: sesionId, detalle: { regularizacionId: reg.id, clave: input.clave, accion: reg.accion, monto: item.monto, ventaId } });
    return { id: reg.id, accion: reg.accion, ventaId, ...r };
  });
}

export async function reporteCierre(db: Db, user: Sesion, sesionId: number) {
  const [s] = await db.select().from(sesionCaja).where(eq(sesionCaja.id, sesionId));
  if (!s) throw new ErrorNegocio("NO_EXISTE", "La sesión de caja no existe.", 404);
  if (!tieneRol(user.roles, "ADMIN", "CONTADOR") && s.usuarioId !== user.id) throw new ErrorNegocio("SIN_PERMISO", "Solo puedes ver los reportes de tus propias sesiones.", 403);
  if (s.estado === "ABIERTA") throw new ErrorNegocio("ABIERTA", "El reporte se genera al cerrar la caja.");
  const [cj] = await db.select().from(caja).where(eq(caja.id, s.cajaId));
  const [cajero] = await db.select({ nombre: usuario.nombre }).from(usuario).where(eq(usuario.id, s.usuarioId));
  const validador = s.validadoPor ? (await db.select({ nombre: usuario.nombre }).from(usuario).where(eq(usuario.id, s.validadoPor)))[0]?.nombre : null;
  const regularizaciones = await db.select({
    id: regularizacionCierre.id, clave: regularizacionCierre.clave, origen: regularizacionCierre.origen, accion: regularizacionCierre.accion, referencia: regularizacionCierre.referencia,
    medioAnterior: regularizacionCierre.medioAnterior, medio: regularizacionCierre.medio, monto: regularizacionCierre.monto, operacion: regularizacionCierre.operacion,
    ventaId: regularizacionCierre.ventaId, comentario: regularizacionCierre.comentario, fecha: regularizacionCierre.fecha, usuario: usuario.nombre,
    cargoEstado: regularizacionCierre.cargoEstado, cargoPagadoEn: regularizacionCierre.cargoPagadoEn,
  }).from(regularizacionCierre).innerJoin(usuario, eq(usuario.id, regularizacionCierre.usuarioId)).where(eq(regularizacionCierre.sesionId, s.id)).orderBy(regularizacionCierre.id);
  const { umbral_diferencia_caja: umbral } = await parametros(db);
  const virtuales = await pagosVirtuales(db, s.id);
  const pendientesSet = new Set(s.pagosNoConfirmados ?? []);
  const porComprobante = await db.select({
    tipo: venta.tipoComprobante, estado: venta.estado,
    n: sql<number>`count(*)`.mapWith(Number), total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number),
    costo: sql<number>`coalesce(sum(${venta.costoTotal}),0)`.mapWith(Number),
  }).from(venta).where(eq(venta.sesionId, s.id)).groupBy(venta.tipoComprobante, venta.estado);
  const movimientos = await db.select().from(movimientoCaja).where(and(eq(movimientoCaja.sesionId, s.id), isNull(movimientoCaja.ventaId))).orderBy(movimientoCaja.fecha);
  const eliminados = (await filas<FilaEliminacion>(db, consultaEliminaciones(sql`(a.detalle->>'sesionId')::int = ${s.id}`))).map(mapearEliminacion);
  const [com] = await db.select({ t: sql<number>`coalesce(sum(${comision.monto}),0)`.mapWith(Number) }).from(comision)
    .innerJoin(venta, eq(venta.id, comision.ventaId)).where(and(eq(venta.sesionId, s.id), ne(comision.estado, "REVERTIDA")));
  const conCostos = verCostos(user.roles);
  const ventasTurno = await db.select({
    id: venta.id, fecha: venta.fecha, tipo: venta.tipoComprobante, serie: venta.serie, numero: venta.numero, estado: venta.estado,
    total: venta.total, costo: venta.costoTotal, usuario: usuario.nombre, cliente: cliente.nombre,
  }).from(venta).innerJoin(usuario, eq(usuario.id, venta.usuarioId)).leftJoin(cliente, eq(cliente.id, venta.clienteId))
    .where(eq(venta.sesionId, s.id)).orderBy(venta.fecha, venta.id);
  const pagosTurno = ventasTurno.length ? await db.select({ ventaId: ventaPago.ventaId, medio: ventaPago.medio, monto: ventaPago.monto })
    .from(ventaPago).where(inArray(ventaPago.ventaId, ventasTurno.map((v) => v.id))).orderBy(ventaPago.id) : [];
  const usuariosMov = new Map((await db.select({ id: usuario.id, nombre: usuario.nombre }).from(usuario)
    .where(inArray(usuario.id, [...new Set([s.usuarioId, ...movimientos.map((m) => m.usuarioId)])]))).map((x) => [x.id, x.nombre]));
  /** Todas las transacciones del turno en orden: ventas (con su comprobante y medios de pago) e ingresos o egresos de caja. */
  const transacciones = [
    ...ventasTurno.map((v) => ({
      clave: `V${v.id}`, ventaId: v.id, fecha: v.fecha, tipo: v.tipo as string, numero: `${v.serie}-${v.numero}`, cliente: v.cliente, usuario: v.usuario, estado: v.estado,
      pagos: pagosTurno.filter((p) => p.ventaId === v.id).map((p) => ({ medio: p.medio as string, monto: r2(p.monto) })), total: r2(v.total),
      ...(conCostos ? { ganancia: v.estado === "EMITIDA" ? r2(v.total / 1.18 - v.costo) : null } : {}),
    })),
    ...movimientos.map((m) => ({
      clave: `M${m.id}`, ventaId: null, fecha: m.fecha, tipo: m.tipo as string, numero: m.comprobante, cliente: m.concepto, usuario: usuariosMov.get(m.usuarioId) ?? null, estado: "REGISTRADO",
      pagos: [{ medio: m.medio as string, monto: r2(m.monto) }], total: r2(m.tipo === "EGRESO" ? -m.monto : m.monto),
      ...(conCostos ? { ganancia: null } : {}),
    })),
  ].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha));
  const emitidas = porComprobante.filter((p) => p.estado === "EMITIDA");
  const ventasTotal = r2(emitidas.reduce((a, p) => a + p.total, 0));
  const costo = r2(emitidas.reduce((a, p) => a + p.costo, 0));
  const anuladas = porComprobante.filter((p) => p.estado === "ANULADA");
  return {
    sesion: { id: s.id, caja: cj?.nombre, cajero: cajero?.nombre, usuarioId: s.usuarioId, turno: s.turno, abiertaEn: s.abiertaEn, cerradaEn: s.cerradaEn, estado: s.estado, observacionApertura: s.observacionApertura, observacion: s.observacion, validadoPor: validador, validadoEn: s.validadoEn, observacionValidacion: s.observacionValidacion },
    fondoInicial: s.fondoInicial,
    ventas: { total: ventasTotal, porComprobante: emitidas.map((p) => ({ tipo: p.tipo, cantidad: p.n, total: r2(p.total) })) },
    anuladas: { cantidad: anuladas.reduce((a, p) => a + p.n, 0), total: r2(anuladas.reduce((a, p) => a + p.total, 0)) },
    movimientos: movimientos.map((m) => ({ tipo: m.tipo, concepto: m.concepto, medio: m.medio, monto: m.monto, comprobante: m.comprobante, fecha: m.fecha })),
    saldoEfectivo: s.contado?.EFECTIVO ?? 0, saldoVirtual: sumaVirtual(s.contado),
    virtuales: virtuales.map((v) => ({
      ...v, confirmado: !pendientesSet.has(v.clave), recibido: s.pagosRecibidos?.[v.clave] ?? null,
      regularizacion: regularizaciones.filter((g) => g.clave === v.clave || (g.accion === "CONVERTIDO_EN_VENTA" && v.ventaId !== null && g.ventaId === v.ventaId)).at(-1) ?? null,
    })),
    regularizaciones,
    efectivo: efectivoDelCierre(s, regularizaciones),
    cargos: regularizaciones.filter((g) => g.accion === "CARGO_CAJERO").map((g) => ({ id: g.id, monto: g.monto, estado: g.cargoEstado, pagadoEn: g.cargoPagadoEn })),
    // Para convertir un ingreso en venta: a quién se le atribuye.
    vendedores: user.roles.includes("ADMIN") ? (await db.select({ id: usuario.id, nombre: usuario.nombre, roles: usuario.roles }).from(usuario).where(eq(usuario.activo, true)).orderBy(usuario.nombre))
      .filter((x) => x.roles.some((r) => (ROLES_VENDEN as readonly string[]).includes(r))).map(({ id, nombre }) => ({ id, nombre })) : [],
    // La diferencia que sigue sin explicar: lo resuelto con cargo al cajero o como ingreso de la botica ya no cuenta.
    observaciones: s.estado === "ABIERTA" ? [] : observacionesCierre({ diferencia: r2((s.diferencia ?? 0) + resueltoSinMover(regularizaciones)), umbral, recibidos: s.pagosRecibidos, pendientes: virtuales.filter((v) => pendientesSet.has(v.clave)) }),
    // Lo que el cajero escribió al cerrar, antes de cualquier regularización.
    declarado: s.contadoDeclarado ?? null,
    arqueo: MEDIOS.map((m) => ({ medio: m, esperado: s.esperado?.[m] ?? 0, contado: s.contado?.[m] ?? 0, diferencia: r2((s.contado?.[m] ?? 0) - (s.esperado?.[m] ?? 0)) })),
    diferencia: s.diferencia, fondoSiguiente: s.fondoSiguiente, retiro: s.retiro,
    comisiones: r2(com?.t ?? 0),
    eliminados,
    transacciones,
    ...(conCostos ? {
      margen: ventasTotal > 0 ? r2(((ventasTotal / 1.18 - costo) / (ventasTotal / 1.18)) * 100) : null,
      costoVentas: costo, ganancia: r2(ventasTotal / 1.18 - costo),
    } : {}),
  };
}

export async function listarSesiones(db: Db, user: Sesion, limite = 60) {
  const cond = tieneRol(user.roles, "ADMIN", "CONTADOR") ? undefined : eq(sesionCaja.usuarioId, user.id);
  const rows = await db.select({
    id: sesionCaja.id, caja: caja.nombre, cajero: usuario.nombre, turno: sesionCaja.turno, abiertaEn: sesionCaja.abiertaEn,
    cerradaEn: sesionCaja.cerradaEn, estado: sesionCaja.estado, diferencia: sesionCaja.diferencia, contado: sesionCaja.contado,
  }).from(sesionCaja).innerJoin(caja, eq(caja.id, sesionCaja.cajaId)).innerJoin(usuario, eq(usuario.id, sesionCaja.usuarioId))
    .where(cond ? and(cond, or(eq(sesionCaja.estado, "CERRADA"), eq(sesionCaja.estado, "EN_CIERRE"))) : or(eq(sesionCaja.estado, "CERRADA"), eq(sesionCaja.estado, "EN_CIERRE")))
    .orderBy(desc(sesionCaja.id)).limit(limite);
  return rows.map(({ contado, ...r }) => ({ ...r, saldoEfectivo: contado?.EFECTIVO ?? 0, saldoVirtual: sumaVirtual(contado) }));
}
