import { cuerpo, ruta } from "@/lib/api";
import { esquemaMovimiento, listarMovimientos, registrarMovimiento } from "@/lib/services/salidas";

export const GET = ruta("salidas.registrar", ({ db, user, req }) => listarMovimientos(db, user, req.nextUrl.searchParams.get("estado") ?? undefined));
export const POST = ruta("salidas.registrar", async ({ db, user, req }) => registrarMovimiento(db, user, esquemaMovimiento.parse(await cuerpo(req))));
