import { cuerpo, ruta } from "@/lib/api";
import { validarCierre, esquemaValidacion } from "@/lib/services/caja";

export const POST = ruta("caja", async ({ db, user, req }) => validarCierre(db, user, esquemaValidacion.parse(await cuerpo(req))));
