import { ruta } from "@/lib/api";
import { PERMISOS, puede, verCostos, type Permiso } from "@/lib/permisos";

export const GET = ruta("panel", async ({ user }) => ({
  usuario: user, verCostos: verCostos(user.roles),
  permisos: (Object.keys(PERMISOS) as Permiso[]).filter((p) => puede(user.roles, p)),
}));
