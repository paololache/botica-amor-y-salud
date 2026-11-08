import { ruta } from "@/lib/api";
import { recordatorioCampanas } from "@/lib/services/campanas";

export const GET = ruta("ventas", ({ db, user }) => recordatorioCampanas(db, user));
