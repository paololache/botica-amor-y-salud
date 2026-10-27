import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { verCostos, type Rol } from "../permisos";
import { evaluar, validarFormula, variables } from "../formula";
import { filas } from "../sqlrows";
import { diasEntre, ErrorNegocio, hoy as hoyLima, inicioDiaLima, r2, sumarDias } from "../util";
import { listarSesiones } from "./caja";

const { metrica, reporteGuardado } = schema;

/** Métricas base: expresiones SQL fijas (lista blanca) sobre las líneas de venta emitidas. */
export const BASE: Record<string, { nombre: string; unidad: string; sql: string; sensible?: boolean }> = {
  ventas: { nombre: "Ventas S/", unidad: "SOLES", sql: "sum(vd.subtotal)" },
  unidades: { nombre: "Unidades", unidad: "UNIDADES", sql: "sum(vd.unidades)" },
  tickets: { nombre: "Tickets", unidad: "NUMERO", sql: "count(distinct v.id)" },
  tickets_complemento: { nombre: "Tickets con complemento", unidad: "NUMERO", sql: "count(distinct case when vd.origen = 'SUGERENCIA' then v.id end)" },
  descuentos: { nombre: "Descuentos S/", unidad: "SOLES", sql: "sum(vd.descuento)" },
  comision: { nombre: "Comisión S/", unidad: "SOLES", sql: "coalesce(sum(c.monto), 0)" },
  ventas_campana: { nombre: "Ventas en campaña S/", unidad: "SOLES", sql: "sum(case when c.id is not null then vd.subtotal else 0 end)" },
  costo_ventas: { nombre: "Costo de ventas S/", unidad: "SOLES", sql: "sum(vd.costo_unitario * vd.unidades)", sensible: true },
};

export const DIMENSIONES: Record<string, { nombre: string; sql: string }> = {
  total: { nombre: "Total", sql: "'Total'" },
  categoria: { nombre: "Categoría", sql: "coalesce(cat.nombre, 'Sin categoría')" },
  producto: { nombre: "Producto", sql: "p.nombre" },
  laboratorio: { nombre: "Laboratorio", sql: "coalesce(p.laboratorio, '—')" },
  vendedor: { nombre: "Vendedor", sql: "u.nombre" },
  dia: { nombre: "Día", sql: "to_char(v.fecha at time zone 'America/Lima', 'YYYY-MM-DD')" },
  semana: { nombre: "Semana", sql: "to_char(date_trunc('week', v.fecha at time zone 'America/Lima'), 'YYYY-MM-DD')" },
  mes: { nombre: "Mes", sql: "to_char(v.fecha at time zone 'America/Lima', 'YYYY-MM')" },
  comprobante: { nombre: "Comprobante", sql: "v.tipo_comprobante::text" },
  campana: { nombre: "Campaña", sql: "coalesce(cam.nombre, 'Sin campaña')" },
  hora: { nombre: "Hora", sql: "to_char(v.fecha at time zone 'America/Lima', 'HH24') || ':00'" },
};

export const CATALOGO = [
  { id: "ventas-categoria", nombre: "Ventas por categoría", tipo: "ventas", config: { agrupar: "categoria", metricas: ["ventas", "unidades", "tickets", "ticket_promedio", "tasa_complemento"] } },
  { id: "ventas-dia", nombre: "Ventas por día", tipo: "ventas", config: { agrupar: "dia", metricas: ["ventas", "tickets", "ticket_promedio"] } },
  { id: "ventas-hora", nombre: "Ventas por hora del día", tipo: "ventas", config: { agrupar: "hora", metricas: ["ventas", "tickets"] } },
  { id: "mas-vendidos", nombre: "Más vendidos", tipo: "ventas", config: { agrupar: "producto", metricas: ["unidades", "ventas"], orden: "unidades", limite: 30 } },
  { id: "ventas-vendedor", nombre: "Ventas y comisiones por vendedor", tipo: "ventas", config: { agrupar: "vendedor", metricas: ["ventas", "tickets", "ticket_promedio", "comision"] } },
  { id: "comisiones-campana", nombre: "Comisiones por campaña", tipo: "ventas", config: { agrupar: "campana", metricas: ["ventas_campana", "unidades", "comision"], filtros: { soloCampana: "1" } } },
  { id: "margen-categoria", nombre: "Margen por categoría", tipo: "ventas", soloCostos: true, config: { agrupar: "categoria", metricas: ["ventas_sin_igv", "costo_ventas", "margen_pct"] } },
  { id: "por-vencer", nombre: "Productos por vencer", tipo: "especial" },
  { id: "stock-critico", nombre: "Stock por terminarse y bajo mínimo", tipo: "especial" },
  { id: "salidas-motivo", nombre: "Salidas por motivo", tipo: "especial" },
  { id: "cierres-caja", nombre: "Cierres de caja", tipo: "especial" },
] as const;

