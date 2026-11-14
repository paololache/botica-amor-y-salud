import { cuerpo, ruta } from "@/lib/api";
import { editarServicio, esquemaServicio } from "@/lib/services/servicios";

export const PUT = ruta("servicios.catalogo", async ({ db, user, req, params }) => editarServicio(db, user, Number(params.id), esquemaServicio.parse(await cuerpo(req))));
