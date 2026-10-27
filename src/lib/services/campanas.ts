import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima } from "../util";

const { campana, producto, lote, kardex, auditoria } = schema;
const VIGENTES = ["PROGRAMADA", "ACTIVA", "PAUSADA"];

/** Una campaña cuenta como activa si está ACTIVA, o PROGRAMADA y ya llegó su fecha de inicio, y no pasó su fecha de fin. */
export function estadoEfectivo(c: { estado: string; inicio: string; fin: string }, hoy: string): string {
  if (c.estado === "FINALIZADA") return "FINALIZADA";
  if (c.fin < hoy) return "FINALIZADA";
  if (c.estado === "PROGRAMADA" && c.inicio <= hoy) return "ACTIVA";
  return c.estado;
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

export async function refrescarCampanas(db: Db, hoy = hoyLima()) {
  await db.update(campana).set({ estado: "ACTIVA", actualizadoEn: new Date() }).where(and(eq(campana.estado, "PROGRAMADA"), lte(campana.inicio, hoy), gte(campana.fin, hoy)));
  await db.update(campana).set({ estado: "FINALIZADA", actualizadoEn: new Date() }).where(and(inArray(campana.estado, VIGENTES), lt(campana.fin, hoy)));
}

export async function listarCampanas(db: Db) {
  const hoy = hoyLima();
  await refrescarCampanas(db, hoy);
  const rows = await db.select({
    id: campana.id, nombre: campana.nombre, productoId: campana.productoId, producto: producto.nombre, codigo: producto.codigo,
    loteId: campana.loteId, lote: lote.numero, porcentaje: campana.porcentaje, inicio: campana.inicio, fin: campana.fin, estado: campana.estado, observacion: campana.observacion,
  }).from(campana).innerJoin(producto, eq(producto.id, campana.productoId)).leftJoin(lote, eq(lote.id, campana.loteId)).orderBy(desc(campana.id));
  return rows.map((r) => ({ ...r, diasRestantes: r.estado === "FINALIZADA" ? null : Math.round((Date.parse(r.fin) - Date.parse(hoy)) / 86400000) }));
}

export const esquemaCampana = z.object({
  codigo: z.string().min(1),
  loteId: z.number().int().nullable().optional(),
  nombre: z.string().min(3).max(100),
  porcentaje: z.number().gt(0).max(100),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  return { producto: { id: p.id, codigo: p.codigo, nombre: p.nombre }, enKardex: (k?.n ?? 0) > 0, ultimoMovimiento: k?.ultimo ?? null, stock, lotes };
}

export async function crearCampana(db: Db, user: Sesion, input: z.infer<typeof esquemaCampana>) {
  const hoy = hoyLima();
  const v = await verificarProductoKardex(db, input.codigo);
  if (!v.enKardex) throw new ErrorNegocio("SIN_KARDEX", "El producto debe estar registrado en el kardex antes de entrar en promoción.");
  if (v.stock <= 0) throw new ErrorNegocio("SIN_STOCK", "El producto no tiene stock para una campaña.");
  if (input.loteId && !v.lotes.some((l) => l.id === input.loteId)) throw new ErrorNegocio("LOTE_INVALIDO", "El lote elegido no pertenece al producto o no tiene stock.");
  const inicio = input.activarAhora ? hoy : input.inicio;
  if (inicio < hoy) throw new ErrorNegocio("FECHA_INICIO", "La fecha estimada de inicio no puede ser anterior a hoy.");
  if (input.fin <= inicio) throw new ErrorNegocio("FECHA_FIN", "La fecha estimada de fin debe ser posterior a la de inicio.");
  const cruce = await db.select({ id: campana.id, nombre: campana.nombre }).from(campana).where(and(
    eq(campana.productoId, v.producto.id), inArray(campana.estado, VIGENTES), lte(campana.inicio, input.fin), gte(campana.fin, inicio),
    input.loteId ? or(isNull(campana.loteId), eq(campana.loteId, input.loteId)) : sql`true`,
  ));
  if (cruce.length) throw new ErrorNegocio("CAMPANA_CRUZADA", `El producto ya tiene la campaña «${cruce[0].nombre}» en esas fechas.`, 409);
  const [c] = await db.insert(campana).values({
    nombre: input.nombre, productoId: v.producto.id, loteId: input.loteId ?? null, porcentaje: input.porcentaje,
    inicio, fin: input.fin, estado: input.activarAhora || inicio <= hoy ? "ACTIVA" : "PROGRAMADA", observacion: input.observacion ?? null, creadoPor: user.id,
  }).returning();
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "CREAR_CAMPANA", entidad: "campana", entidadId: c.id, detalle: { porcentaje: c.porcentaje, inicio, fin: c.fin } });
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

export const esquemaCambioCampana = z.object({ accion: z.enum(["EXTENDER", "FINALIZAR"]), fin: z.string().optional() });

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
