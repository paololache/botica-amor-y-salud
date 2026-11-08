import { cuerpo, ruta } from "@/lib/api";
import { aprobarTransferencia, esquemaAprobacion } from "@/lib/services/transferencias";

export const POST = ruta("transferencias.aprobar", async ({ db, user, req, params }) => aprobarTransferencia(db, user, Number(params.id), esquemaAprobacion.parse(await cuerpo(req))));
