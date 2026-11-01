import { z } from "zod";
import { ruta } from "@/lib/api";
import { reporteEspecial } from "@/lib/services/reportes";
import { enRango } from "@/lib/util";
import { fechaOpcional } from "@/lib/validacion";

const fechas = z.object({ desde: fechaOpcional, hasta: fechaOpcional });

export const GET = ruta("reportes", ({ db, user, params, req }) => {
  const u = req.nextUrl.searchParams;
  const { desde, hasta } = fechas.parse({ desde: u.get("desde"), hasta: u.get("hasta") });
  return reporteEspecial(db, user, params.id, { desde, hasta, dias: u.get("dias") ? enRango(u.get("dias"), 30, 1, 3650) : undefined });
}, { idTexto: true });
