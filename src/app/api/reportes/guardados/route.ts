import { cuerpo, ruta } from "@/lib/api";
import { esquemaGuardado, guardarReporte } from "@/lib/services/reportes";

export const POST = ruta("reportes", async ({ db, user, req }) => guardarReporte(db, user, esquemaGuardado.parse(await cuerpo(req))));
