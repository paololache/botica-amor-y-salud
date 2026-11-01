import { cuerpo, ruta } from "@/lib/api";
import { corregirCostoCompra, datosCorreccion, esquemaCorreccion } from "@/lib/services/compras";

export const GET = ruta("compras.costear", ({ db, params }) => datosCorreccion(db, Number(params.id)));
export const POST = ruta("compras.costear", async ({ db, user, req, params }) => corregirCostoCompra(db, user, Number(params.id), esquemaCorreccion.parse(await cuerpo(req))));
