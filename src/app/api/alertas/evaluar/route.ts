import { ruta } from "@/lib/api";
import { evaluarAlertas } from "@/lib/services/alertas";

export const POST = ruta("alertas", ({ db }) => evaluarAlertas(db));
