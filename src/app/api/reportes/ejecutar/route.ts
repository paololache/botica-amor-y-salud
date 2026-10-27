import { cuerpo, ruta } from "@/lib/api";
import { ejecutarReporte, esquemaConsulta } from "@/lib/services/reportes";

export const POST = ruta("reportes", async ({ db, user, req }) => ejecutarReporte(db, user.rol, esquemaConsulta.parse(await cuerpo(req))));
