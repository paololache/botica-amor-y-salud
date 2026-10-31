import { and, asc, eq, gt, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima, r2, r4, sumarDias } from "../util";
import { estadoEfectivo } from "./campanas";

const { producto, presentacion, lote, categoria, campana, complemento, kardex, auditoria } = schema;

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

/** Búsqueda del punto de venta: código exacto (del producto o de una presentación), nombre o principio activo. */
export async function buscarProductos(db: Db, q: string, limite = 12) {
  const hoy = hoyLima();
  const t = q.trim();
  if (!t) return [];
  const patron = `%${t.replace(/[%_]/g, "")}%`;
  const [escaneada] = await db.select({ id: presentacion.id, productoId: presentacion.productoId }).from(presentacion).where(and(eq(presentacion.codigo, t), eq(presentacion.activo, true)));
  const porCodigo = or(eq(producto.codigo, t), escaneada ? eq(producto.id, escaneada.productoId) : undefined);
  const prods = await db.select().from(producto)
    .where(and(eq(producto.activo, true), or(porCodigo, ilike(producto.nombre, patron), ilike(producto.principioActivo, patron))))
    .orderBy(sql`case when ${porCodigo} then 0 when ${producto.nombre} ilike ${t + "%"} then 1 else 2 end`, asc(producto.nombre))
    .limit(limite);
  const lista = await enriquecer(db, prods, hoy);
  return lista.map((p) => ({ ...p, presentacionEscaneadaId: p.id === escaneada?.productoId ? escaneada.id : undefined }));
}

async function enriquecer(db: Db, prods: (typeof producto.$inferSelect)[], hoy: string) {
  const ids = prods.map((p) => p.id);
  const pres = ids.length ? await db.select().from(presentacion).where(and(inArray(presentacion.productoId, ids), eq(presentacion.activo, true))).orderBy(asc(presentacion.factor)) : [];
  const st = await stockYVencimiento(db, ids, hoy);
  const camps = await campanasDe(db, ids, hoy);
  return prods.map((p) => {
    const c = camps.get(p.id);
    return {
      id: p.id, codigo: p.codigo, nombre: p.nombre, principioActivo: p.principioActivo, concentracion: p.concentracion, formaFarmaceutica: p.formaFarmaceutica,
      registroSanitario: p.registroSanitario, registroVence: p.registroVence, laboratorio: p.laboratorio,
      condicionVenta: p.condicionVenta, ubicacion: p.ubicacion, stockMinimo: p.stockMinimo, costoPromedio: p.costoPromedio, porcentajeUtilidad: p.porcentajeUtilidad,
      stock: st.get(p.id)?.stock ?? 0, stockVigente: st.get(p.id)?.vigente ?? 0, proximoVencimiento: st.get(p.id)?.proxVenc ?? null,
      enPromocion: c?.estado === "ACTIVA", campana: c ?? null,
      presentaciones: pres.filter((x) => x.productoId === p.id).map((x) => ({ id: x.id, nombre: x.nombre, factor: x.factor, pvp: x.pvp, codigo: x.codigo })),
    };
  });
}

export async function listarStock(db: Db, opciones: { q?: string; categoriaId?: number; filtro?: string; pagina?: number }) {
  const hoy = hoyLima();
  const cond = [eq(producto.activo, true)];
  if (opciones.q) {
    const t = opciones.q.trim();
    const patron = `%${t}%`;
    cond.push(or(eq(producto.codigo, t), sql`exists (select 1 from presentacion pr where pr.producto_id = ${producto.id} and pr.codigo = ${t} and pr.activo)`, ilike(producto.nombre, patron), ilike(producto.principioActivo, patron), ilike(producto.laboratorio, patron))!);
  }
  if (opciones.categoriaId) cond.push(eq(producto.categoriaId, opciones.categoriaId));
  if (opciones.filtro === "promocion") cond.push(sql`exists (select 1 from campana c where c.producto_id = ${producto.id} and c.fin >= ${hoy} and (c.estado = 'ACTIVA' or (c.estado = 'PROGRAMADA' and c.inicio <= ${hoy})))`);
  if (opciones.filtro === "bajo") cond.push(sql`(select coalesce(sum(l.cantidad),0) from lote l where l.producto_id = ${producto.id} and l.estado = 'ACTIVO' and l.vencimiento > ${hoy}) <= ${producto.stockMinimo}`);
  if (opciones.filtro === "vencer") cond.push(sql`exists (select 1 from lote l where l.producto_id = ${producto.id} and l.cantidad > 0 and l.estado = 'ACTIVO' and l.vencimiento > ${hoy} and l.vencimiento <= ${sumarDias(hoy, 90)})`);
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
  return { ...e, categoriaId: p.categoriaId, tieneKardex: await tieneMovimientos(db, id), lotes: lotes.map((l) => ({ id: l.id, numero: l.numero, vencimiento: l.vencimiento, cantidad: l.cantidad, estado: l.estado, costoUnitario: l.costoUnitario })) };
}

