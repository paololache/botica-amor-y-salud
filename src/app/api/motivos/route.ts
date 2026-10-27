import { ruta } from "@/lib/api";
import { listarMotivos } from "@/lib/services/salidas";

export const GET = ruta("salidas.registrar", ({ db }) => listarMotivos(db));
