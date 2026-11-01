import { enRango } from "@/lib/util";
import { cuerpo, ruta } from "@/lib/api";
import { crearVenta, esquemaVenta, listarVentas } from "@/lib/services/ventas";

export const GET = ruta("ventas.ver", ({ db, user, req }) => listarVentas(db, user, enRango(req.nextUrl.searchParams.get("dias"), 7, 1, 366)));
export const POST = ruta("ventas", async ({ db, user, req }) => crearVenta(db, user, esquemaVenta.parse(await cuerpo(req))));
