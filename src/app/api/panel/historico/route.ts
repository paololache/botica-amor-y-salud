import { ruta } from "@/lib/api";
import { esquemaHistorico, historicoVentas } from "@/lib/services/panel";

export const GET = ruta("ventas.ver", ({ db, user, req }) => historicoVentas(db, user, esquemaHistorico.parse(Object.fromEntries(req.nextUrl.searchParams))));
