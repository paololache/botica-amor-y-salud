import { ruta } from "@/lib/api";
import { listarServicios } from "@/lib/services/servicios";

export const GET = ruta("servicios.ver", ({ db, user, req }) => listarServicios(db, user, req.nextUrl.searchParams.get("todos") === "1"));
