import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { filas } from "../sqlrows";
import { ErrorNegocio, r2 } from "../util";
import { texto } from "../validacion";
import { campanasVigentes } from "./campanas";
import { parametros } from "./parametros";

const { cliente, auditoria } = schema;

export type Nivel = "NUEVO" | "OCASIONAL" | "FRECUENTE" | "PREFERENTE";
export const NIVELES: Record<Nivel, string> = { NUEVO: "Cliente nuevo", OCASIONAL: "Cliente ocasional", FRECUENTE: "Cliente frecuente", PREFERENTE: "Cliente preferente" };

/** Nivel por cantidad de compras: con más de `umbral` compras es preferente y se le ofrecen promociones. */
export function nivelCliente(compras: number, umbral = 10): Nivel {
  if (compras > umbral) return "PREFERENTE";
  if (compras >= 5) return "FRECUENTE";
  if (compras >= 2) return "OCASIONAL";
  return "NUEVO";
}

type Resumen = { compras: number; total: number; ultima: string | null; servicios: number };
async function resumenes(db: Db, ids: number[]) {
  if (!ids.length) return new Map<number, Resumen>();
  const rows = await filas<{ cliente_id: number; compras: string; total: string; ultima: string | null; servicios: string }>(db, sql`
    select c.id as cliente_id,
      (select count(*) from venta v where v.cliente_id = c.id and v.estado = 'EMITIDA') as compras,
      (select coalesce(sum(v.total - v.delivery), 0) from venta v where v.cliente_id = c.id and v.estado = 'EMITIDA') as total,
      (select max(v.fecha) from venta v where v.cliente_id = c.id and v.estado = 'EMITIDA') as ultima,
      (select count(*) from atencion_servicio a where a.cliente_id = c.id and a.estado = 'REGISTRADA') as servicios
    from cliente c where c.id in ${sql.raw(`(${ids.map(Number).join(",")})`)}`);
  return new Map(rows.map((r) => [Number(r.cliente_id), { compras: Number(r.compras), total: r2(Number(r.total)), ultima: r.ultima, servicios: Number(r.servicios) }]));
}

/**
 * Al escribir el DNI en Vender: quién es, cuántas veces compró y su nivel. Si es preferente (más de 10 compras),
 * se le ofrecen primero los productos en promoción (los que ya compró van arriba) y luego sus productos habituales.
 */
export async function consultarCliente(db: Db, numero: string) {
  const [c] = await db.select().from(cliente).where(eq(cliente.numero, numero.trim()));
  if (!c) return { encontrado: false as const };
  const { cliente_ofertas_desde: umbral } = await parametros(db);
  const r = (await resumenes(db, [c.id])).get(c.id) ?? { compras: 0, total: 0, ultima: null, servicios: 0 };
  const nivel = nivelCliente(r.compras, umbral);
  const habituales = await filas<{ producto_id: number; nombre: string; veces: string; unidades: string }>(db, sql`
    select vd.producto_id, p.nombre, count(distinct v.id) as veces, sum(vd.unidades) as unidades
    from venta_detalle vd join venta v on v.id = vd.venta_id join producto p on p.id = vd.producto_id
    where v.cliente_id = ${c.id} and v.estado = 'EMITIDA' and p.activo
    group by vd.producto_id, p.nombre order by 3 desc, 4 desc limit 5`);
  let ofertas: { productoId: number; producto: string; codigo: string; porcentaje: number; fin: string; precio: { presentacion: string; campana: number; lista: number } | null; yaLoCompro: boolean }[] = [];
  if (nivel === "PREFERENTE") {
    const compro = new Set(habituales.map((h) => Number(h.producto_id)));
    const todosComprados = new Set((await filas<{ producto_id: number }>(db, sql`
      select distinct vd.producto_id from venta_detalle vd join venta v on v.id = vd.venta_id where v.cliente_id = ${c.id} and v.estado = 'EMITIDA'`)).map((x) => Number(x.producto_id)));
    ofertas = (await campanasVigentes(db))
      .map((p) => ({ productoId: p.productoId, producto: p.producto, codigo: p.codigo, porcentaje: p.porcentaje, fin: p.fin, precio: p.precio, yaLoCompro: todosComprados.has(p.productoId) || compro.has(p.productoId) }))
      .sort((a, b) => Number(b.yaLoCompro) - Number(a.yaLoCompro) || (b.precio ? b.precio.lista - b.precio.campana : 0) - (a.precio ? a.precio.lista - a.precio.campana : 0))
      .slice(0, 6);
  }
  return {
    encontrado: true as const,
    cliente: { id: c.id, tipoDoc: c.tipoDoc, numero: c.numero, nombre: c.nombre, telefono: c.telefono, notas: c.notas },
    ...r, nivel, nivelNombre: NIVELES[nivel], umbralOfertas: umbral, faltanParaOfertas: Math.max(0, umbral + 1 - r.compras),
    ofertas,
    habituales: habituales.map((h) => ({ productoId: Number(h.producto_id), nombre: h.nombre, veces: Number(h.veces) })),
  };
}

