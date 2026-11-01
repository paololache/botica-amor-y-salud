import { cuerpo, ruta } from "@/lib/api";
import { crearLaboratorio, esquemaCrearLaboratorio, listarLaboratorios } from "@/lib/services/laboratorios";

export const GET = ruta("productos.gestionar", ({ db }) => listarLaboratorios(db));
export const POST = ruta("productos.gestionar", async ({ db, user, req }) => crearLaboratorio(db, user, esquemaCrearLaboratorio.parse(await cuerpo(req))));
