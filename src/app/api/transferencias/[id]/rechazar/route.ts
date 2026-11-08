import { cuerpo, ruta } from "@/lib/api";
import { esquemaRechazo, rechazarTransferencia } from "@/lib/services/transferencias";

export const POST = ruta("transferencias.aprobar", async ({ db, user, req, params }) => rechazarTransferencia(db, user, Number(params.id), esquemaRechazo.parse(await cuerpo(req))));
