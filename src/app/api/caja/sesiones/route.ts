import { ruta } from "@/lib/api";
import { listarSesiones } from "@/lib/services/caja";

export const GET = ruta("caja", ({ db, user }) => listarSesiones(db, user));
