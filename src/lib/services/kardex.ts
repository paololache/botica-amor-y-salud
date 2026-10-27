import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { ErrorNegocio, hoy as hoyLima, inicioDiaLima, sumarDias } from "../util";

const { kardex, producto, lote, usuario } = schema;

export async function consultarKardex(db: Db, productoId: number, desde?: string, hasta?: string, loteId?: number) {
  const h = hasta ?? hoyLima();
  const d = desde ?? sumarDias(h, -30);
  const [p] = await db.select().from(producto).where(eq(producto.id, productoId));
  if (!p) throw new ErrorNegocio("NO_EXISTE", "El producto no existe.", 404);
  const ini = inicioDiaLima(d); const fin = inicioDiaLima(sumarDias(h, 1));
  const [previo] = await db.select().from(kardex).where(and(eq(kardex.productoId, productoId), lt(kardex.fecha, ini))).orderBy(desc(kardex.fecha), desc(kardex.id)).limit(1);
  const cond = [eq(kardex.productoId, productoId), gte(kardex.fecha, ini), lt(kardex.fecha, fin)];
  if (loteId) cond.push(eq(kardex.loteId, loteId));
  const lineas = await db.select({
    id: kardex.id, fecha: kardex.fecha, tipo: kardex.tipo, motivo: kardex.motivo, documentoTipo: kardex.documentoTipo, documentoRef: kardex.documentoRef,
    lote: lote.numero, vencimiento: lote.vencimiento, entrada: kardex.entrada, salida: kardex.salida, costoUnitario: kardex.costoUnitario,
    saldoUnidades: kardex.saldoUnidades, costoPromedio: kardex.costoPromedio, saldoValorizado: kardex.saldoValorizado, usuario: usuario.nombre,
  }).from(kardex).leftJoin(lote, eq(lote.id, kardex.loteId)).leftJoin(usuario, eq(usuario.id, kardex.usuarioId))
    .where(and(...cond)).orderBy(asc(kardex.fecha), asc(kardex.id)).limit(2000);
  const ultima = lineas[lineas.length - 1];
  const [tot] = await db.select({ e: sql<number>`coalesce(sum(${kardex.entrada}),0)`.mapWith(Number), s: sql<number>`coalesce(sum(${kardex.salida}),0)`.mapWith(Number) })
    .from(kardex).where(and(...cond));
  const lotes = await db.select({ id: lote.id, numero: lote.numero, vencimiento: lote.vencimiento, cantidad: lote.cantidad }).from(lote).where(eq(lote.productoId, productoId)).orderBy(asc(lote.vencimiento));
  return {
    producto: { id: p.id, codigo: p.codigo, nombre: p.nombre }, desde: d, hasta: h, lotes,
    saldoInicial: { saldoUnidades: previo?.saldoUnidades ?? 0, saldoValorizado: previo?.saldoValorizado ?? 0 },
    lineas,
    totales: { entradas: tot?.e ?? 0, salidas: tot?.s ?? 0 },
    saldoFinal: { saldoUnidades: ultima?.saldoUnidades ?? previo?.saldoUnidades ?? 0, saldoValorizado: ultima?.saldoValorizado ?? previo?.saldoValorizado ?? 0 },
  };
}

export { lte };
