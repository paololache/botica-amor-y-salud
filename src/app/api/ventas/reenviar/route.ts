import { ruta } from "@/lib/api";
import { reenviarPendientes } from "@/lib/services/ventas";

export const POST = ruta("ventas.anular", ({ db }) => reenviarPendientes(db));
