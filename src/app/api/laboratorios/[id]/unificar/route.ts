import { cuerpo, ruta } from "@/lib/api";
import { esquemaUnificarLaboratorio, unificarLaboratorios } from "@/lib/services/laboratorios";

export const POST = ruta("productos.gestionar", async ({ db, user, params, req }) => unificarLaboratorios(db, user, Number(params.id), esquemaUnificarLaboratorio.parse(await cuerpo(req)).destinoId));
