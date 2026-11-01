import { cuerpo, ruta } from "@/lib/api";
import { eliminarLaboratorio, esquemaRenombrarLaboratorio, renombrarLaboratorio } from "@/lib/services/laboratorios";

export const PATCH = ruta("productos.gestionar", async ({ db, user, params, req }) => renombrarLaboratorio(db, user, Number(params.id), esquemaRenombrarLaboratorio.parse(await cuerpo(req))));
export const DELETE = ruta("productos.gestionar", ({ db, user, params }) => eliminarLaboratorio(db, user, Number(params.id)));
