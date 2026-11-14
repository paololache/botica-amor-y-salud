import { cuerpo, ruta } from "@/lib/api";
import { esquemaCliente, guardarCliente, listarClientes, type Nivel } from "@/lib/services/clientes";

const NIVELES = ["NUEVO", "OCASIONAL", "FRECUENTE", "PREFERENTE"];
export const GET = ruta("clientes.ver", ({ db, req }) => {
  const q = req.nextUrl.searchParams;
  const n = q.get("nivel");
  return listarClientes(db, { buscar: q.get("buscar") ?? undefined, nivel: n && NIVELES.includes(n) ? (n as Nivel) : undefined });
});
export const POST = ruta("clientes", async ({ db, user, req }) => guardarCliente(db, user, esquemaCliente.parse(await cuerpo(req))));
