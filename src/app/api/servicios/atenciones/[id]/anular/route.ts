import { cuerpo, ruta } from "@/lib/api";
import { anularAtencion, esquemaAnulacionAtencion } from "@/lib/services/servicios";

export const POST = ruta("servicios", async ({ db, user, req, params }) => anularAtencion(db, user, Number(params.id), esquemaAnulacionAtencion.parse(await cuerpo(req))));
