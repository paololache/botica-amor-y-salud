import { cuerpo, ruta } from "@/lib/api";
import { crearCategoria, esquemaCategoria, listarCategorias } from "@/lib/services/categorias";

export const GET = ruta("productos.ver", ({ db }) => listarCategorias(db));
export const POST = ruta("productos.gestionar", async ({ db, user, req }) => crearCategoria(db, user, esquemaCategoria.parse(await cuerpo(req))));
