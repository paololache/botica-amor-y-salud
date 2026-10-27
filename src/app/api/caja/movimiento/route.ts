import { cuerpo, ruta } from "@/lib/api";
import { registrarMovimiento, esquemaMovimiento } from "@/lib/services/caja";

export const POST = ruta("caja", async ({ db, user, req }) => registrarMovimiento(db, user, esquemaMovimiento.parse(await cuerpo(req))));
