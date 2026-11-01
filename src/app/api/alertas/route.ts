import { ruta } from "@/lib/api";
import { alertasDelRol } from "@/lib/services/alertas";

export const GET = ruta("panel", ({ db, user, req }) => alertasDelRol(db, user.roles, { tipo: req.nextUrl.searchParams.get("tipo") ?? undefined, limite: 200 }));