export async function listarClientes(db: Db, q: { buscar?: string; nivel?: Nivel }) {
  const t = q.buscar?.trim();
  const base = await db.select().from(cliente)
    .where(t ? sql`(${cliente.nombre} ilike ${"%" + t + "%"} or ${cliente.numero} like ${t + "%"} or ${cliente.telefono} like ${"%" + t + "%"})` : undefined)
    .orderBy(desc(cliente.id)).limit(2000);
  const { cliente_ofertas_desde: umbral } = await parametros(db);
  const res = await resumenes(db, base.map((c) => c.id));
  const lista = base.map((c) => {
    const r = res.get(c.id) ?? { compras: 0, total: 0, ultima: null, servicios: 0 };
    return { ...c, ...r, nivel: nivelCliente(r.compras, umbral) };
  }).filter((c) => !q.nivel || c.nivel === q.nivel)
    .sort((a, b) => b.compras - a.compras || (b.ultima ?? "").localeCompare(a.ultima ?? ""));
  const conteo = Object.fromEntries((Object.keys(NIVELES) as Nivel[]).map((n) => [n, 0])) as Record<Nivel, number>;
  for (const c of base) conteo[nivelCliente(res.get(c.id)?.compras ?? 0, umbral)]++;
  return { umbralOfertas: umbral, conteo, clientes: lista.slice(0, 300) };
}

export async function detalleCliente(db: Db, id: number) {
  const [c] = await db.select().from(cliente).where(eq(cliente.id, id));
  if (!c) throw new ErrorNegocio("NO_EXISTE", "El cliente no existe.", 404);
  const compras = await filas<{ id: number; fecha: string; serie: string; numero: number; total: string; tipo: string; vendedor: string; productos: string }>(db, sql`
    select v.id, v.fecha, v.serie, v.numero, v.total - v.delivery as total, v.tipo_comprobante as tipo, u.nombre as vendedor,
      (select string_agg(distinct p.nombre, ', ') from venta_detalle d join producto p on p.id = d.producto_id where d.venta_id = v.id) as productos
    from venta v join usuario u on u.id = v.usuario_id where v.cliente_id = ${id} and v.estado = 'EMITIDA' order by v.fecha desc limit 50`);
  const consulta = await consultarCliente(db, c.numero);
  return { ...consulta, historial: compras.map((x) => ({ ...x, total: r2(Number(x.total)) })) };
}

export const esquemaCliente = z.object({
  tipoDoc: z.enum(["DNI", "RUC", "CE"]),
  numero: z.string().trim(),
  nombre: texto(3, "escribe el nombre").max(120),
  telefono: z.string().trim().regex(/^\d{6,9}$/, "teléfono de 6 a 9 dígitos").optional().or(z.literal("")),
  email: z.string().trim().email("correo no válido").optional().or(z.literal("")),
  notas: z.string().trim().max(500).optional(),
}).refine((c) => (c.tipoDoc === "DNI" ? /^\d{8}$/.test(c.numero) : c.tipoDoc === "RUC" ? /^(10|20)\d{9}$/.test(c.numero) : /^[A-Z0-9]{9,12}$/i.test(c.numero)),
  { message: "documento no válido para el tipo elegido", path: ["numero"] });

/** Alta o edición del cliente; el documento es la llave (en Vender también se registra solo al escribir el DNI). */
export async function guardarCliente(db: Db, user: Sesion, input: z.infer<typeof esquemaCliente>, id?: number) {
  const datos = { tipoDoc: input.tipoDoc, numero: input.numero, nombre: input.nombre, telefono: input.telefono || null, email: input.email || null, notas: input.notas || null };
  const [otro] = await db.select({ id: cliente.id }).from(cliente).where(eq(cliente.numero, input.numero));
  if (otro && otro.id !== id) throw new ErrorNegocio("DUPLICADO", "Ya hay un cliente con ese documento.", 409);
  const [c] = id
    ? await db.update(cliente).set(datos).where(eq(cliente.id, id)).returning()
    : await db.insert(cliente).values(datos).returning();
  if (!c) throw new ErrorNegocio("NO_EXISTE", "El cliente no existe.", 404);
  await db.insert(auditoria).values({ usuarioId: user.id, accion: id ? "EDITAR_CLIENTE" : "CREAR_CLIENTE", entidad: "cliente", entidadId: c.id, detalle: { numero: c.numero } });
  return c;
}

