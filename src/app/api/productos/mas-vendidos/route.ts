import { ruta } from "@/lib/api";
import { masVendidos } from "@/lib/services/productos";

export const GET = ruta("ventas", async ({ db }) => masVendidos(db));
