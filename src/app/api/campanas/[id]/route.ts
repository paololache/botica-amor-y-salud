import { cuerpo, ruta } from "@/lib/api";
import { cambiarCampana, esquemaCambioCampana } from "@/lib/services/campanas";

export const PATCH = ruta("campanas", async ({ db, user, req, params }) => cambiarCampana(db, user, Number(params.id), esquemaCambioCampana.parse(await cuerpo(req))));
