import { cuerpo, ruta } from "@/lib/api";
import { abrirCaja, esquemaApertura } from "@/lib/services/caja";

export const POST = ruta("caja", async ({ db, user, req }) => abrirCaja(db, user, esquemaApertura.parse(await cuerpo(req))));
