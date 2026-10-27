import { ruta } from "@/lib/api";
import { panel } from "@/lib/services/panel";

export const GET = ruta("panel", ({ db, user }) => panel(db, user));
