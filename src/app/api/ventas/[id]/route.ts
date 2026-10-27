import { ruta } from "@/lib/api";
import { detalleVenta } from "@/lib/services/ventas";

export const GET = ruta("ventas.ver", ({ db, params }) => detalleVenta(db, Number(params.id)));
