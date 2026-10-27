import { ruta } from "@/lib/api";
import { resumenMes } from "@/lib/services/comisiones";
import { hoy } from "@/lib/util";

export const GET = ruta("comisiones.reporte", ({ db, req }) => resumenMes(db, req.nextUrl.searchParams.get("mes") ?? hoy().slice(0, 7)));
