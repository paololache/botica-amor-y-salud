import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol } from "../permisos";
import { filas } from "../sqlrows";
import { ErrorNegocio, esFechaValida, hoy as hoyLima, inicioDiaLima, r2, sumarDias } from "../util";
import { accesosFrecuentes } from "./accesos";
import { avanceDelMes, cumplimientoCuotas, metaDelDia } from "./metas";
import { alertasDelRol, evaluarAlertasSiToca } from "./alertas";
import { estadoCaja } from "./caja";
import { misComisiones } from "./comisiones";
import { tarjetasPanel } from "./reportes";

const { venta } = schema;

const dos = (n: number) => String(n).padStart(2, "0");
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const vacioComoFalta = (v: unknown) => (v === "" ? undefined : v);
export const esquemaHistorico = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.preprocess(vacioComoFalta, z.coerce.number().int().min(1).max(12).optional()),
  dia: z.preprocess(vacioComoFalta, z.coerce.number().int().min(1).max(31).optional()),
  turno: z.preprocess(vacioComoFalta, z.enum(["MAÑANA", "TARDE", "NOCHE", "COMPLETO"]).optional()),
});

/** Ventas emitidas en barras: por mes de un año, por día de un mes o por hora de un día. Quien no gestiona solo ve las suyas. */
export async function historicoVentas(db: Db, user: Sesion, q: z.infer<typeof esquemaHistorico>) {
  if (q.dia && !q.mes) throw new ErrorNegocio("FILTRO", "Elige un mes para filtrar por día.");
  const { anio, mes, dia } = q;
  const inicio = dia ? `${anio}-${dos(mes!)}-${dos(dia)}` : mes ? `${anio}-${dos(mes)}-01` : `${anio}-01-01`;
  if (!esFechaValida(inicio)) throw new ErrorNegocio("FILTRO", "Esa fecha no existe.");
  const fin = dia ? sumarDias(inicio, 1) : mes ? (mes === 12 ? `${anio + 1}-01-01` : `${anio}-${dos(mes + 1)}-01`) : `${anio + 1}-01-01`;
  const nivel = dia ? "hora" : mes ? "dia" : "mes";
  const formato = nivel === "hora" ? "HH24" : nivel === "dia" ? "DD" : "MM";
  const propias = !tieneRol(user.roles, "ADMIN", "CONTADOR");
  const delUsuario = propias ? sql`and v.usuario_id = ${user.id}` : sql``;
  const rows = await filas<{ grupo: string; total: string; tickets: string }>(db, sql`
    select to_char(v.fecha at time zone 'America/Lima', ${formato}) as grupo, sum(v.total - v.delivery) as total, count(*) as tickets
    from venta v left join sesion_caja s on s.id = v.sesion_id
    where v.estado = 'EMITIDA' and v.fecha >= ${inicioDiaLima(inicio).toISOString()} and v.fecha < ${inicioDiaLima(fin).toISOString()}
      ${q.turno ? sql`and s.turno = ${q.turno}` : sql``} ${delUsuario}
    group by 1`);
  const anios = await filas<{ anio: string }>(db, sql`
    select distinct to_char(v.fecha at time zone 'America/Lima', 'YYYY') as anio from venta v where v.estado = 'EMITIDA' ${delUsuario} order by 1 desc`);
  const mapa = new Map(rows.map((r) => [r.grupo, r]));
  const horas = rows.map((r) => Number(r.grupo));
  const claves = nivel === "mes" ? Array.from({ length: 12 }, (_, i) => dos(i + 1))
    : nivel === "dia" ? Array.from({ length: new Date(Date.UTC(anio, mes!, 0)).getUTCDate() }, (_, i) => dos(i + 1))
    : rows.length ? Array.from({ length: Math.max(...horas) - Math.min(...horas) + 1 }, (_, i) => dos(Math.min(...horas) + i)) : [];
  const barras = claves.map((clave) => {
    const r = mapa.get(clave); const n = Number(clave);
    return {
      clave,
      etiqueta: nivel === "mes" ? MESES[n - 1] : nivel === "dia" ? String(n) : `${clave}h`,
      detalle: nivel === "mes" ? `${MESES_LARGO[n - 1]} ${anio}` : nivel === "dia" ? `${n} de ${MESES_LARGO[mes! - 1].toLowerCase()} de ${anio}` : `${clave}:00 a ${clave}:59`,
      total: r2(Number(r?.total ?? 0)), tickets: Number(r?.tickets ?? 0),
    };
  });
  const lista = new Set([Number(hoyLima().slice(0, 4)), anio, ...anios.map((a) => Number(a.anio))]);
  return { nivel, propias, anios: [...lista].sort((a, b) => b - a), total: r2(barras.reduce((s, b) => s + b.total, 0)), tickets: barras.reduce((s, b) => s + b.tickets, 0), barras };
}

