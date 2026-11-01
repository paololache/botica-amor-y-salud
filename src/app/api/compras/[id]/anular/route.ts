import { cuerpo, ruta } from "@/lib/api";
import { anularCompra, esquemaAnulacion } from "@/lib/services/compras";

export const POST = ruta("compras.costear", async ({ db, user, req, params }) => anularCompra(db, user, Number(params.id), esquemaAnulacion.parse(await cuerpo(req))));
