import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol } from "../permisos";
import { hoy as hoyLima, inicioDiaLima, r2, sumarDias } from "../util";
import { alertasDelRol, evaluarAlertas } from "./alertas";
import { estadoCaja } from "./caja";
import { misComisiones } from "./comisiones";
import { tarjetasPanel } from "./reportes";

const { venta } = schema;

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
  const [dia, mes, alertas, caja, comisiones, tarjetas] = await Promise.all([
    ventasDe(hoy), ventasDe(hoy.slice(0, 8) + "01"), alertasDelRol(db, user.roles, { limite: 0 }),
    tieneRol(user.roles, "ADMIN", "CAJERO", "VENDEDOR", "QF") ? estadoCaja(db, user) : Promise.resolve(null),
    tieneRol(user.roles, "CAJERO", "VENDEDOR", "QF") ? misComisiones(db, user.id) : Promise.resolve(null),
    tarjetasPanel(db, user.roles),
  ]);
  const ayer = await (async () => {
    const cond = [eq(venta.estado, "EMITIDA"), gte(venta.fecha, inicioDiaLima(sumarDias(hoy, -1))), sql`${venta.fecha} < ${inicioDiaLima(hoy).toISOString()}`];
    if (propias) cond.push(eq(venta.usuarioId, user.id));
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${venta.total}),0)`.mapWith(Number) }).from(venta).where(and(...cond));
    return r2(r?.total ?? 0);
  })();
  return { hoy, ventas: { dia, mes, ayer, propias }, alertas, caja: caja ? { sesion: caja.sesion, resumen: caja.resumen } : null, comisiones, tarjetas };
}
