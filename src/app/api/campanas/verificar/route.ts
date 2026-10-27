import { ruta } from "@/lib/api";
import { verificarProductoKardex } from "@/lib/services/campanas";

export const GET = ruta("campanas", ({ db, req }) => verificarProductoKardex(db, req.nextUrl.searchParams.get("codigo") ?? ""));
