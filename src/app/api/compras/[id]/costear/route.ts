import { cuerpo, ruta } from "@/lib/api";
import { costearCompra, esquemaCosteo } from "@/lib/services/compras";

export const POST = ruta("compras.costear", async ({ db, user, req, params }) => costearCompra(db, user, Number(params.id), esquemaCosteo.parse(await cuerpo(req))));