type Derivada = { codigo: string; nombre: string; formula: string; unidad: string; roles: string[]; sensible: boolean; enPanel: boolean; id?: number };

export function esSensible(formula: string): boolean {
  return variables(formula).some((v) => BASE[v]?.sensible);
}

export async function metricasDisponibles(db: Db, rol: Rol) {
  const der = await db.select().from(metrica).orderBy(metrica.id);
  const costos = verCostos(rol);
  const base = Object.entries(BASE).filter(([, b]) => costos || !b.sensible).map(([codigo, b]) => ({ codigo, nombre: b.nombre, unidad: b.unidad, tipo: "BASE", sensible: !!b.sensible }));
  const derivadas: (Derivada & { tipo: string })[] = der
    .map((d) => ({ id: d.id, codigo: d.codigo, nombre: d.nombre, formula: d.formula, unidad: d.unidad, roles: d.roles, enPanel: d.enPanel, sensible: esSensible(d.formula), tipo: "PERSONALIZADA" }))
    .filter((d) => (costos || !d.sensible) && (rol === "ADMIN" || d.roles.includes(rol)));
  return { base, derivadas, dimensiones: Object.entries(DIMENSIONES).map(([codigo, d]) => ({ codigo, nombre: d.nombre })) };
}

export const esquemaConsulta = z.object({
  agrupar: z.string().default("total"),
  metricas: z.array(z.string()).min(1).max(10),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  filtros: z.record(z.string(), z.string()).optional(),
  orden: z.string().optional(),
  limite: z.number().int().min(1).max(500).optional(),
});

export async function ejecutarReporte(db: Db, rol: Rol, q: z.infer<typeof esquemaConsulta>) {
  const dim = DIMENSIONES[q.agrupar];
  if (!dim) throw new ErrorNegocio("DIMENSION", "Agrupación no válida.");
  const disp = await metricasDisponibles(db, rol);
  const derivadas = new Map(disp.derivadas.map((d) => [d.codigo, d]));
  const baseOk = new Set(disp.base.map((b) => b.codigo));
  const necesarias = new Set<string>();
  const columnas = q.metricas.map((codigo) => {
    if (baseOk.has(codigo)) { necesarias.add(codigo); return { codigo, nombre: BASE[codigo].nombre, unidad: BASE[codigo].unidad }; }
    const d = derivadas.get(codigo);
    if (!d) throw new ErrorNegocio("METRICA", `La métrica «${codigo}» no existe o no está disponible para tu rol.`, 403);
    for (const v of variables(d.formula)) necesarias.add(v);
    return { codigo, nombre: d.nombre, unidad: d.unidad };
  });
  const h = q.hasta ?? hoyLima();
  const dsd = q.desde ?? sumarDias(h, -29);
  if (diasEntre(dsd, h) > 400) throw new ErrorNegocio("RANGO", "El periodo máximo es de 13 meses.");
  const conds: SQL[] = [sql`v.estado = 'EMITIDA'`, sql`v.fecha >= ${inicioDiaLima(dsd).toISOString()}`, sql`v.fecha < ${inicioDiaLima(sumarDias(h, 1)).toISOString()}`];
  const f = q.filtros ?? {};
  if (f.categoriaId) conds.push(sql`p.categoria_id = ${Number(f.categoriaId)}`);
  if (f.vendedorId) conds.push(sql`v.usuario_id = ${Number(f.vendedorId)}`);
  if (f.comprobante) conds.push(sql`v.tipo_comprobante::text = ${f.comprobante}`);
  if (f.soloCampana) conds.push(sql`c.id is not null`);
  const selects = [...necesarias].map((m) => `${BASE[m].sql} as "${m}"`).join(", ");
  const consulta = (agr: string) => sql`
    select ${sql.raw(agr)} as grupo, ${sql.raw(selects)}
    from venta_detalle vd
    join venta v on v.id = vd.venta_id
    join producto p on p.id = vd.producto_id
    left join categoria cat on cat.id = p.categoria_id
    join usuario u on u.id = v.usuario_id
    left join comision c on c.venta_detalle_id = vd.id and c.estado <> 'REVERTIDA' and c.origen <> 'AJUSTE'
    left join campana cam on cam.id = c.campana_id
    where ${sql.join(conds, sql` and `)}
    group by 1`;
  const calcular = (r: Record<string, unknown>) => {
    const vars: Record<string, number | null> = {};
    for (const m of necesarias) vars[m] = Number(r[m] ?? 0);
    const valores: Record<string, number | null> = {};
    for (const c of columnas) {
      const d = derivadas.get(c.codigo);
      const val = d ? evaluar(d.formula, vars) : vars[c.codigo];
      valores[c.codigo] = val === null ? null : c.unidad === "UNIDADES" || c.unidad === "NUMERO" ? Math.round(val * 100) / 100 : r2(val);
    }
    return valores;
  };
  const rows = await filas<Record<string, unknown>>(db, consulta(dim.sql));
  const [tot] = await filas<Record<string, unknown>>(db, consulta("'Total'"));
  let resultado = rows.map((r) => ({ grupo: String(r.grupo), valores: calcular(r) }));
  const orden = q.orden ?? (q.agrupar === "dia" || q.agrupar === "mes" || q.agrupar === "semana" || q.agrupar === "hora" ? "grupo" : q.metricas[0]);
  resultado.sort((a, b) => orden === "grupo" ? a.grupo.localeCompare(b.grupo) : (b.valores[orden] ?? -Infinity) - (a.valores[orden] ?? -Infinity));
  if (q.limite) resultado = resultado.slice(0, q.limite);
  return { desde: dsd, hasta: h, agrupar: { codigo: q.agrupar, nombre: dim.nombre }, columnas, filas: resultado, totales: tot ? calcular(tot) : null };
}

