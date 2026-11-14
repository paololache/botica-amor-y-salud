import { ruta } from "@/lib/api";
import { consultarCliente } from "@/lib/services/clientes";

export const GET = ruta("clientes.ver", ({ db, req }) => consultarCliente(db, (req.nextUrl.searchParams.get("numero") ?? "").replace(/\D/g, "").slice(0, 11)));
