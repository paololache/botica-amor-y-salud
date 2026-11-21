import { cuerpo, ruta } from "@/lib/api";
import { eliminarCategoria, esquemaCategoria, renombrarCategoria } from "@/lib/services/categorias";

export const PATCH = ruta("productos.gestionar", async ({ db, user, req, params }) => renombrarCategoria(db, user, Number(params.id), esquemaCategoria.parse(await cuerpo(req))));
export const DELETE = ruta("productos.gestionar", ({ db, user, params }) => eliminarCategoria(db, user, Number(params.id)));
