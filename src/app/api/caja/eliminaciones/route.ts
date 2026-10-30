import { ruta } from "@/lib/api";
import { listarEliminaciones } from "@/lib/services/caja";

export const GET = ruta("caja.auditoria", ({ db, req }) => listarEliminaciones(db, Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 30))));
