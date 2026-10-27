import { cuerpo, ruta } from "@/lib/api";
import { esquemaRecepcion, listarCompras, registrarRecepcion } from "@/lib/services/compras";

export const GET = ruta("compras.recibir", ({ db, req }) => listarCompras(db, req.nextUrl.searchParams.get("estado") ?? undefined));
export const POST = ruta("compras.recibir", async ({ db, user, req }) => registrarRecepcion(db, user, esquemaRecepcion.parse(await cuerpo(req))));
