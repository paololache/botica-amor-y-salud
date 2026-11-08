import { cuerpo, ruta } from "@/lib/api";
import { esquemaUso, registrarUso } from "@/lib/services/accesos";

/** La navegación avisa qué sección se abrió; alimenta los accesos rápidos del panel. */
export const POST = ruta("panel", async ({ db, user, req }) => registrarUso(db, user, esquemaUso.parse(await cuerpo(req)).ruta));
