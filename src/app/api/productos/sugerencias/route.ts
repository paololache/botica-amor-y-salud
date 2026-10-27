import { z } from "zod";
import { cuerpo, ruta } from "@/lib/api";
import { sugerirComplementos } from "@/lib/services/productos";

export const POST = ruta("ventas", async ({ db, req }) => {
  const { ids } = z.object({ ids: z.array(z.number().int()).max(60) }).parse(await cuerpo(req));
  return sugerirComplementos(db, ids);
});
