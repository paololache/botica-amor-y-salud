import { cuerpo, ruta } from "@/lib/api";
import { esquemaTransferencia, listarTransferencias, registrarTransferencia } from "@/lib/services/transferencias";

const ESTADOS = ["PENDIENTE", "APROBADA", "RECHAZADA"];

export const GET = ruta("transferencias.registrar", ({ db, user, req }) => {
  const estado = req.nextUrl.searchParams.get("estado") ?? "";
  return listarTransferencias(db, user, ESTADOS.includes(estado) ? estado : undefined);
});
export const POST = ruta("transferencias.registrar", async ({ db, user, req }) => registrarTransferencia(db, user, esquemaTransferencia.parse(await cuerpo(req))));
