import { cuerpo, ruta } from "@/lib/api";
import { esquemaMetasMes, guardarMetasMes, metasDelMes } from "@/lib/services/metas";
import { hoy } from "@/lib/util";

export const GET = ruta("metas.gestionar", ({ db, req }) => metasDelMes(db, req.nextUrl.searchParams.get("mes") ?? hoy().slice(0, 7)));
export const PUT = ruta("metas.gestionar", async ({ db, user, req }) => guardarMetasMes(db, user, esquemaMetasMes.parse(await cuerpo(req))));
