import { cuerpo, ruta } from "@/lib/api";
import { crearUsuario, esquemaNuevoUsuario, listarUsuarios } from "@/lib/services/usuarios";

export const GET = ruta("usuarios.gestionar", ({ db }) => listarUsuarios(db));
export const POST = ruta("usuarios.gestionar", async ({ db, user, req }) => crearUsuario(db, user, esquemaNuevoUsuario.parse(await cuerpo(req))));
