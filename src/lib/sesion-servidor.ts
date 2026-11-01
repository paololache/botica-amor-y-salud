import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COOKIE, leerSesion } from "./auth";

/** Sesión con los perfiles vigentes: `caducada` indica una cookie válida de un usuario que ya no está activo. */
export async function sesionActual() {
  const c = await cookies();
  const s = await leerSesion(c.get(COOKIE)?.value);
  if (!s) return { sesion: null, caducada: false };
  const db = await getDb();
  const [u] = await db.select({ nombre: schema.usuario.nombre, roles: schema.usuario.roles }).from(schema.usuario).where(and(eq(schema.usuario.id, s.id), eq(schema.usuario.activo, true)));
  return u ? { sesion: { ...s, ...u }, caducada: false } : { sesion: null, caducada: true };
}
