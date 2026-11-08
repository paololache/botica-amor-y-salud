import { ruta } from "@/lib/api";
import { cumplimientoCuotas } from "@/lib/services/metas";
import { enRango, hoy } from "@/lib/util";

export const GET = ruta("reportes", ({ db, user, req }) => {
  const q = req.nextUrl.searchParams;
  const u = q.get("usuario");
  return cumplimientoCuotas(db, user, { anio: enRango(q.get("anio"), Number(hoy().slice(0, 4)), 2000, 2100), usuarioId: u ? enRango(u, 0, 1, 2147483647) : null });
});