async function tieneMovimientos(db: Db, id: number) {
  const [k] = await db.select({ id: kardex.id }).from(kardex).where(eq(kardex.productoId, id)).limit(1);
  return !!k;
}

const codigoBarras = z.string().trim().regex(/^[A-Za-z0-9-]{4,20}$/, "usa de 4 a 20 letras o números");
const empaque = z.object({ factor: z.number().int().min(2, "debe traer al menos 2 unidades"), pvp: z.number().positive("el precio debe ser mayor a 0"), codigo: codigoBarras.nullable().optional() });

export const esquemaProducto = z.object({
  codigo: codigoBarras,
  nombre: z.string().trim().min(3, "mínimo 3 caracteres").max(120),
  laboratorio: z.string().trim().min(2, "es obligatorio"),
  principioActivo: z.string().trim().nullable().optional(),
  concentracion: z.string().trim().nullable().optional(),
  formaFarmaceutica: z.string().trim().nullable().optional(),
  registroSanitario: z.string().trim().nullable().optional(),
  registroVence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida").nullable().optional(),
  porcentajeUtilidad: z.number().min(0).max(999).default(30),
  categoriaId: z.number().int().nullable().optional(),
  condicionVenta: z.enum(["LIBRE", "RECETA", "RECETA_RETENIDA"]).default("LIBRE"),
  stockMinimo: z.number().int().min(0).default(0),
  costoUnitario: z.number().min(0),
  precioUnidad: z.number().positive("el precio debe ser mayor a 0"),
  blister: empaque.nullable().optional(),
  caja: empaque.nullable().optional(),
}).refine((d) => !d.blister || !d.caja || d.blister.factor !== d.caja.factor, { message: "el blíster y la caja no pueden traer las mismas unidades", path: ["caja"] })
  .refine((d) => new Set(codigosDe(d)).size === codigosDe(d).length, { message: "cada presentación necesita un código distinto", path: ["codigo"] })
  .refine((d) => !d.registroVence || !!d.registroSanitario, { message: "indica el número de registro sanitario", path: ["registroSanitario"] });
type EntradaProducto = z.infer<typeof esquemaProducto>;

function codigosDe(d: { codigo: string; blister?: { codigo?: string | null } | null; caja?: { codigo?: string | null } | null }) {
  return [d.codigo, d.blister?.codigo, d.caja?.codigo].filter((c): c is string => !!c);
}

function presentacionesDe(d: EntradaProducto) {
  return [
    { nombre: "Unidad", factor: 1, pvp: r2(d.precioUnidad), codigo: null },
    ...(d.blister ? [{ nombre: `Blíster x${d.blister.factor}`, factor: d.blister.factor, pvp: r2(d.blister.pvp), codigo: d.blister.codigo ?? null }] : []),
    ...(d.caja ? [{ nombre: `Caja x${d.caja.factor}`, factor: d.caja.factor, pvp: r2(d.caja.pvp), codigo: d.caja.codigo ?? null }] : []),
  ];
}

