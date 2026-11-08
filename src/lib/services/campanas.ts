import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { fecha, fechaOpcional, texto } from "../validacion";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima, r2 } from "../util";
import { tieneRol } from "../permisos";
import { filas } from "../sqlrows";
import { parametros } from "./parametros";

const { campana, producto, presentacion, lote, kardex, auditoria } = schema;
const VIGENTES = ["PROGRAMADA", "ACTIVA", "PAUSADA"];

/** Una campaña cuenta como activa si está ACTIVA, o PROGRAMADA y ya llegó su fecha de inicio, y no pasó su fecha de fin. */
export function estadoEfectivo(c: { estado: string; inicio: string; fin: string }, hoy: string): string {
  if (c.estado === "FINALIZADA") return "FINALIZADA";
  if (c.fin < hoy) return "FINALIZADA";
  if (c.estado === "PROGRAMADA" && c.inicio <= hoy) return "ACTIVA";
  return c.estado;
}

/** Campañas que hoy rigen y tienen stock vigente para vender, con su precio de campaña si lo tienen. */
export async function campanasVigentes(db: Db, hoy = hoyLima()) {
  const activas = await filas<{ id: number; producto_id: number; producto: string; codigo: string; porcentaje: string; fin: string; precios: Record<string, number> | null; vigente: string }>(db, sql`
    select c.id, c.producto_id, p.nombre as producto, p.codigo, c.porcentaje, c.fin::text as fin, c.precios,
      (select coalesce(sum(l.cantidad), 0) from lote l where l.producto_id = c.producto_id and l.estado = 'ACTIVO' and l.vencimiento > ${hoy}
        and (c.lote_id is null or l.id = c.lote_id)) as vigente
    from campana c join producto p on p.id = c.producto_id
    where p.activo and c.fin >= ${hoy} and (c.estado = 'ACTIVA' or (c.estado = 'PROGRAMADA' and c.inicio <= ${hoy}))`);
  const presIds = [...new Set(activas.flatMap((c) => Object.keys(c.precios ?? {}).map(Number)))];
  const presCamp = new Map((presIds.length ? await filas<{ id: number; nombre: string; pvp: string }>(db, sql`select id, nombre, pvp from presentacion where id in ${sql.raw(`(${presIds.join(",")})`)}`) : []).map((x) => [Number(x.id), x]));
  return activas.filter((c) => Number(c.vigente) > 0).map((c) => {
    const p = Object.entries(c.precios ?? {}).map(([id, v]) => ({ x: presCamp.get(Number(id)), v: Number(v) })).find((e) => e.x);
    return {
      campanaId: Number(c.id), productoId: Number(c.producto_id), producto: c.producto, codigo: c.codigo, porcentaje: Number(c.porcentaje),
      fin: String(c.fin).slice(0, 10), vigente: Number(c.vigente),
      precio: p?.x ? { presentacion: p.x.nombre, campana: r2(p.v), lista: r2(Number(p.x.pvp)) } : null,
    };
  });
}

/**
 * Recordatorio para quien vende: si tiene la caja abierta y lleva un rato sin vender, le recuerda los productos en campaña.
 * El tiempo sale del parámetro `recordatorio_campana_min` y se cuenta desde su última venta o desde que abrió la caja.
 */
