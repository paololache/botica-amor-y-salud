import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import type { Rol } from "../permisos";
import { filas } from "../sqlrows";
import { diasEntre, ErrorNegocio, hoy as hoyLima, sumarDias } from "../util";
import { parametros } from "./parametros";

const { alerta, lote, motivo, movimientoInventario, movDetalle, auditoria } = schema;

export type TipoAlerta =
  | "AGOTADO" | "POR_TERMINARSE" | "BAJO_MINIMO" | "POR_VENCER" | "VENCIDO" | "SIN_ROTACION"
  | "DIF_CAJA" | "CAJA_ABIERTA" | "CPE_PENDIENTE" | "CAMPANA_POR_VENCER" | "SALIDA_PENDIENTE";

export const TIPOS: Record<TipoAlerta, { nombre: string; roles: Rol[]; grupo: "stock" | "vencimiento" | "caja" | "gestion" }> = {
  AGOTADO: { nombre: "Agotados", roles: ["ADMIN", "INVENTARIADOR"], grupo: "stock" },
  POR_TERMINARSE: { nombre: "Por terminarse", roles: ["ADMIN", "INVENTARIADOR"], grupo: "stock" },
  BAJO_MINIMO: { nombre: "Bajo mínimo", roles: ["ADMIN", "INVENTARIADOR"], grupo: "stock" },
  POR_VENCER: { nombre: "Por vencer", roles: ["ADMIN", "QF", "INVENTARIADOR"], grupo: "vencimiento" },
  VENCIDO: { nombre: "Vencidos", roles: ["ADMIN", "QF", "INVENTARIADOR"], grupo: "vencimiento" },
  SIN_ROTACION: { nombre: "Sin rotación", roles: ["ADMIN"], grupo: "stock" },
  DIF_CAJA: { nombre: "Diferencias de caja", roles: ["ADMIN"], grupo: "caja" },
  CAJA_ABIERTA: { nombre: "Cajas sin cerrar", roles: ["ADMIN"], grupo: "caja" },
  CPE_PENDIENTE: { nombre: "CPE pendientes", roles: ["ADMIN"], grupo: "caja" },
  CAMPANA_POR_VENCER: { nombre: "Campañas por vencer", roles: ["ADMIN"], grupo: "gestion" },
  SALIDA_PENDIENTE: { nombre: "Salidas por aprobar", roles: ["ADMIN", "QF"], grupo: "gestion" },
};

type Nueva = { clave: string; tipo: TipoAlerta; severidad: "CRITICA" | "ALTA" | "INFO"; titulo: string; detalle: string; referenciaTipo?: string; referenciaId?: number; valor?: number };