export async function panel(db: Db, user: Sesion) {
  const hoy = hoyLima();
  await evaluarAlertasSiToca(db);
  const propias = !tieneRol(user.roles, "ADMIN", "CONTADOR");
  const ventasDe = async (desde: string) => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(desde))];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    // El delivery que paga el cliente no es venta: se descuenta del total.
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total} - ${venta.delivery}),0)`.mapWith(Number), tickets: sql<number>`count(*)`.mapWith(Number) }).from(venta).where(and(...cond));
    return { total: r2(r?.total ?? 0), tickets: r?.tickets ?? 0 };
  };
  const ventasAyer = async () => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(sumarDias(hoy, -1))), sql`${venta.fecha} < ${inicioDiaLima(hoy).toISOString()}`];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total} - ${venta.delivery}),0)`.mapWith(Number) }).from(venta).where(and(...cond));
    return r2(r?.total ?? 0);
  };
  const [dia, mes, ayer, alertas, caja, comisiones, tarjetas, accesos, meta, cuota] = await Promise.all([
    ventasDe(hoy), ventasDe(hoy.slice(0, 8) + "01"), ventasAyer(), alertasDelRol(db, user.roles, { limite: 0 }),
    tieneRol(user.roles, "ADMIN", "CAJERO", "VENDEDOR", "QF") ? estadoCaja(db, user) : Promise.resolve(null),
    tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? misComisiones(db, user.id) : Promise.resolve(null),
    tarjetasPanel(db, user.roles),
    accesosFrecuentes(db, user),
    tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? metaDelDia(db, user.id) : Promise.resolve(null),
    // La cuota del mes: el administrador y el contador ven la de la botica; quien vende, la suya.
    tieneRol(user.roles, "ADMIN", "CONTADOR") ? avanceDelMes(db, null) : tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? avanceDelMes(db, user.id) : Promise.resolve(null),
  ]);
  return { hoy, ventas: { dia, mes, ayer, propias }, alertas, caja: caja ? { sesion: caja.sesion, resumen: caja.resumen } : null, comisiones, tarjetas, accesos, meta, cuota: cuota ? { ...cuota, deBotica: tieneRol(user.roles, "ADMIN", "CONTADOR") } : null };
}

export const esquemaMasVendidos = z.object({ periodo: z.enum(["dia", "semana", "mes", "anio"]).default("mes") });

/**
 * Productos más vendidos del periodo, con el stock al inicio, lo vendido y el saldo actual.
 * El administrador y el contador ven todas las ventas; quien vende, solo las suyas (el stock siempre es el de la botica).
 * Stock al inicio = saldo actual − movimientos del kardex desde el inicio del periodo (compras, ventas, salidas…).
 */