export async function recordatorioCampanas(db: Db, user: Sesion, ahora = new Date()) {
  if (!tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF")) return { activo: false as const, motivo: "NO_VENDE" };
  const [s] = await db.select({ id: schema.sesionCaja.id, abiertaEn: schema.sesionCaja.abiertaEn }).from(schema.sesionCaja)
    .where(and(eq(schema.sesionCaja.usuarioId, user.id), eq(schema.sesionCaja.estado, "ABIERTA"))).orderBy(desc(schema.sesionCaja.id)).limit(1);
  if (!s) return { activo: false as const, motivo: "SIN_CAJA" };
  const [ult] = await db.select({ f: sql<string | null>`max(${schema.venta.fecha})` }).from(schema.venta)
    .where(and(eq(schema.venta.usuarioId, user.id), eq(schema.venta.estado, "EMITIDA"), eq(schema.venta.canal, "MOSTRADOR")));
  const ultimaVenta = ult?.f ? new Date(ult.f) : null;
  const desde = ultimaVenta && ultimaVenta > s.abiertaEn ? ultimaVenta : s.abiertaEn;
  const minutosSinVender = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60000));
  const umbralMin = (await parametros(db)).recordatorio_campana_min;
  const comisiona = !tieneRol(user.roles, "ADMIN");
  const productos = (await campanasVigentes(db)).sort((a, b) => b.porcentaje - a.porcentaje || a.fin.localeCompare(b.fin)).slice(0, 5)
    .map((c) => ({ ...c, porcentaje: comisiona ? c.porcentaje : 0 }));
  return {
    activo: true as const, umbralMin, minutosSinVender, ultimaVenta: ultimaVenta && ultimaVenta > s.abiertaEn ? ultimaVenta : null,
    debeRecordar: umbralMin > 0 && productos.length > 0 && minutosSinVender >= umbralMin, productos,
  };
}

/** Campaña que genera comisión hoy para un producto (y lote, si la campaña es de un lote). */
export async function campanaActiva(tx: Db, productoId: number, loteId: number, hoy: string) {
  const rows = await tx.select().from(campana).where(and(
    eq(campana.productoId, productoId), gte(campana.fin, hoy),
    or(eq(campana.estado, "ACTIVA"), and(eq(campana.estado, "PROGRAMADA"), lte(campana.inicio, hoy))),
    or(isNull(campana.loteId), eq(campana.loteId, loteId)),
  )).orderBy(desc(campana.id)).limit(1);
  return rows[0] ?? null;
}

/** Precio de campaña vigente por presentación (id → S/). Solo las campañas de todo el producto cambian el precio. */
export async function preciosCampana(db: Db, productoIds: number[], hoy: string) {
  const m = new Map<number, number>();
  if (!productoIds.length) return m;
  const rows = await db.select({ precios: campana.precios }).from(campana).where(and(
    inArray(campana.productoId, productoIds), isNull(campana.loteId), gte(campana.fin, hoy), sql`${campana.precios} is not null`,
    or(eq(campana.estado, "ACTIVA"), and(eq(campana.estado, "PROGRAMADA"), lte(campana.inicio, hoy))),
  )).orderBy(campana.id);
  for (const r of rows) for (const [id, precio] of Object.entries(r.precios ?? {})) m.set(Number(id), precio);
  return m;
}

export async function refrescarCampanas(db: Db, hoy = hoyLima()) {
  await db.update(campana).set({ estado: "ACTIVA", actualizadoEn: new Date() }).where(and(eq(campana.estado, "PROGRAMADA"), lte(campana.inicio, hoy), gte(campana.fin, hoy)));
  await db.update(campana).set({ estado: "FINALIZADA", actualizadoEn: new Date() }).where(and(inArray(campana.estado, VIGENTES), lt(campana.fin, hoy)));
}

export async function listarCampanas(db: Db) {
  const hoy = hoyLima();
  await refrescarCampanas(db, hoy);
  const rows = await db.select({
    id: campana.id, nombre: campana.nombre, productoId: campana.productoId, producto: producto.nombre, codigo: producto.codigo,
    loteId: campana.loteId, lote: lote.numero, porcentaje: campana.porcentaje, precios: campana.precios, inicio: campana.inicio, fin: campana.fin, estado: campana.estado, observacion: campana.observacion,
  }).from(campana).innerJoin(producto, eq(producto.id, campana.productoId)).leftJoin(lote, eq(lote.id, campana.loteId)).orderBy(desc(campana.id));
  const presIds = [...new Set(rows.flatMap((r) => Object.keys(r.precios ?? {}).map(Number)))];
  const pres = new Map((presIds.length ? await db.select({ id: presentacion.id, nombre: presentacion.nombre, pvp: presentacion.pvp }).from(presentacion).where(inArray(presentacion.id, presIds)) : []).map((x) => [x.id, x]));
  return rows.map(({ precios, ...r }) => ({
    ...r,
    precios: Object.entries(precios ?? {}).map(([id, precio]) => ({ presentacion: pres.get(Number(id))?.nombre ?? "", lista: pres.get(Number(id))?.pvp ?? null, precio })),
    diasRestantes: r.estado === "FINALIZADA" ? null : Math.round((Date.parse(r.fin) - Date.parse(hoy)) / 86400000) }));
}

