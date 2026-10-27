import { asc } from "drizzle-orm";
import { schema } from "@/db";
import { ruta } from "@/lib/api";

export const GET = ruta("reportes", ({ db }) => db.select({ id: schema.usuario.id, nombre: schema.usuario.nombre, rol: schema.usuario.rol }).from(schema.usuario).orderBy(asc(schema.usuario.nombre)));
