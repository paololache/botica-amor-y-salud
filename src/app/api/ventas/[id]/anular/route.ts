import { cuerpo, ruta } from "@/lib/api";
import { anularVenta, esquemaAnulacion } from "@/lib/services/ventas";

export const POST = ruta("ventas.anular", async ({ db, user, req, params }) => anularVenta(db, user, Number(params.id), esquemaAnulacion.parse(await cuerpo(req))));