export const esquemaCampana = z.object({
  codigo: z.string().min(1),
  loteId: z.number().int().nullable().optional(),
  nombre: texto(3).max(100),
  porcentaje: z.number().gt(0).max(100),
  /** Precio de campaña por presentación: id de presentación → precio en soles. */
  precios: z.record(z.string().regex(/^\d+$/), z.number().positive().max(1_000_000)).optional(),
  inicio: fecha,
  fin: fecha,
  observacion: z.string().max(250).optional(),
  activarAhora: z.boolean().optional(),
});

/** Busca el producto por código y confirma que está en el kardex con stock (RN-19). */
export async function verificarProductoKardex(db: Db, codigo: string) {
  const [p] = await db.select().from(producto).where(eq(producto.codigo, codigo.trim()));
  if (!p || !p.activo) throw new ErrorNegocio("NO_EXISTE", "No hay un producto activo con ese código.", 404);
  const [k] = await db.select({ n: sql<number>`count(*)`.mapWith(Number), ultimo: sql<string>`max(${kardex.fecha})` }).from(kardex).where(eq(kardex.productoId, p.id));
  const lotes = await db.select({ id: lote.id, numero: lote.numero, vencimiento: lote.vencimiento, cantidad: lote.cantidad }).from(lote)
    .where(and(eq(lote.productoId, p.id), sql`${lote.cantidad} > 0`)).orderBy(lote.vencimiento);
  const stock = lotes.reduce((s, l) => s + l.cantidad, 0);
  const presentaciones = await db.select({ id: presentacion.id, nombre: presentacion.nombre, factor: presentacion.factor, pvp: presentacion.pvp }).from(presentacion)
    .where(and(eq(presentacion.productoId, p.id), eq(presentacion.activo, true))).orderBy(presentacion.factor);
  return { producto: { id: p.id, codigo: p.codigo, nombre: p.nombre }, enKardex: (k?.n ?? 0) > 0, ultimoMovimiento: k?.ultimo ?? null, stock, lotes, presentaciones };
}

