import { cuerpo, ruta } from "@/lib/api";
import { crearCampana, esquemaCampana, listarCampanas } from "@/lib/services/campanas";

export const GET = ruta("campanas", ({ db }) => listarCampanas(db));
export const POST = ruta("campanas", async ({ db, user, req }) => crearCampana(db, user, esquemaCampana.parse(await cuerpo(req))));
