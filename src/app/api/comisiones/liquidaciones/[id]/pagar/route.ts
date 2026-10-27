import { ruta } from "@/lib/api";
import { pagarLiquidacion } from "@/lib/services/comisiones";

export const POST = ruta("comisiones.admin", ({ db, user, params }) => pagarLiquidacion(db, user, Number(params.id)));
