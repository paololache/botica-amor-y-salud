import { z } from "zod";
import { ruta } from "@/lib/api";
import { detalleVendedor } from "@/lib/services/comisiones";
import { mes } from "@/lib/validacion";

const esquema = z.object({ usuario: z.coerce.number().int().positive().max(2147483647), mes });

export const GET = ruta("comisiones.reporte", ({ db, req }) => {
  const { usuario, mes: elegido } = esquema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return detalleVendedor(db, usuario, elegido);
});