/** Un código identifica a una sola presentación en todo el catálogo: se valida contra productos y presentaciones. */
async function validarCodigosLibres(db: Db, codigos: string[], excepto?: number) {
  const [otro] = await db.select({ nombre: producto.nombre, codigo: producto.codigo }).from(producto)
    .where(excepto ? and(inArray(producto.codigo, codigos), ne(producto.id, excepto)) : inArray(producto.codigo, codigos));
  if (otro) throw new ErrorNegocio("CODIGO_DUPLICADO", `El código ${otro.codigo} ya pertenece a «${otro.nombre}».`, 409);
  const [otraPres] = await db.select({ nombre: producto.nombre, codigo: presentacion.codigo }).from(presentacion).innerJoin(producto, eq(producto.id, presentacion.productoId))
    .where(excepto ? and(inArray(presentacion.codigo, codigos), ne(presentacion.productoId, excepto)) : inArray(presentacion.codigo, codigos));
  if (otraPres) throw new ErrorNegocio("CODIGO_DUPLICADO", `El código ${otraPres.codigo} ya pertenece a «${otraPres.nombre}».`, 409);
}

const datosProducto = (d: EntradaProducto) => ({
  codigo: d.codigo, nombre: d.nombre, laboratorio: d.laboratorio, principioActivo: d.principioActivo || null, concentracion: d.concentracion || null,
  formaFarmaceutica: d.formaFarmaceutica || null, registroSanitario: d.registroSanitario || null, registroVence: d.registroVence || null,
  categoriaId: d.categoriaId ?? null, condicionVenta: d.condicionVenta, stockMinimo: d.stockMinimo, porcentajeUtilidad: d.porcentajeUtilidad,
});

/** El producto nace con stock 0: las unidades entran por Compras, con lote y vencimiento, para que el kardex cuadre. */
export async function crearProducto(db: Db, user: Sesion, d: EntradaProducto) {
  await validarCodigosLibres(db, codigosDe(d));
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(producto).values({ ...datosProducto(d), costoPromedio: r4(d.costoUnitario) }).returning({ id: producto.id });
    await tx.insert(presentacion).values(presentacionesDe(d).map((x) => ({ ...x, productoId: p.id })));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "CREAR_PRODUCTO", entidad: "producto", entidadId: p.id, detalle: { codigo: d.codigo, nombre: d.nombre } });
    return { id: p.id };
  });
}

/** Una presentación que ya no se usa se desactiva, no se borra: las ventas pasadas la siguen citando. */
export async function editarProducto(db: Db, user: Sesion, id: number, d: EntradaProducto) {
  const [p] = await db.select().from(producto).where(eq(producto.id, id));
  if (!p) throw new ErrorNegocio("NO_EXISTE", "El producto no existe.", 404);
  await validarCodigosLibres(db, codigosDe(d), id);
  // Con movimientos, el costo lo calculan las compras (promedio ponderado) y no se edita a mano.
  const costoPromedio = (await tieneMovimientos(db, id)) ? p.costoPromedio : r4(d.costoUnitario);
  const nuevas = presentacionesDe(d);
  await db.transaction(async (tx) => {
    await tx.update(producto).set({ ...datosProducto(d), costoPromedio }).where(eq(producto.id, id));
    const actuales = await tx.select().from(presentacion).where(eq(presentacion.productoId, id));
    // Se liberan primero: así se pueden intercambiar códigos, y una presentación quitada no retiene el suyo.
    await tx.update(presentacion).set({ codigo: null }).where(eq(presentacion.productoId, id));
    for (const n of nuevas) {
      const a = actuales.find((x) => x.factor === n.factor);
      if (a) await tx.update(presentacion).set({ nombre: n.nombre, pvp: n.pvp, codigo: n.codigo, activo: true }).where(eq(presentacion.id, a.id));
      else await tx.insert(presentacion).values({ ...n, productoId: id });
    }
    const quitar = actuales.filter((a) => !nuevas.some((n) => n.factor === a.factor)).map((a) => a.id);
    if (quitar.length) await tx.update(presentacion).set({ activo: false }).where(inArray(presentacion.id, quitar));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "EDITAR_PRODUCTO", entidad: "producto", entidadId: id, detalle: { antes: { codigo: p.codigo, nombre: p.nombre, costoPromedio: p.costoPromedio }, despues: { codigo: d.codigo, nombre: d.nombre, costoPromedio }, precios: nuevas } });
  });
  return { id };
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
