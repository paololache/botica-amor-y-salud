import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol } from "../permisos";
import { filas } from "../sqlrows";
import { ErrorNegocio, esFechaValida, hoy as hoyLima, inicioDiaLima, r2, sumarDias } from "../util";
import { accesosFrecuentes } from "./accesos";
import { avanceDelMes, metaDelDia } from "./metas";
import { alertasDelRol, evaluarAlertas } from "./alertas";
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
    select to_char(v.fecha at time zone 'America/Lima', ${formato}) as grupo, sum(v.total) as total, count(*) as tickets
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
  await evaluarAlertas(db);
  const propias = !tieneRol(user.roles, "ADMIN", "CONTADOR");
  const ventasDe = async (desde: string) => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(desde))];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number), tickets: sql<number>`count(*)`.mapWith(Number) }).from(venta).where(and(...cond));
    return { total: r2(r?.total ?? 0), tickets: r?.tickets ?? 0 };
  };
  const [dia, mes, alertas, caja, comisiones, tarjetas, accesos, meta, cuota] = await Promise.all([
    ventasDe(hoy), ventasDe(hoy.slice(0, 8) + "01"), alertasDelRol(db, user.roles, { limite: 0 }),
    tieneRol(user.roles, "ADMIN", "CAJERO", "VENDEDOR", "QF") ? estadoCaja(db, user) : Promise.resolve(null),
    tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? misComisiones(db, user.id) : Promise.resolve(null),
    tarjetasPanel(db, user.roles),
    accesosFrecuentes(db, user),
    tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? metaDelDia(db, user.id) : Promise.resolve(null),
    // La cuota del mes: el administrador y el contador ven la de la botica; quien vende, la suya.
    tieneRol(user.roles, "ADMIN", "CONTADOR") ? avanceDelMes(db, null) : tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? avanceDelMes(db, user.id) : Promise.resolve(null),
  ]);
  const ayer = await (async () => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(sumarDias(hoy, -1))), sql`${venta.fecha} < ${inicioDiaLima(hoy).toISOString()}`];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number) }).from(venta).where(and(...cond));
    return r2(r?.total ?? 0);
  })();
  return { hoy, ventas: { dia, mes, ayer, propias }, alertas, caja: caja ? { sesion: caja.sesion, resumen: caja.resumen } : null, comisiones, tarjetas, accesos, meta, cuota: cuota ? { ...cuota, deBotica: tieneRol(user.roles, "ADMIN", "CONTADOR") } : null };
}
