import { cuerpo, ruta } from "@/lib/api";
import { editarUsuario, eliminarUsuario, esquemaEdicionUsuario } from "@/lib/services/usuarios";

export const PUT = ruta("usuarios.gestionar", async ({ db, user, req, params }) => editarUsuario(db, user, Number(params.id), esquemaEdicionUsuario.parse(await cuerpo(req))));
export const DELETE = ruta("usuarios.gestionar", ({ db, user, params }) => eliminarUsuario(db, user, Number(params.id)));