/** Recalcula todas las alertas con consultas agregadas (pensado para miles de productos y lotes). */
export async function evaluarAlertas(db: Db) {
  const hoy = hoyLima();
  const p = await parametros(db);
  const nuevas: Nueva[] = [];

  await db.update(lote).set({ estado: "VENCIDO" }).where(and(eq(lote.estado, "ACTIVO"), sql`${lote.vencimiento} <= ${hoy}`, sql`${lote.cantidad} > 0`));

  const prods = await filas<{ id: number; nombre: string; minimo: number; stock: string; vigente: string; v30: string; v90: string }>(db, sql`
    select p.id, p.nombre, p.stock_minimo as minimo,
      coalesce(s.stock, 0) as stock, coalesce(s.vigente, 0) as vigente,
      coalesce(v.v30, 0) as v30, coalesce(v.v90, 0) as v90
    from producto p
    left join (select producto_id, sum(cantidad) stock, sum(case when estado = 'ACTIVO' and vencimiento > ${hoy} then cantidad else 0 end) vigente from lote group by producto_id) s on s.producto_id = p.id
    left join (
      select vd.producto_id,
        sum(case when v.fecha >= now() - interval '30 days' then vd.unidades else 0 end) v30,
        sum(vd.unidades) v90
      from venta_detalle vd join venta v on v.id = vd.venta_id
      where v.estado = 'EMITIDA' and v.fecha >= now() - interval '90 days'
      group by vd.producto_id
    ) v on v.producto_id = p.id
    where p.activo = true`);
  for (const r of prods) {
    const vigente = Number(r.vigente); const stock = Number(r.stock);
    const diaria = Number(r.v30) / 30; const v90 = Number(r.v90);
    const reorden = diaria * (p.dias_reposicion + p.dias_stock_seguridad);
    const cobertura = diaria > 0 ? vigente / diaria : Infinity;
    if (vigente <= 0 && v90 > 0) nuevas.push({ clave: `STOCK:p:${r.id}`, tipo: "AGOTADO", severidad: "CRITICA", titulo: r.nombre, detalle: "Sin stock vigente y con ventas en los últimos 90 días", referenciaTipo: "producto", referenciaId: r.id, valor: 0 });
    else if (vigente > 0 && diaria > 0 && (vigente <= reorden || cobertura <= p.cobertura_minima_dias)) nuevas.push({ clave: `STOCK:p:${r.id}`, tipo: "POR_TERMINARSE", severidad: "ALTA", titulo: r.nombre, detalle: `Alcanza para ${Math.max(0, Math.floor(cobertura))} días (vende ${diaria.toFixed(1)} und./día)`, referenciaTipo: "producto", referenciaId: r.id, valor: Math.floor(cobertura) });
    else if (r.minimo > 0 && vigente <= r.minimo) nuevas.push({ clave: `STOCK:p:${r.id}`, tipo: "BAJO_MINIMO", severidad: "ALTA", titulo: r.nombre, detalle: `Stock ${vigente} con mínimo ${r.minimo}`, referenciaTipo: "producto", referenciaId: r.id, valor: vigente });
    else if (stock > 0 && v90 === 0) nuevas.push({ clave: `ROT:p:${r.id}`, tipo: "SIN_ROTACION", severidad: "INFO", titulo: r.nombre, detalle: `${stock} unidades sin ventas en 90 días`, referenciaTipo: "producto", referenciaId: r.id, valor: stock });
  }

  const lotes = await filas<{ id: number; numero: string; vencimiento: string; cantidad: number; nombre: string }>(db, sql`
    select l.id, l.numero, l.vencimiento::text as vencimiento, l.cantidad, p.nombre from lote l join producto p on p.id = l.producto_id
    where l.cantidad > 0 and l.vencimiento <= ${sumarDias(hoy, 90)}`);
  for (const l of lotes) {
    const dias = diasEntre(hoy, String(l.vencimiento).slice(0, 10));
    if (dias <= 0) nuevas.push({ clave: `VENC:l:${l.id}`, tipo: "VENCIDO", severidad: "CRITICA", titulo: l.nombre, detalle: `Lote ${l.numero} vencido · ${l.cantidad} und. bloqueadas para la venta`, referenciaTipo: "lote", referenciaId: l.id, valor: dias });
    else nuevas.push({ clave: `VENC:l:${l.id}`, tipo: "POR_VENCER", severidad: dias <= 30 ? "CRITICA" : dias <= 60 ? "ALTA" : "INFO", titulo: l.nombre, detalle: `Lote ${l.numero} vence en ${dias} días · ${l.cantidad} und.`, referenciaTipo: "lote", referenciaId: l.id, valor: dias });
  }

  const cajas = await filas<{ id: number; diferencia: string | null; estado: string; abierta_en: string; nombre: string }>(db, sql`
    select s.id, s.diferencia, s.estado, s.abierta_en, u.nombre from sesion_caja s join usuario u on u.id = s.usuario_id
    where (s.estado = 'CERRADA' and s.cerrada_en >= now() - interval '7 days' and abs(coalesce(s.diferencia,0)) > ${p.umbral_diferencia_caja})
       or (s.estado in ('ABIERTA','EN_CIERRE') and s.abierta_en < now() - interval '14 hours')
       or s.estado = 'EN_CIERRE'`);
  for (const c of cajas) {
    if (c.estado === "CERRADA") nuevas.push({ clave: `CAJA:s:${c.id}`, tipo: "DIF_CAJA", severidad: "ALTA", titulo: `Cierre de ${c.nombre}`, detalle: `Diferencia de S/ ${Number(c.diferencia).toFixed(2)}`, referenciaTipo: "sesion", referenciaId: c.id, valor: Number(c.diferencia) });
    else if (c.estado === "EN_CIERRE") nuevas.push({ clave: `CAJA:s:${c.id}`, tipo: "DIF_CAJA", severidad: "CRITICA", titulo: `Cierre de ${c.nombre} por validar`, detalle: "La diferencia supera el umbral y espera tu validación", referenciaTipo: "sesion", referenciaId: c.id });
    else nuevas.push({ clave: `ABIERTA:s:${c.id}`, tipo: "CAJA_ABIERTA", severidad: "ALTA", titulo: `Caja de ${c.nombre}`, detalle: "Abierta hace más de 14 horas", referenciaTipo: "sesion", referenciaId: c.id });
  }

  const [cpe] = await filas<{ n: string }>(db, sql`select count(*) n from venta where cpe_estado in ('PENDIENTE','RECHAZADO') and fecha < now() - interval '2 hours'`);
  if (Number(cpe?.n ?? 0) > 0) nuevas.push({ clave: "CPE:pendientes", tipo: "CPE_PENDIENTE", severidad: "CRITICA", titulo: "Comprobantes sin aceptar", detalle: `${cpe.n} CPE sin CDR aceptado después de 2 horas`, valor: Number(cpe.n) });

  const camps = await filas<{ id: number; nombre: string; fin: string }>(db, sql`
    select id, nombre, fin::text as fin from campana where estado in ('ACTIVA','PROGRAMADA') and fin >= ${hoy} and fin <= ${sumarDias(hoy, p.aviso_campana_dias)}`);
  for (const c of camps) nuevas.push({ clave: `CAMP:c:${c.id}`, tipo: "CAMPANA_POR_VENCER", severidad: "INFO", titulo: c.nombre, detalle: `Termina el ${String(c.fin).slice(0, 10)}`, referenciaTipo: "campana", referenciaId: c.id });

  const sal = await filas<{ id: number; descripcion: string }>(db, sql`select id, descripcion from movimiento_inventario where estado = 'PENDIENTE' and fecha < now() - interval '24 hours'`);
  for (const s of sal) nuevas.push({ clave: `SAL:m:${s.id}`, tipo: "SALIDA_PENDIENTE", severidad: "INFO", titulo: `Movimiento MOV-${String(s.id).padStart(5, "0")}`, detalle: s.descripcion, referenciaTipo: "movimiento", referenciaId: s.id });

  const existentes = await db.select().from(alerta).where(ne(alerta.estado, "CERRADA"));
  const porClave = new Map(existentes.map((e) => [e.clave, e]));
  const vistas = new Set<string>();
  const insertar: (typeof alerta.$inferInsert)[] = [];
  for (const n of nuevas) {
    vistas.add(n.clave);
    const e = porClave.get(n.clave);
    if (!e) insertar.push({ ...n, referenciaTipo: n.referenciaTipo ?? null, referenciaId: n.referenciaId ?? null, valor: n.valor ?? null });
    else if (e.tipo !== n.tipo || e.severidad !== n.severidad || e.detalle !== n.detalle)
      await db.update(alerta).set({ tipo: n.tipo, severidad: n.severidad, detalle: n.detalle, valor: n.valor ?? null, actualizadaEn: new Date(), ...(e.tipo !== n.tipo ? { estado: "ABIERTA" } : {}) }).where(eq(alerta.id, e.id));
  }
  for (let i = 0; i < insertar.length; i += 500) await db.insert(alerta).values(insertar.slice(i, i + 500));
  const cerrar = existentes.filter((e) => !vistas.has(e.clave)).map((e) => e.id);
  for (let i = 0; i < cerrar.length; i += 500) await db.update(alerta).set({ estado: "CERRADA", actualizadaEn: new Date() }).where(inArray(alerta.id, cerrar.slice(i, i + 500)));
  return { evaluadas: nuevas.length, nuevas: insertar.length, cerradas: cerrar.length };
}

