import { z } from "zod";
import { cuerpo, ruta } from "@/lib/api";
import { cerrarMes } from "@/lib/services/comisiones";
import { mes } from "@/lib/validacion";

export const POST = ruta("comisiones.admin", async ({ db, user, req }) => cerrarMes(db, user, z.object({ mes }).parse(await cuerpo(req)).mes));
