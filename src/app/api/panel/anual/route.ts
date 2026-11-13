import { ruta } from "@/lib/api";
import { esquemaVentasAnuales, ventasAnualesPanel } from "@/lib/services/panel";

export const GET = ruta("panel", ({ db, user, req }) => ventasAnualesPanel(db, user, esquemaVentasAnuales.parse(Object.fromEntries(req.nextUrl.searchParams))));
