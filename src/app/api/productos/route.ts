import { enRango, esIdValido } from "@/lib/util";
import { cuerpo, ruta } from "@/lib/api";
import { buscarProductos, crearProducto, esquemaProducto, listarStock } from "@/lib/services/productos";

export const GET = ruta("productos.ver", async ({ db, req }) => {
  const u = req.nextUrl.searchParams;
  const sinNulos = (t: string | null) => t?.replace(/\0/g, "");
  if (u.get("buscar") !== null) return buscarProductos(db, sinNulos(u.get("buscar")) ?? "", enRango(u.get("limite"), 12, 1, 100));
  const categoria = u.get("categoria");
  return listarStock(db, { q: sinNulos(u.get("q")), categoriaId: categoria && esIdValido(categoria) ? Number(categoria) : undefined, filtro: u.get("filtro") ?? undefined, pagina: enRango(u.get("pagina"), 1, 1, 100000) });
});

export const POST = ruta("productos.gestionar", async ({ db, user, req }) => crearProducto(db, user, esquemaProducto.parse(await cuerpo(req))));
