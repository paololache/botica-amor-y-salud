import { and, asc, eq, gt, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { ErrorNegocio, r2 } from "../util";

const { lote, producto, kardex } = schema;

/** Bloquea las filas de producto en orden para que dos cajas no mezclen saldos de kardex. */
export async function bloquearProductos(tx: Db, ids: number[]) {
  const unicos = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of unicos) await tx.execute(sql`select id from producto where id = ${id} for update`);
}

export async function stockProducto(tx: Db, productoId: number): Promise<number> {
  const [r] = await tx
    .select({ s: sql<number>`coalesce(sum(${lote.cantidad}), 0)`.mapWith(Number) })
    .from(lote)
    .where(eq(lote.productoId, productoId));
  return r?.s ?? 0;
}

export type Asignacion = { loteId: number; unidades: number; numero: string; vencimiento: string; costoUnitario: number };

/** Reparte las unidades entre lotes vigentes, primero el que vence antes (FEFO), y descuenta el stock. */
export async function asignarFEFO(tx: Db, productoId: number, unidades: number, fechaHoy: string, loteId?: number | null): Promise<Asignacion[]> {
  const condiciones = [eq(lote.productoId, productoId), gt(lote.cantidad, 0), eq(lote.estado, "ACTIVO"), gt(lote.vencimiento, fechaHoy)];
  if (loteId) condiciones.push(eq(lote.id, loteId));
  const lotes = await tx.select().from(lote).where(and(...condiciones)).orderBy(asc(lote.vencimiento), asc(lote.id));
  const disponible = lotes.reduce((s, l) => s + l.cantidad, 0);
  if (disponible < unidades) {
    throw new ErrorNegocio("STOCK_INSUFICIENTE", `Stock insuficiente: se piden ${unidades} unidades y hay ${disponible} vigentes.`, 409);
  }
  const out: Asignacion[] = [];
  let falta = unidades;
  for (const l of lotes) {
    if (falta <= 0) break;
    const toma = Math.min(falta, l.cantidad);
    const upd = await tx
      .update(lote)
      .set({ cantidad: sql`${lote.cantidad} - ${toma}` })
      .where(and(eq(lote.id, l.id), gte(lote.cantidad, toma)))
      .returning({ id: lote.id });
    if (!upd.length) throw new ErrorNegocio("STOCK_INSUFICIENTE", "Otro usuario acaba de vender este lote. Vuelve a intentarlo.", 409);
    out.push({ loteId: l.id, unidades: toma, numero: l.numero, vencimiento: l.vencimiento, costoUnitario: l.costoUnitario });
    falta -= toma;
  }
  return out;
}

export async function sumarLote(tx: Db, loteId: number, unidades: number) {
  await tx.update(lote).set({ cantidad: sql`${lote.cantidad} + ${unidades}` }).where(eq(lote.id, loteId));
}

export async function restarLote(tx: Db, loteId: number, unidades: number) {
  const upd = await tx
    .update(lote)
    .set({ cantidad: sql`${lote.cantidad} - ${unidades}` })
    .where(and(eq(lote.id, loteId), gte(lote.cantidad, unidades)))
    .returning({ id: lote.id });
  if (!upd.length) throw new ErrorNegocio("STOCK_INSUFICIENTE", "El lote no tiene stock suficiente para este movimiento.", 409);
}

export type LineaKardex = {
  productoId: number;
  loteId: number | null;
  tipo: string;
  motivo?: string | null;
  documentoTipo: string;
  documentoId?: number | null;
  documentoRef?: string | null;
  entrada?: number;
  salida?: number;
  costoUnitario: number;
  usuarioId?: number | null;
  fecha?: Date;
};

/** Escribe una línea inmutable de kardex con el saldo del producto después del movimiento (RN-07). */
export async function registrarKardex(tx: Db, k: LineaKardex) {
  const saldo = await stockProducto(tx, k.productoId);
  const [p] = await tx.select({ cp: producto.costoPromedio }).from(producto).where(eq(producto.id, k.productoId));
  const cp = p?.cp ?? 0;
  await tx.insert(kardex).values({
    productoId: k.productoId,
    loteId: k.loteId,
    tipo: k.tipo,
    motivo: k.motivo ?? null,
    documentoTipo: k.documentoTipo,
    documentoId: k.documentoId ?? null,
    documentoRef: k.documentoRef ?? null,
    entrada: k.entrada ?? 0,
    salida: k.salida ?? 0,
    costoUnitario: k.costoUnitario,
    saldoUnidades: saldo,
    costoPromedio: cp,
    saldoValorizado: r2(saldo * cp),
    usuarioId: k.usuarioId ?? null,
    ...(k.fecha ? { fecha: k.fecha } : {}),
  });
}

/** Recalcula el costo promedio ponderado al ingresar unidades valorizadas (RN-12). */
export async function actualizarCostoPromedio(tx: Db, productoId: number, unidadesNuevas: number, costoNuevo: number) {
  const stockAntes = (await stockProducto(tx, productoId)) - unidadesNuevas;
  const [p] = await tx.select({ cp: producto.costoPromedio }).from(producto).where(eq(producto.id, productoId));
  const cpAntes = p?.cp ?? 0;
  const base = Math.max(stockAntes, 0);
  const nuevo = base + unidadesNuevas > 0 ? (base * cpAntes + unidadesNuevas * costoNuevo) / (base + unidadesNuevas) : costoNuevo;
  await tx.update(producto).set({ costoPromedio: Math.round(nuevo * 10000) / 10000 }).where(eq(producto.id, productoId));
  return { cpAntes, cpNuevo: nuevo };
}
