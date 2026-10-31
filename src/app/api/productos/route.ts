import { cuerpo, ruta } from "@/lib/api";
import { buscarProductos, crearProducto, esquemaProducto, listarStock } from "@/lib/services/productos";

export const GET = ruta("productos.ver", async ({ db, req }) => {
  const u = req.nextUrl.searchParams;
  if (u.get("buscar") !== null) return buscarProductos(db, u.get("buscar") ?? "", Number(u.get("limite") ?? 12));
  return listarStock(db, { q: u.get("q") ?? undefined, categoriaId: u.get("categoria") ? Number(u.get("categoria")) : undefined, filtro: u.get("filtro") ?? undefined, pagina: Number(u.get("pagina") ?? 1) });
});

export const POST = ruta("productos.gestionar", async ({ db, user, req }) => crearProducto(db, user, esquemaProducto.parse(await cuerpo(req))));
