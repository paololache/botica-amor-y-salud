import { cuerpo, ruta } from "@/lib/api";
import { esquemaAtencion, listarAtenciones, registrarAtencion } from "@/lib/services/servicios";
import { esFechaValida } from "@/lib/util";

export const GET = ruta("servicios.ver", ({ db, user, req }) => {
  const q = req.nextUrl.searchParams;
  const f = (k: string) => { const v = q.get(k); return v && esFechaValida(v) ? v : undefined; };
  const s = Number(q.get("servicio"));
  return listarAtenciones(db, user, { desde: f("desde"), hasta: f("hasta"), buscar: q.get("buscar") ?? undefined, servicioId: Number.isInteger(s) && s > 0 ? s : undefined, derivar: q.get("derivar") === "1" });
});
export const POST = ruta("servicios", async ({ db, user, req }) => registrarAtencion(db, user, esquemaAtencion.parse(await cuerpo(req))));
