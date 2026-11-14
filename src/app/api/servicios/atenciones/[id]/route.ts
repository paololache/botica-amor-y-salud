import { ruta } from "@/lib/api";
import { detalleAtencion } from "@/lib/services/servicios";

export const GET = ruta("servicios.ver", ({ db, user, params }) => detalleAtencion(db, user, Number(params.id)));