export async function reporteEspecial(db: Db, user: Sesion, id: string, q: { desde?: string; hasta?: string; dias?: number }) {
  const hoy = hoyLima();
  if (id === "por-vencer") {
    const dias = q.dias ?? 90;
    const rows = await filas<Record<string, unknown>>(db, sql`
      select p.nombre as producto, p.codigo, l.numero as lote, l.vencimiento::text as vencimiento, l.cantidad, l.costo_unitario as "costoUnitario", l.estado
      from lote l join producto p on p.id = l.producto_id
      where l.cantidad > 0 and l.vencimiento <= ${sumarDias(hoy, dias)} order by l.vencimiento`);
    return { columnas: ["Producto", "Lote", "Vence", "Días", "Unidades", "Acción sugerida"], filas: rows.map((r) => {
      const d = diasEntre(hoy, String(r.vencimiento).slice(0, 10));
      return { producto: r.producto, codigo: r.codigo, lote: r.lote, vencimiento: String(r.vencimiento).slice(0, 10), dias: d, unidades: Number(r.cantidad), accion: d <= 0 ? "Dar de baja" : d <= 30 ? "Devolver o liquidar" : d <= 60 ? "Liquidar o crear campaña" : "Priorizar venta", costoTotal: r2(Number(r.costoUnitario) * Number(r.cantidad)) };
    }) };
  }
  if (id === "stock-critico") {
    const rows = await filas<Record<string, unknown>>(db, sql`
      select p.nombre as producto, p.codigo, p.stock_minimo as minimo,
        coalesce((select sum(cantidad) from lote l where l.producto_id = p.id and l.estado = 'ACTIVO' and l.vencimiento > ${hoy}), 0) as stock,
        coalesce((select sum(vd.unidades) from venta_detalle vd join venta v on v.id = vd.venta_id where vd.producto_id = p.id and v.estado = 'EMITIDA' and v.fecha >= now() - interval '30 days'), 0) as v30
      from producto p where p.activo = true`);
    const out = rows.map((r) => {
      const diaria = Number(r.v30) / 30; const stock = Number(r.stock);
      return { producto: r.producto, codigo: r.codigo, stock, minimo: Number(r.minimo), ventaDiaria: Math.round(diaria * 10) / 10, cobertura: diaria > 0 ? Math.floor(stock / diaria) : null, sugerido: Math.max(0, Math.ceil(diaria * 21 - stock)) };
    }).filter((r) => (r.cobertura !== null && r.cobertura <= 7) || (r.minimo > 0 && r.stock <= r.minimo)).sort((a, b) => (a.cobertura ?? 999) - (b.cobertura ?? 999));
    return { columnas: ["Producto", "Stock", "Mínimo", "Venta/día", "Alcanza (días)", "Pedido sugerido"], filas: out };
  }
  if (id === "salidas-motivo") {
    const h = q.hasta ?? hoy; const d = q.desde ?? sumarDias(h, -29);
    const rows = await filas<Record<string, unknown>>(db, sql`
      select m.nombre as motivo, count(distinct mi.id) as movimientos, coalesce(sum(md.unidades),0) as unidades, coalesce(sum(md.unidades * md.costo_unitario),0) as "costoTotal"
      from movimiento_inventario mi join motivo m on m.id = mi.motivo_id join mov_detalle md on md.movimiento_id = mi.id
      where mi.estado = 'APROBADA' and m.tipo = 'SALIDA' and mi.fecha >= ${inicioDiaLima(d).toISOString()} and mi.fecha < ${inicioDiaLima(sumarDias(h, 1)).toISOString()}
      group by m.nombre order by 4 desc`);
    return { desde: d, hasta: h, columnas: ["Motivo", "Movimientos", "Unidades"], filas: rows.map((r) => ({ motivo: r.motivo, movimientos: Number(r.movimientos), unidades: Number(r.unidades), costoTotal: r2(Number(r.costoTotal)) })) };
  }
  if (id === "cierres-caja") {
    const rows = await listarSesiones(db, user, 120);
    return { columnas: ["Sesión", "Caja", "Cajero", "Turno", "Cierre", "Diferencia"], filas: rows };
  }
  throw new ErrorNegocio("NO_EXISTE", "Reporte no encontrado.", 404);
}

