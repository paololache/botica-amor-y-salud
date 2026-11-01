import { ErrorNegocio, esIdValido } from "@/lib/util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { cuerpo, ruta } from "@/lib/api";
import { listarComplementos } from "@/lib/services/productos";

const esquema = z.object({ origenTipo: z.enum(["PRODUCTO", "PRINCIPIO_ACTIVO", "CATEGORIA"]), origenValor: z.string().min(1), productoId: z.number().int(), mensaje: z.string().optional(), prioridad: z.number().int().min(1).max(9).default(5) });

export const GET = ruta("complementos", ({ db }) => listarComplementos(db));
export const POST = ruta("complementos", async ({ db, req }) => (await db.insert(schema.complemento).values(esquema.parse(await cuerpo(req))).returning())[0]);
export const DELETE = ruta("complementos", async ({ db, req }) => {
  const valor = req.nextUrl.searchParams.get("id") ?? "";
  if (!esIdValido(valor)) throw new ErrorNegocio("NO_EXISTE", "La asociación no existe.", 404);
  const id = Number(valor);
  await db.delete(schema.complemento).where(eq(schema.complemento.id, id));
  return { id };
});
