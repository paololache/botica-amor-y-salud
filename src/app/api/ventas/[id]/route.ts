import { ruta } from "@/lib/api";
import { datosEmpresa } from "@/lib/empresa";
import { detalleVenta } from "@/lib/services/ventas";

export const GET = ruta("ventas.ver", async ({ db, params }) => ({
  ...(await detalleVenta(db, Number(params.id))),
  empresa: datosEmpresa(),
  sunatModo: process.env.SUNAT_MODO ?? "simulado",
}));