export async function crearCampana(db: Db, user: Sesion, input: z.infer<typeof esquemaCampana>) {
  const hoy = hoyLima();
  const v = await verificarProductoKardex(db, input.codigo);
  if (!v.enKardex) throw new ErrorNegocio("SIN_KARDEX", "El producto debe estar registrado en el kardex antes de entrar en promoción.");
  if (v.stock <= 0) throw new ErrorNegocio("SIN_STOCK", "El producto no tiene stock para una campaña.");
  if (input.loteId && !v.lotes.some((l) => l.id === input.loteId)) throw new ErrorNegocio("LOTE_INVALIDO", "El lote elegido no pertenece al producto o no tiene stock.");
  const precios = Object.fromEntries(Object.entries(input.precios ?? {}).map(([id, precio]) => [id, Math.round(precio * 100) / 100]));
  if (Object.keys(precios).length) {
    if (input.loteId) throw new ErrorNegocio("PRECIO_LOTE", "El precio de campaña aplica a todo el producto. Para ponerle precio, deja el lote en «Todos los lotes».");
    for (const [id, precio] of Object.entries(precios)) {
      const pr = v.presentaciones.find((x) => x.id === Number(id));
      if (!pr) throw new ErrorNegocio("PRESENTACION_INVALIDA", "Una de las presentaciones no pertenece al producto o está inactiva.");
      if (precio >= pr.pvp) throw new ErrorNegocio("PRECIO_CAMPANA", `El precio de campaña de «${pr.nombre}» debe ser menor al de lista (S/ ${pr.pvp.toFixed(2)}).`);
    }
  }
  const inicio = input.activarAhora ? hoy : input.inicio;
  if (inicio < hoy) throw new ErrorNegocio("FECHA_INICIO", "La fecha estimada de inicio no puede ser anterior a hoy.");
  if (input.fin <= inicio) throw new ErrorNegocio("FECHA_FIN", "La fecha estimada de fin debe ser posterior a la de inicio.");
  const cruce = await db.select({ id: campana.id, nombre: campana.nombre }).from(campana).where(and(
    eq(campana.productoId, v.producto.id), inArray(campana.estado, VIGENTES), lte(campana.inicio, input.fin), gte(campana.fin, inicio),
    input.loteId ? or(isNull(campana.loteId), eq(campana.loteId, input.loteId)) : sql`true`,
  ));
  if (cruce.length) throw new ErrorNegocio("CAMPANA_CRUZADA", `El producto ya tiene la campaña «${cruce[0].nombre}» en esas fechas.`, 409);
  const [c] = await db.insert(campana).values({
    nombre: input.nombre, productoId: v.producto.id, loteId: input.loteId ?? null, porcentaje: input.porcentaje, precios: Object.keys(precios).length ? precios : null,
    inicio, fin: input.fin, estado: input.activarAhora || inicio <= hoy ? "ACTIVA" : "PROGRAMADA", observacion: input.observacion ?? null, creadoPor: user.id,
  }).returning();
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "CREAR_CAMPANA", entidad: "campana", entidadId: c.id, detalle: { porcentaje: c.porcentaje, precios: c.precios, inicio, fin: c.fin } });
  return c;
}

/** Interruptor de la lista de stock: activa o pausa la campaña vigente del producto. */
export async function alternarCampana(db: Db, user: Sesion, productoId: number) {
  const hoy = hoyLima();
  const [c] = await db.select().from(campana).where(and(eq(campana.productoId, productoId), inArray(campana.estado, VIGENTES), gte(campana.fin, hoy)))
    .orderBy(desc(campana.id)).limit(1);
  if (!c) throw new ErrorNegocio("SIN_CAMPANA", "Este producto no tiene una campaña vigente. Créala desde Campañas.", 404);
  const efectivo = estadoEfectivo(c, hoy);
  const nuevo = efectivo === "ACTIVA" ? "PAUSADA" : "ACTIVA";
  await db.update(campana).set({ estado: nuevo, inicio: nuevo === "ACTIVA" && c.inicio > hoy ? hoy : c.inicio, actualizadoPor: user.id, actualizadoEn: new Date() }).where(eq(campana.id, c.id));
  await db.insert(auditoria).values({ usuarioId: user.id, accion: nuevo === "ACTIVA" ? "ACTIVAR_CAMPANA" : "PAUSAR_CAMPANA", entidad: "campana", entidadId: c.id });
  return { id: c.id, estado: nuevo };
}

export const esquemaCambioCampana = z.object({ accion: z.enum(["EXTENDER", "FINALIZAR"]), fin: fechaOpcional });

export async function cambiarCampana(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaCambioCampana>) {
  const [c] = await db.select().from(campana).where(eq(campana.id, id));
  if (!c) throw new ErrorNegocio("NO_EXISTE", "La campaña no existe.", 404);
  if (input.accion === "FINALIZAR") {
    await db.update(campana).set({ estado: "FINALIZADA", actualizadoPor: user.id, actualizadoEn: new Date() }).where(eq(campana.id, id));
    return { id, estado: "FINALIZADA" };
  }
  if (!input.fin || input.fin <= c.fin) throw new ErrorNegocio("FECHA_FIN", "La nueva fecha de fin debe ser posterior a la actual.");
  await db.update(campana).set({ fin: input.fin, estado: c.estado === "FINALIZADA" ? "ACTIVA" : c.estado, actualizadoPor: user.id, actualizadoEn: new Date() }).where(eq(campana.id, id));
  return { id, fin: input.fin };
}

export { ne };
