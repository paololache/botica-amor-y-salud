import { ruta } from "@/lib/api";
import { reporteEspecial } from "@/lib/services/reportes";

export const GET = ruta("reportes", ({ db, user, params, req }) => {
  const u = req.nextUrl.searchParams;
  return reporteEspecial(db, user, params.id, { desde: u.get("desde") ?? undefined, hasta: u.get("hasta") ?? undefined, dias: u.get("dias") ? Number(u.get("dias")) : undefined });
});
