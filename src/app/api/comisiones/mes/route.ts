import { ruta } from "@/lib/api";
import { resumenMes } from "@/lib/services/comisiones";
import { hoy } from "@/lib/util";
import { mes } from "@/lib/validacion";

export const GET = ruta("comisiones.reporte", ({ db, req }) => resumenMes(db, mes.parse(req.nextUrl.searchParams.get("mes") ?? hoy().slice(0, 7))));
