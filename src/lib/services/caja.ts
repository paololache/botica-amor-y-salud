import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, MEDIOS, r2, totalConteo, type Medio } from "../util";
import { filas } from "../sqlrows";
import { parametros } from "./parametros";

const { caja, sesionCaja, movimientoCaja, venta, ventaPago, usuario, comision, auditoria } = schema;

export const CONCEPTOS_CAJA = {
  INGRESO: ["Sencillo para vuelto", "Reposición de fondo", "Otro ingreso"],
  EGRESO: ["Pago menor a proveedor", "Limpieza y mantenimiento", "Movilidad", "Útiles de oficina", "Otro egreso"],
} as const;

const ABIERTAS = ["ABIERTA", "EN_CIERRE"];

export async function sesionDelUsuario(db: Db, usuarioId: number) {
  const [s] = await db.select().from(sesionCaja)
    .where(and(eq(sesionCaja.usuarioId, usuarioId), inArray(sesionCaja.estado, ABIERTAS)))
    .orderBy(desc(sesionCaja.id)).limit(1);
  return s ?? null;
}

export async function estadoCaja(db: Db, user: Sesion) {
  const sesion = await sesionDelUsuario(db, user.id);
  const cajas = await db.select().from(caja).orderBy(caja.nombre);
  const abiertas = await db.select({ cajaId: sesionCaja.cajaId, usuario: usuario.nombre, estado: sesionCaja.estado })
    .from(sesionCaja).innerJoin(usuario, eq(usuario.id, sesionCaja.usuarioId))
    .where(inArray(sesionCaja.estado, ABIERTAS));
  const lista = [];
  for (const c of cajas) {
    const [ult] = await db.select({ fondo: sesionCaja.fondoSiguiente }).from(sesionCaja)
      .where(and(eq(sesionCaja.cajaId, c.id), eq(sesionCaja.estado, "CERRADA"))).orderBy(desc(sesionCaja.id)).limit(1);
    const ocupada = abiertas.find((a) => a.cajaId === c.id);
    lista.push({ id: c.id, nombre: c.nombre, ocupadaPor: ocupada?.usuario ?? null, fondoSugerido: ult?.fondo ?? 0 });
  }
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
    };
  }
  return { sesion: sesion ? { id: sesion.id, cajaId: sesion.cajaId, turno: sesion.turno, abiertaEn: sesion.abiertaEn, estado: sesion.estado, fondoInicial: sesion.fondoInicial, caja: cajas.find((c) => c.id === sesion.cajaId)?.nombre } : null, cajas: lista, resumen, conceptos: CONCEPTOS_CAJA };
}

export const esquemaApertura = z.object({
  cajaId: z.number().int(),
  turno: z.enum(["MAÑANA", "TARDE", "NOCHE", "COMPLETO"]),
  conteo: z.record(z.string(), z.number().int().min(0)),
  observacion: z.string().optional(),
});