function tiposDeRol(rol: Rol): TipoAlerta[] {
  return (Object.keys(TIPOS) as TipoAlerta[]).filter((t) => TIPOS[t].roles.includes(rol));
}

export async function alertasDelRol(db: Db, rol: Rol, opciones: { tipo?: string; limite?: number } = {}) {
  const tipos = tiposDeRol(rol);
  if (!tipos.length) return { conteos: [], alertas: [] };
  const visibles = and(eq(alerta.estado, "ABIERTA"), inArray(alerta.tipo, tipos), or(isNull(alerta.pospuestaHasta), lt(alerta.pospuestaHasta, new Date())));
  const conteo = await db.select({ tipo: alerta.tipo, n: sql<number>`count(*)`.mapWith(Number), criticas: sql<number>`sum(case when ${alerta.severidad} = 'CRITICA' then 1 else 0 end)`.mapWith(Number) })
    .from(alerta).where(visibles).groupBy(alerta.tipo);
  const lista = await db.select().from(alerta).where(opciones.tipo ? and(visibles, eq(alerta.tipo, opciones.tipo)) : visibles)
    .orderBy(sql`case ${alerta.severidad} when 'CRITICA' then 0 when 'ALTA' then 1 else 2 end`, alerta.valor, alerta.id).limit(opciones.limite ?? 80);
  return {
    conteos: tipos.map((t) => ({ tipo: t, nombre: TIPOS[t].nombre, grupo: TIPOS[t].grupo, total: conteo.find((c) => c.tipo === t)?.n ?? 0, criticas: conteo.find((c) => c.tipo === t)?.criticas ?? 0 })),
    alertas: lista,
  };
}

