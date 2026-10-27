import { ruta } from "@/lib/api";
import { fichaProducto } from "@/lib/services/productos";
import { ErrorNegocio } from "@/lib/util";

export const GET = ruta("productos.ver", async ({ db, params }) => {
  const p = await fichaProducto(db, Number(params.id));
  if (!p) throw new ErrorNegocio("NO_EXISTE", "El producto no existe.", 404);
  return p;
});
