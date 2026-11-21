import { ruta } from "@/lib/api";
import { siguienteCodigo } from "@/lib/services/productos";

export const GET = ruta("productos.gestionar", ({ db, req }) => siguienteCodigo(db, req.nextUrl.searchParams.get("despues")));
