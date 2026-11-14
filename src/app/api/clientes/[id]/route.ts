import { cuerpo, ruta } from "@/lib/api";
import { detalleCliente, esquemaCliente, guardarCliente } from "@/lib/services/clientes";

export const GET = ruta("clientes.ver", ({ db, params }) => detalleCliente(db, Number(params.id)));
export const PUT = ruta("clientes", async ({ db, user, req, params }) => guardarCliente(db, user, esquemaCliente.parse(await cuerpo(req)), Number(params.id)));
