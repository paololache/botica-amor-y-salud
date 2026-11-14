import { ruta } from "@/lib/api";
import { historialPaciente } from "@/lib/services/servicios";

export const GET = ruta("servicios.ver", ({ db, req }) => historialPaciente(db, (req.nextUrl.searchParams.get("doc") ?? "").trim().slice(0, 12)));
