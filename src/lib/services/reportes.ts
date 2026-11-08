import { and, arrayOverlaps, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { fechaOpcional } from "../validacion";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol, verCostos, type Rol } from "../permisos";
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
  laboratorio: { nombre: "Laboratorio", sql: "coalesce(lab.nombre, '—')" },
  vendedor: { nombre: "Vendedor", sql: "u.nombre" },
  dia: { nombre: "Día", sql: "to_char(v.fecha at time zone 'America/Lima', 'YYYY-MM-DD')" },
  semana: { nombre: "Semana", sql: "to_char(date_trunc('week', v.fecha at time zone 'America/Lima'), 'YYYY-MM-DD')" },
  mes: { nombre: "Mes", sql: "to_char(v.fecha at time zone 'America/Lima', 'YYYY-MM')" },
  comprobante: { nombre: "Comprobante", sql: "v.tipo_comprobante::text" },
  campana: { nombre: "Campaña", sql: "coalesce(cam.nombre, 'Sin campaña')" },
  hora: { nombre: "Hora", sql: "to_char(v.fecha at time zone 'America/Lima', 'HH24') || ':00'" },
};

/**
 * Catálogo de reportes listos. `grupo` ordena la lista; `periodo` dice qué filtra el rango de fechas:
 * la fecha de venta o movimiento, la fecha de vencimiento del lote, o nada (foto del momento).
 */
export const CATALOGO = [
  { id: "ventas-categoria", nombre: "Ventas por categoría", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "categoria", metricas: ["ventas", "unidades", "tickets", "ticket_promedio", "tasa_complemento"] } },
  { id: "ventas-dia", nombre: "Ventas por día", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "dia", metricas: ["ventas", "tickets", "ticket_promedio"] } },
  { id: "ventas-hora", nombre: "Ventas por hora del día", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "hora", metricas: ["ventas", "tickets"] } },
  { id: "mas-vendidos", nombre: "Más vendidos", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "producto", metricas: ["unidades", "ventas"], orden: "unidades", limite: 30 } },
  { id: "ventas-laboratorio", nombre: "Ventas por laboratorio", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "laboratorio", metricas: ["ventas", "unidades", "tickets"] } },
  { id: "ventas-vendedor", nombre: "Ventas y comisiones por vendedor", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "vendedor", metricas: ["ventas", "tickets", "ticket_promedio", "comision"] } },
  { id: "comisiones-campana", nombre: "Comisiones por campaña", grupo: "Ventas", periodo: "fecha", tipo: "ventas", config: { agrupar: "campana", metricas: ["ventas_campana", "unidades", "comision"], filtros: { soloCampana: "1" } } },
  { id: "margen-categoria", nombre: "Margen por categoría", grupo: "Ventas", periodo: "fecha", tipo: "ventas", soloCostos: true, config: { agrupar: "categoria", metricas: ["ventas_sin_igv", "costo_ventas", "margen_pct"] } },
  { id: "por-vencer", nombre: "Productos por vencer", grupo: "Inventario", periodo: "vencimiento", tipo: "especial" },
  { id: "stock-critico", nombre: "Stock por terminarse y bajo mínimo", grupo: "Inventario", periodo: null, tipo: "especial" },
  { id: "salidas-motivo", nombre: "Salidas por motivo", grupo: "Inventario", periodo: "fecha", tipo: "especial" },
  { id: "cierres-caja", nombre: "Cierres de caja", grupo: "Caja", periodo: "fecha", tipo: "especial" },
  { id: "cumplimiento-cuota", nombre: "Cumplimiento de cuota del mes", grupo: "Metas", periodo: null, tipo: "cuota" },
] as const;

/** Columna de un reporte especial: el tipo decide el formato; `oculta` la deja apagada al inicio (se puede encender). */
export type ColumnaEspecial = { codigo: string; nombre: string; tipo: "texto" | "codigo" | "soles" | "entero" | "decimal" | "fecha" | "fechaHora" | "dias" | "estado" | "diferencia"; oculta?: boolean };
/** Filtro rápido: lista desplegable o botones, con las opciones que salen de los mismos datos. */
export type FiltroRapido = { codigo: string; nombre: string; tipo: "lista" | "botones" };

