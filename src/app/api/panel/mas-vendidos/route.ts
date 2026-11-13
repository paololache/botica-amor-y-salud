import { ruta } from "@/lib/api";
import { esquemaMasVendidos, masVendidosPanel } from "@/lib/services/panel";

export const GET = ruta("panel", ({ db, user, req }) => masVendidosPanel(db, user, esquemaMasVendidos.parse(Object.fromEntries(req.nextUrl.searchParams))));
