import { ruta } from "@/lib/api";
import { PERMISOS, verCostos } from "@/lib/permisos";

export const GET = ruta("panel", async ({ user }) => ({
  usuario: user, verCostos: verCostos(user.rol),
  permisos: Object.entries(PERMISOS).filter(([, roles]) => (roles as string[]).includes(user.rol)).map(([p]) => p),
}));