type Derivada = { codigo: string; nombre: string; formula: string; unidad: string; roles: string[]; sensible: boolean; enPanel: boolean; id?: number };

export function esSensible(formula: string): boolean {
  return variables(formula).some((v) => BASE[v]?.sensible);
}

export async function metricasDisponibles(db: Db, roles: readonly Rol[]) {
  const der = await db.select().from(metrica).orderBy(metrica.id);
  const costos = verCostos(roles);
  const base = Object.entries(BASE).filter(([, b]) => costos || !b.sensible).map(([codigo, b]) => ({ codigo, nombre: b.nombre, unidad: b.unidad, tipo: "BASE", sensible: !!b.sensible }));
  const derivadas: (Derivada & { tipo: string })[] = der
    .map((d) => ({ id: d.id, codigo: d.codigo, nombre: d.nombre, formula: d.formula, unidad: d.unidad, roles: d.roles, enPanel: d.enPanel, sensible: esSensible(d.formula), tipo: "PERSONALIZADA" }))
    .filter((d) => (costos || !d.sensible) && (roles.includes("ADMIN") || tieneRol(roles, ...(d.roles as Rol[]))));
  return { base, derivadas, dimensiones: Object.entries(DIMENSIONES).map(([codigo, d]) => ({ codigo, nombre: d.nombre })) };
}

export const esquemaConsulta = z.object({
  agrupar: z.string().default("total"),
  metricas: z.array(z.string()).min(1).max(10),
  desde: fechaOpcional,
  hasta: fechaOpcional,
  filtros: z.record(z.string(), z.string()).optional(),
  orden: z.string().optional(),
  limite: z.number().int().min(1).max(500).optional(),
});

