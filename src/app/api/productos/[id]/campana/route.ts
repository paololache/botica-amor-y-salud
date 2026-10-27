import { ruta } from "@/lib/api";
import { alternarCampana } from "@/lib/services/campanas";

export const POST = ruta("campanas", ({ db, user, params }) => alternarCampana(db, user, Number(params.id)));
