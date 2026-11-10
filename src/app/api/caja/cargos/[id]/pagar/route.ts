import { ruta } from "@/lib/api";
import { pagarCargo } from "@/lib/services/caja";

export const POST = ruta("caja.regularizar", ({ db, user, params }) => pagarCargo(db, user, Number(params.id)));
