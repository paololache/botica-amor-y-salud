import { ruta } from "@/lib/api";
import { reporteCierre } from "@/lib/services/caja";

export const GET = ruta("panel", ({ db, user, params }) => reporteCierre(db, user, Number(params.id)));
