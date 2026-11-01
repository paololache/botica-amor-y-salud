import { ErrorNegocio, esIdValido } from "@/lib/util";
import { cuerpo, ruta } from "@/lib/api";
import { borrarMetrica, crearMetrica, esquemaMetrica } from "@/lib/services/reportes";

export const POST = ruta("metricas.crear", async ({ db, user, req }) => crearMetrica(db, user, esquemaMetrica.parse(await cuerpo(req))));
export const DELETE = ruta("metricas.crear", ({ db, req }) => {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!esIdValido(id)) throw new ErrorNegocio("NO_EXISTE", "La métrica no existe.", 404);
  return borrarMetrica(db, Number(id));
});