export async function abrirCaja(db: Db, user: Sesion, input: z.infer<typeof esquemaApertura>) {
  const fondo = totalConteo(input.conteo);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from caja where id = ${input.cajaId} for update`);
    if (await sesionDelUsuario(tx, user.id)) throw new ErrorNegocio("YA_TIENE_CAJA", "Ya tienes una caja abierta. Ciérrala antes de abrir otra.");
    const [ocupada] = await tx.select({ usuario: usuario.nombre }).from(sesionCaja).innerJoin(usuario, eq(usuario.id, sesionCaja.usuarioId))
      .where(and(eq(sesionCaja.cajaId, input.cajaId), inArray(sesionCaja.estado, ABIERTAS)));
    if (ocupada) throw new ErrorNegocio("CAJA_OCUPADA", `Esta caja está abierta por ${ocupada.usuario}.`, 409);
    const [ult] = await tx.select({ fondo: sesionCaja.fondoSiguiente }).from(sesionCaja)
      .where(and(eq(sesionCaja.cajaId, input.cajaId), eq(sesionCaja.estado, "CERRADA"))).orderBy(desc(sesionCaja.id)).limit(1);
    const sugerido = ult?.fondo ?? null;
    if (sugerido !== null && r2(sugerido) !== fondo && !(input.observacion && input.observacion.trim().length >= 5)) {
      throw new ErrorNegocio("FONDO_DISTINTO", `El fondo contado (S/ ${fondo.toFixed(2)}) no coincide con el que quedó en el último cierre (S/ ${sugerido.toFixed(2)}). Escribe una observación.`, 422);
    }
    const [s] = await tx.insert(sesionCaja).values({
      cajaId: input.cajaId, usuarioId: user.id, turno: input.turno, fondoInicial: fondo, conteoApertura: input.conteo,
      observacionApertura: input.observacion ?? null, estado: "ABIERTA",
    }).returning();
    return s;
  });
}

export const esquemaMovimiento = z.object({
  tipo: z.enum(["INGRESO", "EGRESO"]),
  concepto: z.string().min(3),
  medio: z.enum(MEDIOS).default("EFECTIVO"),
  monto: z.number().positive(),
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
  if (s.usuarioId !== user.id && user.rol !== "ADMIN") throw new ErrorNegocio("SIN_PERMISO", "Solo puedes eliminar movimientos de tu propia caja.", 403);
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
    .from(movimientoCaja).where(eq(movimientoCaja.sesionId, sesionId)).groupBy(movimientoCaja.tipo, movimientoCaja.medio);
  for (const m of movs) esperado[m.medio as Medio] += m.tipo === "INGRESO" ? m.total : -m.total;
  for (const k of MEDIOS) esperado[k] = r2(esperado[k]);
  return esperado;
}

export const esquemaCierre = z.object({
  conteo: z.record(z.string(), z.number().int().min(0)),
  virtuales: z.object({ YAPE: z.number().min(0), PLIN: z.number().min(0), TARJETA: z.number().min(0), TRANSFERENCIA: z.number().min(0) }),
  fondoSiguiente: z.number().min(0),
  observacion: z.string().optional(),
});

/** Cierre de caja: el cajero registra lo contado; el sistema calcula la diferencia contra lo esperado. */
export async function cerrarCaja(db: Db, user: Sesion, input: z.infer<typeof esquemaCierre>) {
  const s = await sesionDelUsuario(db, user.id);
  if (!s) throw new ErrorNegocio("SIN_CAJA", "No tienes una caja abierta.");
  if (s.estado === "EN_CIERRE") throw new ErrorNegocio("EN_CIERRE", "Tu cierre ya fue registrado y espera la validación del administrador.");
  const efectivo = totalConteo(input.conteo);
  if (input.fondoSiguiente > efectivo) throw new ErrorNegocio("FONDO_MAYOR", "El fondo que queda no puede ser mayor al efectivo contado.");
  const contado: Record<Medio, number> = { EFECTIVO: efectivo, ...input.virtuales };
  const esperado = await calcularEsperado(db, s.id);
  const diferencia = r2(MEDIOS.reduce((acc, m) => acc + (contado[m] - esperado[m]), 0));
  const { umbral_diferencia_caja } = await parametros(db);
  const requiereValidacion = Math.abs(diferencia) > umbral_diferencia_caja && user.rol !== "ADMIN";
  const estado = requiereValidacion ? "EN_CIERRE" : "CERRADA";
  await db.update(sesionCaja).set({
    conteoCierre: input.conteo, contado, esperado, diferencia, fondoSiguiente: r2(input.fondoSiguiente), retiro: r2(efectivo - input.fondoSiguiente),
    observacion: input.observacion ?? null, estado, cerradaEn: estado === "CERRADA" ? new Date() : null,
    validadoPor: estado === "CERRADA" && Math.abs(diferencia) > umbral_diferencia_caja ? user.id : null,
  }).where(eq(sesionCaja.id, s.id));
  return { sesionId: s.id, estado, requiereValidacion, diferencia };
}

export const esquemaValidacion = z.object({ sesionId: z.number().int(), login: z.string().optional(), password: z.string().optional(), observacion: z.string().min(5) });

/** Un administrador distinto al cajero valida el cierre cuando la diferencia supera el umbral. */
export async function validarCierre(db: Db, user: Sesion, input: z.infer<typeof esquemaValidacion>) {
  const [s] = await db.select().from(sesionCaja).where(eq(sesionCaja.id, input.sesionId));
  if (!s || s.estado !== "EN_CIERRE") throw new ErrorNegocio("NO_PENDIENTE", "Esta sesión no espera validación.");
  let validador = user.rol === "ADMIN" && user.id !== s.usuarioId ? user.id : null;
  if (!validador) {
    if (!input.login || !input.password) throw new ErrorNegocio("CREDENCIALES", "Ingresa el usuario y la clave del administrador.");
    const [a] = await db.select().from(usuario).where(and(eq(usuario.login, input.login), eq(usuario.activo, true)));
    if (!a || a.rol !== "ADMIN" || !(await bcrypt.compare(input.password, a.passwordHash))) throw new ErrorNegocio("CREDENCIALES", "Usuario o clave de administrador incorrectos.", 401);
    if (a.id === s.usuarioId) throw new ErrorNegocio("SEGREGACION", "El cierre lo debe validar un usuario distinto al cajero.");
    validador = a.id;
  }
  await db.update(sesionCaja).set({ estado: "CERRADA", cerradaEn: new Date(), validadoPor: validador, observacion: input.observacion }).where(eq(sesionCaja.id, s.id));
  await db.insert(auditoria).values({ usuarioId: validador, accion: "VALIDAR_CIERRE", entidad: "sesion_caja", entidadId: s.id, detalle: { diferencia: s.diferencia } });
  return { sesionId: s.id, estado: "CERRADA" };
}

export async function reporteCierre(db: Db, user: Sesion, sesionId: number) {
  const [s] = await db.select().from(sesionCaja).where(eq(sesionCaja.id, sesionId));
  if (!s) throw new ErrorNegocio("NO_EXISTE", "La sesión de caja no existe.", 404);
  if (!["ADMIN", "CONTADOR"].includes(user.rol) && s.usuarioId !== user.id) throw new ErrorNegocio("SIN_PERMISO", "Solo puedes ver los reportes de tus propias sesiones.", 403);
  if (s.estado === "ABIERTA") throw new ErrorNegocio("ABIERTA", "El reporte se genera al cerrar la caja.");
  const [cj] = await db.select().from(caja).where(eq(caja.id, s.cajaId));
  const [cajero] = await db.select({ nombre: usuario.nombre }).from(usuario).where(eq(usuario.id, s.usuarioId));
  const validador = s.validadoPor ? (await db.select({ nombre: usuario.nombre }).from(usuario).where(eq(usuario.id, s.validadoPor)))[0]?.nombre : null;
  const porComprobante = await db.select({
    tipo: venta.tipoComprobante, estado: venta.estado,
    n: sql<number>`count(*)`.mapWith(Number), total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number),
    costo: sql<number>`coalesce(sum(${venta.costoTotal}),0)`.mapWith(Number),
  }).from(venta).where(eq(venta.sesionId, s.id)).groupBy(venta.tipoComprobante, venta.estado);
  const movimientos = await db.select().from(movimientoCaja).where(eq(movimientoCaja.sesionId, s.id)).orderBy(movimientoCaja.fecha);
  const eliminados = (await filas<FilaEliminacion>(db, consultaEliminaciones(sql`(a.detalle->>'sesionId')::int = ${s.id}`))).map(mapearEliminacion);
  const [com] = await db.select({ t: sql<number>`coalesce(sum(${comision.monto}),0)`.mapWith(Number) }).from(comision)
    .innerJoin(venta, eq(venta.id, comision.ventaId)).where(and(eq(venta.sesionId, s.id), ne(comision.estado, "REVERTIDA")));
  const emitidas = porComprobante.filter((p) => p.estado === "EMITIDA");
  const ventasTotal = r2(emitidas.reduce((a, p) => a + p.total, 0));
  const costo = r2(emitidas.reduce((a, p) => a + p.costo, 0));
  const anuladas = porComprobante.filter((p) => p.estado === "ANULADA");
  return {
    sesion: { id: s.id, caja: cj?.nombre, cajero: cajero?.nombre, turno: s.turno, abiertaEn: s.abiertaEn, cerradaEn: s.cerradaEn, estado: s.estado, observacionApertura: s.observacionApertura, observacion: s.observacion, validadoPor: validador },
    fondoInicial: s.fondoInicial,
    ventas: { total: ventasTotal, porComprobante: emitidas.map((p) => ({ tipo: p.tipo, cantidad: p.n, total: r2(p.total) })) },
    anuladas: { cantidad: anuladas.reduce((a, p) => a + p.n, 0), total: r2(anuladas.reduce((a, p) => a + p.total, 0)) },
    movimientos: movimientos.map((m) => ({ tipo: m.tipo, concepto: m.concepto, medio: m.medio, monto: m.monto, comprobante: m.comprobante, fecha: m.fecha })),
    arqueo: MEDIOS.map((m) => ({ medio: m, esperado: s.esperado?.[m] ?? 0, contado: s.contado?.[m] ?? 0, diferencia: r2((s.contado?.[m] ?? 0) - (s.esperado?.[m] ?? 0)) })),
    diferencia: s.diferencia, fondoSiguiente: s.fondoSiguiente, retiro: s.retiro,
    comisiones: r2(com?.t ?? 0),
    eliminados,
    margen: ventasTotal > 0 ? r2(((ventasTotal / 1.18 - costo) / (ventasTotal / 1.18)) * 100) : null,
    costoVentas: costo,
  };
}

export async function listarSesiones(db: Db, user: Sesion, limite = 60) {
  const cond = ["ADMIN", "CONTADOR"].includes(user.rol) ? undefined : eq(sesionCaja.usuarioId, user.id);
  const rows = await db.select({
    id: sesionCaja.id, caja: caja.nombre, cajero: usuario.nombre, turno: sesionCaja.turno, abiertaEn: sesionCaja.abiertaEn,
    cerradaEn: sesionCaja.cerradaEn, estado: sesionCaja.estado, diferencia: sesionCaja.diferencia,
  }).from(sesionCaja).innerJoin(caja, eq(caja.id, sesionCaja.cajaId)).innerJoin(usuario, eq(usuario.id, sesionCaja.usuarioId))
    .where(cond ? and(cond, or(eq(sesionCaja.estado, "CERRADA"), eq(sesionCaja.estado, "EN_CIERRE"))) : or(eq(sesionCaja.estado, "CERRADA"), eq(sesionCaja.estado, "EN_CIERRE")))
    .orderBy(desc(sesionCaja.id)).limit(limite);
  return rows;
}
