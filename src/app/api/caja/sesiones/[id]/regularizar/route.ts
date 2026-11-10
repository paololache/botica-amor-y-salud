import { cuerpo, ruta } from "@/lib/api";
import { esquemaRegularizacion, regularizarPago } from "@/lib/services/caja";

export const POST = ruta("caja.regularizar", async ({ db, user, req, params }) => regularizarPago(db, user, Number(params.id), esquemaRegularizacion.parse(await cuerpo(req))));