export async function ejecutarReporte(db: Db, roles: readonly Rol[], q: z.infer<typeof esquemaConsulta>) {
  const dim = DIMENSIONES[q.agrupar];
  if (!dim) throw new ErrorNegocio("DIMENSION", "Agrupación no válida.");
  const disp = await metricasDisponibles(db, roles);
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
  if (f.laboratorioId) conds.push(sql`p.laboratorio_id = ${Number(f.laboratorioId)}`);
  // Separar las ventas por transferencia es un análisis del propietario: se rechaza para los demás perfiles, también en reportes compartidos.
  if (f.canal) {
    if (!roles.includes("ADMIN")) throw new ErrorNegocio("SIN_PERMISO", "El filtro por canal de venta solo está disponible para el propietario.", 403);
    if (f.canal !== "MOSTRADOR" && f.canal !== "TRANSFERENCIA") throw new ErrorNegocio("FILTRO", "Canal de venta no válido.");
    conds.push(sql`v.canal = ${f.canal}`);
  }
  if (f.comprobante) conds.push(sql`v.tipo_comprobante::text = ${f.comprobante}`);
  if (f.soloCampana) conds.push(sql`c.id is not null`);
  const selects = [...necesarias].map((m) => `${BASE[m].sql} as "${m}"`).join(", ");
  const consulta = (agr: string) => sql`
    select ${sql.raw(agr)} as grupo, ${sql.raw(selects)}
    from venta_detalle vd
    join venta v on v.id = vd.venta_id
    join producto p on p.id = vd.producto_id
    left join categoria cat on cat.id = p.categoria_id
    left join laboratorio lab on lab.id = p.laboratorio_id
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

type Especial = { desde?: string; hasta?: string; columnas: ColumnaEspecial[]; filtros: FiltroRapido[]; filas: Record<string, unknown>[] };

export async function reporteEspecial(db: Db, user: Sesion, id: string, q: { desde?: string; hasta?: string; dias?: number }): Promise<Especial> {
  const hoy = hoyLima();
  const costos = verCostos(user.roles);
  const conCosto = (cols: ColumnaEspecial[], col: ColumnaEspecial) => (costos ? [...cols, col] : cols);
  if (id === "por-vencer") {
    // Rango de vencimiento: por defecto, de hoy a 90 días. "Vencidos" se pide con un rango que termina hoy.
    const d = q.desde ?? hoy; const h = q.hasta ?? sumarDias(hoy, q.dias ?? 90);
    const rows = await filas<Record<string, unknown>>(db, sql`
      select p.nombre as producto, p.codigo, coalesce(lab.nombre, '—') as laboratorio, coalesce(cat.nombre, 'Sin categoría') as categoria,
        l.numero as lote, l.vencimiento::text as vencimiento, l.cantidad, p.stock_minimo as minimo, l.costo_unitario as "costoUnitario",
        (select pr.pvp from presentacion pr where pr.producto_id = p.id and pr.factor = 1 limit 1) as pvp
      from lote l join producto p on p.id = l.producto_id
      left join laboratorio lab on lab.id = p.laboratorio_id left join categoria cat on cat.id = p.categoria_id
      where l.cantidad > 0 and l.vencimiento >= ${d} and l.vencimiento <= ${h} order by l.vencimiento, p.nombre`);
    return {
      desde: d, hasta: h,
      columnas: conCosto([
        { codigo: "producto", nombre: "Producto", tipo: "texto" }, { codigo: "codigo", nombre: "Código", tipo: "codigo", oculta: true },
        { codigo: "laboratorio", nombre: "Laboratorio", tipo: "texto" }, { codigo: "categoria", nombre: "Categoría", tipo: "texto", oculta: true },
        { codigo: "lote", nombre: "Lote", tipo: "codigo" }, { codigo: "vencimiento", nombre: "Vence", tipo: "fecha" }, { codigo: "dias", nombre: "Días", tipo: "dias" },
        { codigo: "unidades", nombre: "Stock del lote", tipo: "entero" }, { codigo: "minimo", nombre: "Stock mínimo", tipo: "entero", oculta: true },
        { codigo: "pvp", nombre: "Precio venta", tipo: "soles" }, { codigo: "accion", nombre: "Acción sugerida", tipo: "estado" },
      ], { codigo: "costoTotal", nombre: "Costo en riesgo", tipo: "soles" }),
      filtros: [{ codigo: "laboratorio", nombre: "Laboratorio", tipo: "lista" }, { codigo: "categoria", nombre: "Categoría", tipo: "lista" }, { codigo: "accion", nombre: "Acción", tipo: "botones" }],
      filas: rows.map((r) => {
        const dias = diasEntre(hoy, String(r.vencimiento).slice(0, 10));
        return {
          producto: r.producto, codigo: r.codigo, laboratorio: r.laboratorio, categoria: r.categoria, lote: r.lote, vencimiento: String(r.vencimiento).slice(0, 10), dias,
          unidades: Number(r.cantidad), minimo: Number(r.minimo), pvp: r.pvp === null ? null : Number(r.pvp),
          accion: dias <= 0 ? "Dar de baja" : dias <= 30 ? "Devolver o liquidar" : dias <= 60 ? "Liquidar o crear campaña" : "Priorizar venta",
          ...(costos ? { costoTotal: r2(Number(r.costoUnitario) * Number(r.cantidad)) } : {}),
        };
      }),
    };
  }
  if (id === "stock-critico") {
    const rows = await filas<Record<string, unknown>>(db, sql`
      with st as (select producto_id, sum(cantidad) as stock from lote where estado = 'ACTIVO' and vencimiento > ${hoy} group by producto_id),
        vt as (select vd.producto_id, sum(vd.unidades) as v30 from venta_detalle vd join venta v on v.id = vd.venta_id
               where v.estado = 'EMITIDA' and v.canal = 'MOSTRADOR' and v.fecha >= now() - interval '30 days' group by vd.producto_id)
      select p.nombre as producto, p.codigo, p.stock_minimo as minimo, coalesce(lab.nombre, '—') as laboratorio, coalesce(cat.nombre, 'Sin categoría') as categoria, p.costo_promedio as costo,
        coalesce(st.stock, 0) as stock, coalesce(vt.v30, 0) as v30
      from producto p left join st on st.producto_id = p.id left join vt on vt.producto_id = p.id
      left join laboratorio lab on lab.id = p.laboratorio_id left join categoria cat on cat.id = p.categoria_id where p.activo = true`);
    const out = rows.map((r) => {
      const diaria = Number(r.v30) / 30; const stock = Number(r.stock); const minimo = Number(r.minimo);
      const cobertura = diaria > 0 ? Math.floor(stock / diaria) : null; const sugerido = Math.max(0, Math.ceil(diaria * 21 - stock));
      return {
        producto: r.producto, codigo: r.codigo, laboratorio: r.laboratorio, categoria: r.categoria, stock, minimo, ventaDiaria: Math.round(diaria * 10) / 10, cobertura, sugerido,
        estado: stock === 0 ? "Agotado" : minimo > 0 && stock <= minimo ? "Bajo mínimo" : "Por terminarse",
        ...(costos ? { costoPedido: r2(sugerido * Number(r.costo)) } : {}),
      };
    }).filter((r) => (r.cobertura !== null && r.cobertura <= 7) || (r.minimo > 0 && r.stock <= r.minimo)).sort((a, b) => (a.cobertura ?? 999) - (b.cobertura ?? 999));
    return {
      columnas: conCosto([
        { codigo: "codigo", nombre: "Código", tipo: "codigo" }, { codigo: "producto", nombre: "Producto", tipo: "texto" },
        { codigo: "laboratorio", nombre: "Laboratorio", tipo: "texto", oculta: true }, { codigo: "categoria", nombre: "Categoría", tipo: "texto", oculta: true },
        { codigo: "estado", nombre: "Estado", tipo: "estado" }, { codigo: "stock", nombre: "Stock", tipo: "entero" }, { codigo: "minimo", nombre: "Mínimo", tipo: "entero" },
        { codigo: "ventaDiaria", nombre: "Venta/día", tipo: "decimal" }, { codigo: "cobertura", nombre: "Alcanza (días)", tipo: "entero" }, { codigo: "sugerido", nombre: "Pedido sugerido", tipo: "entero" },
      ], { codigo: "costoPedido", nombre: "Costo del pedido", tipo: "soles", oculta: true }),
      filtros: [{ codigo: "estado", nombre: "Estado", tipo: "botones" }, { codigo: "laboratorio", nombre: "Laboratorio", tipo: "lista" }, { codigo: "categoria", nombre: "Categoría", tipo: "lista" }],
      filas: out,
    };
  }
  if (id === "salidas-motivo") {
    const h = q.hasta ?? hoy; const d = q.desde ?? sumarDias(h, -29);
    const rows = await filas<Record<string, unknown>>(db, sql`
      select m.nombre as motivo, m.tipo, count(distinct mi.id) as movimientos, coalesce(sum(md.unidades),0) as unidades, coalesce(sum(md.unidades * md.costo_unitario),0) as "costoTotal"
      from movimiento_inventario mi join motivo m on m.id = mi.motivo_id join mov_detalle md on md.movimiento_id = mi.id
      where mi.estado = 'APROBADA' and mi.fecha >= ${inicioDiaLima(d).toISOString()} and mi.fecha < ${inicioDiaLima(sumarDias(h, 1)).toISOString()}
      group by m.nombre, m.tipo order by m.tipo desc, 5 desc`);
    return {
      desde: d, hasta: h,
      columnas: conCosto([
        { codigo: "motivo", nombre: "Motivo", tipo: "texto" }, { codigo: "tipo", nombre: "Tipo", tipo: "estado" },
        { codigo: "movimientos", nombre: "Movimientos", tipo: "entero" }, { codigo: "unidades", nombre: "Unidades", tipo: "entero" },
      ], { codigo: "costoTotal", nombre: "Valorizado a costo", tipo: "soles" }),
      filtros: [{ codigo: "tipo", nombre: "Tipo", tipo: "botones" }],
      filas: rows.map((r) => ({ motivo: r.motivo, tipo: r.tipo === "SALIDA" ? "Salida" : "Entrada", movimientos: Number(r.movimientos), unidades: Number(r.unidades), ...(costos ? { costoTotal: r2(Number(r.costoTotal)) } : {}) })),
    };
  }
  if (id === "cierres-caja") {
    const h = q.hasta ?? hoy; const d = q.desde ?? sumarDias(h, -29);
    const desdeT = inicioDiaLima(d).getTime(); const hastaT = inicioDiaLima(sumarDias(h, 1)).getTime();
    const rows = (await listarSesiones(db, user, 2000)).filter((s) => { const t = new Date(s.cerradaEn ?? s.abiertaEn).getTime(); return t >= desdeT && t < hastaT; });
    return {
      desde: d, hasta: h,
      columnas: [
        { codigo: "sesion", nombre: "Sesión", tipo: "codigo" }, { codigo: "cajero", nombre: "Usuario", tipo: "texto" }, { codigo: "turno", nombre: "Turno", tipo: "texto", oculta: true },
        { codigo: "abiertaEn", nombre: "Apertura", tipo: "fechaHora" }, { codigo: "cerradaEn", nombre: "Cierre", tipo: "fechaHora" },
        { codigo: "saldoEfectivo", nombre: "Saldo final efectivo", tipo: "soles" }, { codigo: "saldoVirtual", nombre: "Saldo final virtual", tipo: "soles" },
        { codigo: "diferencia", nombre: "Diferencia", tipo: "diferencia" }, { codigo: "resultado", nombre: "Resultado", tipo: "estado", oculta: true },
      ],
      filtros: [{ codigo: "cajero", nombre: "Usuario", tipo: "lista" }, { codigo: "resultado", nombre: "Resultado", tipo: "botones" }],
      filas: rows.map((s) => {
        const dif = Number(s.diferencia ?? 0);
        return {
          id: s.id, sesion: String(s.id).padStart(6, "0"), cajero: s.cajero, turno: s.turno[0] + s.turno.slice(1).toLowerCase(), abiertaEn: s.abiertaEn, cerradaEn: s.cerradaEn,
          saldoEfectivo: s.saldoEfectivo, saldoVirtual: s.saldoVirtual, diferencia: dif,
          resultado: s.estado === "EN_CIERRE" ? "Por validar" : dif < -0.004 ? "Faltante" : dif > 0.004 ? "Sobrante" : "Cuadrado",
        };
      }),
    };
  }
  throw new ErrorNegocio("NO_EXISTE", "Reporte no encontrado.", 404);
}

/** Listas para los filtros rápidos de los reportes de ventas. */
export async function opcionesFiltros(db: Db) {
  const [categorias, laboratorios, vendedores] = await Promise.all([
    db.select({ id: schema.categoria.id, nombre: schema.categoria.nombre }).from(schema.categoria).orderBy(schema.categoria.nombre),
    db.select({ id: schema.laboratorio.id, nombre: schema.laboratorio.nombre }).from(schema.laboratorio).orderBy(schema.laboratorio.nombre),
    filas<{ id: number; nombre: string }>(db, sql`select distinct u.id, u.nombre from usuario u join venta v on v.usuario_id = u.id order by u.nombre`),
  ]);
  return { categorias, laboratorios, vendedores: vendedores.map((v) => ({ id: Number(v.id), nombre: v.nombre })) };
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
  return db.select().from(reporteGuardado).where(or(eq(reporteGuardado.propietarioId, user.id), arrayOverlaps(reporteGuardado.rolesCompartidos, user.roles))).orderBy(desc(reporteGuardado.id));
}

/** Tarjetas del panel principal: métricas marcadas «mostrar en el panel», calculadas para hoy. */
export async function tarjetasPanel(db: Db, roles: readonly Rol[]) {
  const disp = await metricasDisponibles(db, roles);
  const enPanel = disp.derivadas.filter((d) => d.enPanel).slice(0, 4);
  if (!enPanel.length) return [];
  const hoy = hoyLima();
  const r = await ejecutarReporte(db, roles, { agrupar: "total", metricas: enPanel.map((m) => m.codigo), desde: hoy, hasta: hoy });
  return enPanel.map((m) => ({ codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, valor: r.totales?.[m.codigo] ?? null }));
}

export { and };
