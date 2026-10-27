import { cuerpo, ruta } from "@/lib/api";
import { cerrarCaja, esquemaCierre } from "@/lib/services/caja";

export const POST = ruta("caja", async ({ db, user, req }) => cerrarCaja(db, user, esquemaCierre.parse(await cuerpo(req))));
