import { ruta } from "@/lib/api";
import { consolidarHasta } from "@/lib/services/comisiones";
import { hoy } from "@/lib/util";

export const POST = ruta("comisiones.admin", ({ db }) => consolidarHasta(db, hoy()));
