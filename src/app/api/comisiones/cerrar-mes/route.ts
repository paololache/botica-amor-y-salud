import { z } from "zod";
import { cuerpo, ruta } from "@/lib/api";
import { cerrarMes } from "@/lib/services/comisiones";

export const POST = ruta("comisiones.admin", async ({ db, user, req }) => cerrarMes(db, user, z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }).parse(await cuerpo(req)).mes));
