import { cuerpo, ruta } from "@/lib/api";
import { esquemaRegularizacionEfectivo, regularizarEfectivo } from "@/lib/services/caja";

export const POST = ruta("caja.regularizar", async ({ db, user, req, params }) => regularizarEfectivo(db, user, Number(params.id), esquemaRegularizacionEfectivo.parse(await cuerpo(req))));
