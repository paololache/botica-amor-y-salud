import { modoSunat } from "@/lib/services/sunat";
import { ruta } from "@/lib/api";
import { datosEmpresa } from "@/lib/empresa";
import { detalleVenta } from "@/lib/services/ventas";

export const GET = ruta("ventas.ver", async ({ db, user, params }) => ({
  ...(await detalleVenta(db, Number(params.id), user)),
  empresa: datosEmpresa(),
  sunatModo: modoSunat(),
}));
