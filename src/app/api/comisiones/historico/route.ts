import { ruta } from "@/lib/api";
import { esquemaHistoricoComisiones, historicoComisiones } from "@/lib/services/comisiones";

export const GET = ruta("comisiones.ver", ({ db, user, req }) =>
  historicoComisiones(db, user, esquemaHistoricoComisiones.parse(Object.fromEntries(req.nextUrl.searchParams))));
