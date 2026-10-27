import { ruta } from "@/lib/api";
import { verCostos } from "@/lib/permisos";
import { CATALOGO, metricasDisponibles, misReportes } from "@/lib/services/reportes";

export const GET = ruta("reportes", async ({ db, user }) => ({
  catalogo: CATALOGO.filter((c) => !("soloCostos" in c) || verCostos(user.rol)),
  metricas: await metricasDisponibles(db, user.rol),
  guardados: await misReportes(db, user),
}));