export async function masVendidosPanel(db: Db, user: Sesion, q: z.infer<typeof esquemaMasVendidos>) {
  const hoy = hoyLima();
  const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
  const inicio = q.periodo === "dia" ? hoy : q.periodo === "semana" ? sumarDias(hoy, -((dow + 6) % 7)) : q.periodo === "mes" ? `${hoy.slice(0, 7)}-01` : `${hoy.slice(0, 4)}-01-01`;
  const desde = inicioDiaLima(inicio).toISOString();
  const propias = !tieneRol(user.roles, "ADMIN", "CONTADOR");
  const rows = await filas<{ id: number; codigo: string; nombre: string; vendida: string; saldo: string; movido: string }>(db, sql`
    with vend as (
      select vd.producto_id, sum(vd.unidades) as vendida
      from venta_detalle vd join venta v on v.id = vd.venta_id
      where v.estado = 'EMITIDA' and v.fecha >= ${desde} ${propias ? sql`and v.usuario_id = ${user.id}` : sql``}
      group by vd.producto_id order by 2 desc limit 10)
    select p.id, p.codigo, p.nombre, vend.vendida,
      (select coalesce(sum(l.cantidad), 0) from lote l where l.producto_id = p.id) as saldo,
      (select coalesce(sum(k.entrada - k.salida), 0) from kardex k where k.producto_id = p.id and k.fecha >= ${desde}) as movido
    from vend join producto p on p.id = vend.producto_id
    order by vend.vendida desc, p.nombre`);
  return {
    periodo: q.periodo, desde: inicio, propias,
    productos: rows.map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, stockInicial: Number(r.saldo) - Number(r.movido), vendida: Number(r.vendida), saldo: Number(r.saldo) })),
  };
}

export const esquemaVentasAnuales = z.object({
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.preprocess(vacioComoFalta, z.coerce.number().int().min(1).max(12).optional()),
});

/**
 * Ventas de cada mes del año con su cuota. El administrador y el contador ven la botica completa (todas las cajas y vendedores)
 * y cómo se reparte entre vendedores el mes elegido; quien vende ve lo suyo y el avance de su cuota.
 */
export async function ventasAnualesPanel(db: Db, user: Sesion, q: z.infer<typeof esquemaVentasAnuales>) {
  const hoy = hoyLima();
  const anio = q.anio ?? Number(hoy.slice(0, 4));
  const mesActual = anio === Number(hoy.slice(0, 4)) ? Number(hoy.slice(5, 7)) : anio < Number(hoy.slice(0, 4)) ? 12 : 1;
  const mes = q.mes ?? mesActual;
  const gestiona = tieneRol(user.roles, "ADMIN", "CONTADOR");
  const c = await cumplimientoCuotas(db, user, { anio, usuarioId: gestiona ? null : user.id });
  const meses = c.meses.map((m) => ({ mes: m.mes, vendido: m.vendido, meta: m.meta, porcentaje: m.porcentaje, estado: m.estado }));
  const clave = `${anio}-${dos(mes)}`;
  let porVendedor: { usuarioId: number; nombre: string; total: number }[] = [];
  if (gestiona) {
    const fin = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${dos(mes + 1)}-01`;
    const rows = await filas<{ usuario_id: number; nombre: string; total: string }>(db, sql`
      select v.usuario_id, u.nombre, sum(v.total - v.delivery) as total
      from venta v join usuario u on u.id = v.usuario_id
      where v.estado = 'EMITIDA' and v.fecha >= ${inicioDiaLima(`${clave}-01`).toISOString()} and v.fecha < ${inicioDiaLima(fin).toISOString()}
      group by v.usuario_id, u.nombre order by 3 desc`);
    porVendedor = rows.map((r) => ({ usuarioId: Number(r.usuario_id), nombre: r.nombre, total: r2(Number(r.total)) }));
  }
  const anios = await filas<{ anio: string }>(db, sql`
    select distinct to_char(fecha at time zone 'America/Lima', 'YYYY') as anio from venta where estado = 'EMITIDA' ${gestiona ? sql`` : sql`and usuario_id = ${user.id}`} order by 1 desc`);
  return {
    anio, mes, propias: !gestiona, meses, porVendedor,
    seleccionado: meses.find((m) => m.mes === clave) ?? null,
    total: r2(meses.reduce((a, m) => a + m.vendido, 0)),
    anios: [...new Set([Number(hoy.slice(0, 4)), anio, ...anios.map((a) => Number(a.anio))])].sort((a, b) => b - a),
  };
}
