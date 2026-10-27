import { ruta } from "@/lib/api";
import { estadoCaja } from "@/lib/services/caja";

export const GET = ruta("caja", ({ db, user }) => estadoCaja(db, user));