export const esquemaAtencion = z.object({
  accion: z.enum(["ORDEN_COMPRA", "BAJA_VENCIMIENTO", "DEVOLVER_PROVEEDOR", "REVISADO", "POSPONER"]),
  comentario: z.string().optional(),
});

/** Atiende una alerta con una acción directa; las bajas y devoluciones quedan como borrador pendiente de aprobación. */
export async function atenderAlerta(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaAtencion>) {
  const [a] = await db.select().from(alerta).where(eq(alerta.id, id));
  if (!a || a.estado === "CERRADA") throw new ErrorNegocio("NO_EXISTE", "La alerta ya no está abierta.", 404);
  if (!TIPOS[a.tipo as TipoAlerta]?.roles.includes(user.rol)) throw new ErrorNegocio("SIN_PERMISO", "Esta alerta corresponde a otro rol.", 403);
  let documento: { tipo: string; id: number } | null = null;
  if (input.accion === "POSPONER") {
    if (!input.comentario?.trim()) throw new ErrorNegocio("COMENTARIO", "Escribe por qué la pospones.");
    await db.update(alerta).set({ pospuestaHasta: new Date(Date.now() + 24 * 3600 * 1000), accion: `POSPUESTA: ${input.comentario}`, atendidaPor: user.id, atendidaEn: new Date() }).where(eq(alerta.id, id));
    return { id, estado: "ABIERTA", pospuesta: true };
  }
  if ((input.accion === "BAJA_VENCIMIENTO" || input.accion === "DEVOLVER_PROVEEDOR") && a.referenciaTipo === "lote" && a.referenciaId) {
    const [l] = await db.select().from(lote).where(eq(lote.id, a.referenciaId));
    const [m] = await db.select().from(motivo).where(eq(motivo.codigo, input.accion === "BAJA_VENCIMIENTO" ? "VENCIMIENTO" : "DEVOLUCION_PROVEEDOR"));
    if (l && m && l.cantidad > 0) {
      const [mov] = await db.insert(movimientoInventario).values({ motivoId: m.id, descripcion: `Desde alerta: ${a.detalle}`, estado: "PENDIENTE", totalCosto: l.costoUnitario * l.cantidad, registradoPor: user.id }).returning();
      await db.insert(movDetalle).values({ movimientoId: mov.id, productoId: l.productoId, loteId: l.id, unidades: l.cantidad, costoUnitario: l.costoUnitario });
      documento = { tipo: "movimiento", id: mov.id };
    }
  }
  await db.update(alerta).set({ estado: "ATENDIDA", accion: input.accion + (input.comentario ? `: ${input.comentario}` : ""), atendidaPor: user.id, atendidaEn: new Date() }).where(eq(alerta.id, id));
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "ATENDER_ALERTA", entidad: "alerta", entidadId: id, detalle: { accion: input.accion, documento } });
  return { id, estado: "ATENDIDA", documento };
}
