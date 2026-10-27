import { ruta } from "@/lib/api";
import { misComisiones } from "@/lib/services/comisiones";

export const GET = ruta("comisiones.propias", ({ db, user }) => misComisiones(db, user.id));
