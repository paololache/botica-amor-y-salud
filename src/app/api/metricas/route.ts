import { cuerpo, ruta } from "@/lib/api";
import { borrarMetrica, crearMetrica, esquemaMetrica } from "@/lib/services/reportes";

export const POST = ruta("metricas.crear", async ({ db, user, req }) => crearMetrica(db, user, esquemaMetrica.parse(await cuerpo(req))));
export const DELETE = ruta("metricas.crear", ({ db, req }) => borrarMetrica(db, Number(req.nextUrl.searchParams.get("id"))));
