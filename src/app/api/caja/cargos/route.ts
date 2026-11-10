import { ruta } from "@/lib/api";
import { listarCargos } from "@/lib/services/caja";

export const GET = ruta("panel", ({ db, user, req }) => {
  const e = req.nextUrl.searchParams.get("estado");
  return listarCargos(db, user, e === "PENDIENTE" || e === "PAGADO" ? e : undefined);
});
