import { ruta } from "@/lib/api";
import { verCostos } from "@/lib/permisos";
import { CATALOGO, metricasDisponibles, misReportes, opcionesFiltros } from "@/lib/services/reportes";

export const GET = ruta("reportes", async ({ db, user }) => ({
  catalogo: CATALOGO.filter((c) => !("soloCostos" in c) || verCostos(user.roles)),
  metricas: await metricasDisponibles(db, user.roles),
  guardados: await misReportes(db, user),
  opciones: await opcionesFiltros(db),
}));
