import { cuerpo, ruta } from "@/lib/api";
import { atenderAlerta, esquemaAtencion } from "@/lib/services/alertas";

export const POST = ruta("alertas", async ({ db, user, req, params }) => atenderAlerta(db, user, Number(params.id), esquemaAtencion.parse(await cuerpo(req))));
