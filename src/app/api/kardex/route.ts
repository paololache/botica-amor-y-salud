import { ruta } from "@/lib/api";
import { consultarKardex } from "@/lib/services/kardex";

export const GET = ruta("kardex", ({ db, req }) => {
  const u = req.nextUrl.searchParams;
  return consultarKardex(db, Number(u.get("productoId")), u.get("desde") ?? undefined, u.get("hasta") ?? undefined, u.get("loteId") ? Number(u.get("loteId")) : undefined);
});
