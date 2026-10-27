import { and, asc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { hoy as hoyLima } from "../util";
import { estadoEfectivo } from "./campanas";

const { producto, presentacion, lote, categoria, campana, complemento } = schema;

async function stockYVencimiento(db: Db, ids: number[], hoy: string) {
  if (!ids.length) return new Map<number, { stock: number; vigente: number; proxVenc: string | null }>();
  const rows = await db.select({
    productoId: lote.productoId,
    stock: sql<number>`coalesce(sum(${lote.cantidad}),0)`.mapWith(Number),
    vigente: sql<number>`coalesce(sum(case when ${lote.estado} = 'ACTIVO' and ${lote.vencimiento} > ${hoy} then ${lote.cantidad} else 0 end),0)`.mapWith(Number),
    proxVenc: sql<string | null>`min(case when ${lote.cantidad} > 0 and ${lote.vencimiento} > ${hoy} then ${lote.vencimiento} end)`,
  }).from(lote).where(inArray(lote.productoId, ids)).groupBy(lote.productoId);
  return new Map(rows.map((r) => [r.productoId, { stock: r.stock, vigente: r.vigente, proxVenc: r.proxVenc ? String(r.proxVenc).slice(0, 10) : null }]));
}

async function campanasDe(db: Db, ids: number[], hoy: string) {
  if (!ids.length) return new Map<number, { id: number; porcentaje: number; estado: string; inicio: string; fin: string; nombre: string }>();
  const rows = await db.select().from(campana).where(and(inArray(campana.productoId, ids), inArray(campana.estado, ["PROGRAMADA", "ACTIVA", "PAUSADA"]), sql`${campana.fin} >= ${hoy}`));
  const m = new Map<number, { id: number; porcentaje: number; estado: string; inicio: string; fin: string; nombre: string }>();
  for (const c of rows) m.set(c.productoId, { id: c.id, porcentaje: c.porcentaje, estado: estadoEfectivo(c, hoy), inicio: c.inicio, fin: c.fin, nombre: c.nombre });
  return m;
}

/** Búsqueda del punto de venta: código exacto, nombre o principio activo. */
export async function buscarProductos(db: Db, q: string, limite = 12) {
  const hoy = hoyLima();
  const t = q.trim();
  if (!t) return [];
  const patron = `%${t.replace(/[%_]/g, "")}%`;
  const prods = await db.select().from(producto)
    .where(and(eq(producto.activo, true), or(eq(producto.codigo, t), ilike(producto.nombre, patron), ilike(producto.principioActivo, patron))))
    .orderBy(sql`case when ${producto.codigo} = ${t} then 0 when ${producto.nombre} ilike ${t + "%"} then 1 else 2 end`, asc(producto.nombre))
    .limit(limite);
  return enriquecer(db, prods, hoy);
}

async function enriquecer(db: Db, prods: (typeof producto.$inferSelect)[], hoy: string) {
  const ids = prods.map((p) => p.id);
  const pres = ids.length ? await db.select().from(presentacion).where(and(inArray(presentacion.productoId, ids), eq(presentacion.activo, true))).orderBy(asc(presentacion.factor)) : [];
  const st = await stockYVencimiento(db, ids, hoy);
  const camps = await campanasDe(db, ids, hoy);
  return prods.map((p) => {
    const c = camps.get(p.id);
    return {
      id: p.id, codigo: p.codigo, nombre: p.nombre, principioActivo: p.principioActivo, concentracion: p.concentracion, laboratorio: p.laboratorio,
      condicionVenta: p.condicionVenta, ubicacion: p.ubicacion, stockMinimo: p.stockMinimo, costoPromedio: p.costoPromedio, porcentajeUtilidad: p.porcentajeUtilidad,
      stock: st.get(p.id)?.stock ?? 0, stockVigente: st.get(p.id)?.vigente ?? 0, proximoVencimiento: st.get(p.id)?.proxVenc ?? null,
      enPromocion: c?.estado === "ACTIVA", campana: c ?? null,
      presentaciones: pres.filter((x) => x.productoId === p.id).map((x) => ({ id: x.id, nombre: x.nombre, factor: x.factor, pvp: x.pvp })),
    };
  });
}

export async function listarStock(db: Db, opciones: { q?: string; categoriaId?: number; filtro?: string; pagina?: number }) {
  const hoy = hoyLima();
  const cond = [eq(producto.activo, true)];
  if (opciones.q) {
    const patron = `%${opciones.q.trim()}%`;
    cond.push(or(eq(producto.codigo, opciones.q.trim()), ilike(producto.nombre, patron), ilike(producto.principioActivo, patron))!);
  }
  if (opciones.categoriaId) cond.push(eq(producto.categoriaId, opciones.categoriaId));
  if (opciones.filtro === "promocion") cond.push(sql`exists (select 1 from campana c where c.producto_id = ${producto.id} and c.fin >= ${hoy} and (c.estado = 'ACTIVA' or (c.estado = 'PROGRAMADA' and c.inicio <= ${hoy})))`);
  if (opciones.filtro === "bajo") cond.push(sql`(select coalesce(sum(l.cantidad),0) from lote l where l.producto_id = ${producto.id}) <= ${producto.stockMinimo}`);
  const pagina = Math.max(1, opciones.pagina ?? 1);
  const prods = await db.select().from(producto).where(and(...cond)).orderBy(asc(producto.nombre)).limit(50).offset((pagina - 1) * 50);
  const [tot] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(producto).where(and(...cond));
  const cats = await db.select().from(categoria).orderBy(categoria.nombre);
  const lista = await enriquecer(db, prods, hoy);
  const catMap = new Map(cats.map((c) => [c.id, c.nombre]));
  return { productos: lista.map((p, i) => ({ ...p, categoria: catMap.get(prods[i].categoriaId ?? 0) ?? null })), total: tot?.n ?? 0, pagina, categorias: cats };
}

export async function fichaProducto(db: Db, id: number) {
  const hoy = hoyLima();
  const [p] = await db.select().from(producto).where(eq(producto.id, id));
  if (!p) return null;
  const [e] = await enriquecer(db, [p], hoy);
  const lotes = await db.select().from(lote).where(eq(lote.productoId, id)).orderBy(asc(lote.vencimiento));
  return { ...e, lotes: lotes.map((l) => ({ id: l.id, numero: l.numero, vencimiento: l.vencimiento, cantidad: l.cantidad, estado: l.estado, costoUnitario: l.costoUnitario })) };
}

/** Complementos con stock para lo que hay en el carrito; primero los que están en campaña activa. */
export async function sugerirComplementos(db: Db, productoIds: number[], limite = 3) {
  const hoy = hoyLima();
  if (!productoIds.length) return [];
  const origen = await db.select({ id: producto.id, pa: producto.principioActivo, cat: producto.categoriaId }).from(producto).where(inArray(producto.id, productoIds));
  const claves: ReturnType<typeof and>[] = [];
  for (const o of origen) {
    claves.push(and(eq(complemento.origenTipo, "PRODUCTO"), eq(complemento.origenValor, String(o.id))));
    if (o.pa) claves.push(and(eq(complemento.origenTipo, "PRINCIPIO_ACTIVO"), ilike(complemento.origenValor, o.pa)));
    if (o.cat) claves.push(and(eq(complemento.origenTipo, "CATEGORIA"), eq(complemento.origenValor, String(o.cat))));
  }
  const cands = await db.select().from(complemento).where(or(...claves));
  const ids = [...new Set(cands.map((c) => c.productoId))].filter((id) => !productoIds.includes(id));
  if (!ids.length) return [];
  const prods = await db.select().from(producto).where(and(inArray(producto.id, ids), eq(producto.activo, true)));
  const lista = (await enriquecer(db, prods, hoy)).filter((p) => p.stockVigente > 0);
  const msg = new Map(cands.map((c) => [c.productoId, c]));
  return lista
    .map((p) => ({ ...p, mensaje: msg.get(p.id)?.mensaje ?? null, prioridad: (p.enPromocion ? 0 : 10) + (msg.get(p.id)?.prioridad ?? 5) }))
    .sort((a, b) => a.prioridad - b.prioridad)
    .slice(0, limite);
}

export async function listarComplementos(db: Db) {
  const rows = await db.select({ id: complemento.id, origenTipo: complemento.origenTipo, origenValor: complemento.origenValor, productoId: complemento.productoId, producto: producto.nombre, mensaje: complemento.mensaje, prioridad: complemento.prioridad })
    .from(complemento).innerJoin(producto, eq(producto.id, complemento.productoId)).orderBy(asc(complemento.prioridad));
  return rows;
}

export { gt };