export const esquemaMetrica = z.object({
  nombre: z.string().min(3).max(60),
  formula: z.string().min(1).max(200),
  unidad: z.enum(["SOLES", "UNIDADES", "PORCENTAJE", "NUMERO"]),
  roles: z.array(z.enum(["ADMIN", "QF", "CAJERO", "VENDEDOR", "INVENTARIADOR", "CONTADOR"])).default(["ADMIN"]),
  enPanel: z.boolean().default(false),
});

export async function crearMetrica(db: Db, user: Sesion, input: z.infer<typeof esquemaMetrica>) {
  try { validarFormula(input.formula, Object.keys(BASE)); } catch (e) { throw new ErrorNegocio("FORMULA", (e as Error).message, 422); }
  const codigo = input.nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (BASE[codigo]) throw new ErrorNegocio("CODIGO", "Ese nombre coincide con una métrica base. Usa otro.");
  const sensible = esSensible(input.formula);
  const [m] = await db.insert(metrica).values({ codigo, nombre: input.nombre, formula: input.formula, unidad: input.unidad, roles: sensible ? ["ADMIN"] : input.roles, enPanel: input.enPanel, creadoPor: user.id })
    .onConflictDoNothing().returning();
  if (!m) throw new ErrorNegocio("DUPLICADA", "Ya existe una métrica con ese nombre.", 409);
  return { ...m, sensible };
}

export async function borrarMetrica(db: Db, id: number) {
  await db.delete(metrica).where(eq(metrica.id, id));
  return { id };
}

export const esquemaGuardado = z.object({ nombre: z.string().min(3), config: esquemaConsulta.pick({ agrupar: true, metricas: true, filtros: true }), rolesCompartidos: z.array(z.string()).default([]) });

export async function guardarReporte(db: Db, user: Sesion, input: z.infer<typeof esquemaGuardado>) {
  const [r] = await db.insert(reporteGuardado).values({ nombre: input.nombre, config: { agrupar: input.config.agrupar, metricas: input.config.metricas, filtros: input.config.filtros }, propietarioId: user.id, rolesCompartidos: input.rolesCompartidos }).returning();
  return r;
}

export async function misReportes(db: Db, user: Sesion) {
  return db.select().from(reporteGuardado).where(or(eq(reporteGuardado.propietarioId, user.id), sql`${user.rol} = any(${reporteGuardado.rolesCompartidos})`)).orderBy(desc(reporteGuardado.id));
}

/** Tarjetas del panel principal: métricas marcadas «mostrar en el panel», calculadas para hoy. */
export async function tarjetasPanel(db: Db, rol: Rol) {
  const disp = await metricasDisponibles(db, rol);
  const enPanel = disp.derivadas.filter((d) => d.enPanel).slice(0, 4);
  if (!enPanel.length) return [];
  const hoy = hoyLima();
  const r = await ejecutarReporte(db, rol, { agrupar: "total", metricas: enPanel.map((m) => m.codigo), desde: hoy, hasta: hoy });
  return enPanel.map((m) => ({ codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, valor: r.totales?.[m.codigo] ?? null }));
}

export { and };
