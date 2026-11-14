import { ruta } from "@/lib/api";
import { completarPatologias } from "@/lib/services/productos";

/** GET: cuántos productos sin patología se pueden completar. POST: los completa. */
export const GET = ruta("productos.gestionar", ({ db, user }) => completarPatologias(db, user, { simular: true }));
export const POST = ruta("productos.gestionar", ({ db, user }) => completarPatologias(db, user));
