import { cuerpo, ruta } from "@/lib/api";
import { eliminarMovimiento, esquemaEliminacion } from "@/lib/services/caja";

export const DELETE = ruta("caja", async ({ db, user, params, req }) => eliminarMovimiento(db, user, Number(params.id), esquemaEliminacion.parse(await cuerpo(req))));
