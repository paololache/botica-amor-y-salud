import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { MODULOS, tieneRol, type Rol } from "../permisos";

const { usoModulo } = schema;
const MAXIMO = 4;
/** Secciones de partida mientras el usuario no tiene historial suficiente, en este orden. */
const DE_PARTIDA = ["/vender", "/caja", "/ventas", "/productos", "/transferencias", "/compras", "/kardex", "/reportes", "/comisiones"];

const visibles = (roles: readonly Rol[]) => MODULOS.filter((m) => !m.oculto && m.href !== "/" && tieneRol(roles, ...m.roles));

/** Sección del menú a la que pertenece una ruta (las subpáginas cuentan para su sección). */
function seccionDe(ruta: string, roles: readonly Rol[]) {
  return visibles(roles).filter((m) => ruta === m.href || ruta.startsWith(m.href + "/")).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export const esquemaUso = z.object({ ruta: z.string().max(200).regex(/^\//) });

export async function registrarUso(db: Db, user: Sesion, ruta: string) {
  const m = seccionDe(ruta, user.roles);
  if (!m) return { registrado: false };
  await db.insert(usoModulo).values({ usuarioId: user.id, ruta: m.href, visitas: 1 })
    .onConflictDoUpdate({ target: [usoModulo.usuarioId, usoModulo.ruta], set: { visitas: sql`${usoModulo.visitas} + 1`, ultima: new Date() } });
  return { registrado: true };
}

/** Hasta 4 secciones más usadas por el usuario, solo entre las que hoy puede abrir; se completan con las de partida. */
export async function accesosFrecuentes(db: Db, user: Sesion) {
  const permitidas = new Map(visibles(user.roles).map((m) => [m.href, m]));
  const usadas = await db.select({ ruta: usoModulo.ruta, visitas: usoModulo.visitas }).from(usoModulo)
    .where(eq(usoModulo.usuarioId, user.id)).orderBy(desc(usoModulo.visitas), desc(usoModulo.ultima));
  const elegidas: { href: string; texto: string; visitas: number }[] = [];
  for (const u of usadas) {
    const m = permitidas.get(u.ruta);
    if (m && elegidas.length < MAXIMO) elegidas.push({ href: m.href, texto: m.texto, visitas: u.visitas });
  }
  for (const href of [...DE_PARTIDA, ...permitidas.keys()]) {
    if (elegidas.length >= MAXIMO) break;
    const m = permitidas.get(href);
    if (m && !elegidas.some((e) => e.href === href)) elegidas.push({ href: m.href, texto: m.texto, visitas: 0 });
  }
  return elegidas;
}
