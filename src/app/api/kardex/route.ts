import { z } from "zod";
import { ruta } from "@/lib/api";
import { consultarKardex } from "@/lib/services/kardex";
import { fechaOpcional } from "@/lib/validacion";

const id = z.coerce.number().int().positive().max(2147483647);
const esquema = z.object({ productoId: id, desde: fechaOpcional, hasta: fechaOpcional, loteId: z.preprocess((v) => v || undefined, id.optional()) });

export const GET = ruta("kardex", ({ db, req }) => {
  const q = esquema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return consultarKardex(db, q.productoId, q.desde, q.hasta, q.loteId);
});
