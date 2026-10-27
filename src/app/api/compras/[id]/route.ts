import { ruta } from "@/lib/api";
import { detalleCompra } from "@/lib/services/compras";

export const GET = ruta("compras.recibir", ({ db, params }) => detalleCompra(db, Number(params.id)));
