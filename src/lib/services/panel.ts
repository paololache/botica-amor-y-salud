import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { hoy as hoyLima, inicioDiaLima, r2, sumarDias } from "../util";
import { alertasDelRol, evaluarAlertas } from "./alertas";
import { estadoCaja } from "./caja";
import { misComisiones } from "./comisiones";
import { tarjetasPanel } from "./reportes";

const { venta, parametro } = schema;

/** En el plan Hobby de Vercel el cron corre una vez al día: el panel recalcula las alertas si tienen más de 15 minutos. */
async function alertasAlDia(db: Db) {
  const [p] = await db.select().from(parametro).where(eq(parametro.clave, "alertas_evaluadas_en"));
  if (p && Date.now() - Number(p.valor) < 15 * 60 * 1000) return;
  await db.insert(parametro).values({ clave: "alertas_evaluadas_en", valor: String(Date.now()) }).onConflictDoUpdate({ target: parametro.clave, set: { valor: String(Date.now()) } });
  await evaluarAlertas(db);
}

export async function panel(db: Db, user: Sesion) {
  const hoy = hoyLima();
  await alertasAlDia(db);
  const propias = !["ADMIN", "CONTADOR"].includes(user.rol);
  const ventasDe = async (desde: string) => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(desde))];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number), tickets: sql<number>`count(*)`.mapWith(Number) }).from(venta).where(and(...cond));
    return { total: r2(r?.total ?? 0), tickets: r?.tickets ?? 0 };
  };
  const [dia, mes, alertas, caja, comisiones, tarjetas] = await Promise.all([
    ventasDe(hoy), ventasDe(hoy.slice(0, 8) + "01"), alertasDelRol(db, user.rol, { limite: 40 }),
    ["ADMIN", "CAJERO", "VENDEDOR", "QF"].includes(user.rol) ? estadoCaja(db, user) : Promise.resolve(null),
    ["CAJERO", "VENDEDOR", "QF"].includes(user.rol) ? misComisiones(db, user.id) : Promise.resolve(null),
    tarjetasPanel(db, user.rol),
  ]);
  const ayer = await (async () => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(sumarDias(hoy, -1))), sql`${venta.fecha} < ${inicioDiaLima(hoy).toISOString()}`];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number) }).from(venta).where(and(...cond));
    return r2(r?.total ?? 0);
  })();
  return { hoy, ventas: { dia, mes, ayer, propias }, alertas, caja: caja ? { sesion: caja.sesion, resumen: caja.resumen } : null, comisiones, tarjetas };
}
