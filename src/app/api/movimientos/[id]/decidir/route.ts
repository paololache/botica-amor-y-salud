import { cuerpo, ruta } from "@/lib/api";
import { decidirMovimiento, esquemaDecision } from "@/lib/services/salidas";

export const POST = ruta("salidas.aprobar", async ({ db, user, req, params }) => decidirMovimiento(db, user, Number(params.id), esquemaDecision.parse(await cuerpo(req))));
