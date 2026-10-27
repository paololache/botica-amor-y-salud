import { cuerpo, ruta } from "@/lib/api";
import { crearVenta, esquemaVenta, listarVentas } from "@/lib/services/ventas";

export const GET = ruta("ventas.ver", ({ db, user, req }) => listarVentas(db, user, Number(req.nextUrl.searchParams.get("dias") ?? 7)));
export const POST = ruta("ventas", async ({ db, user, req }) => crearVenta(db, user, esquemaVenta.parse(await cuerpo(req))));
