/**
 * Envío de comprobantes electrónicos (CPE).
 * SUNAT_MODO=simulado  → acepta al instante (ambiente de pruebas del MVP).
 * SUNAT_MODO=sin_conexion → deja el CPE PENDIENTE para probar la contingencia.
 * La integración con el OSE real se conecta aquí cuando se defina el proveedor.
 */
export type EstadoCpe = "PENDIENTE" | "ACEPTADO" | "RECHAZADO" | "NO_APLICA";

export async function enviarCpe(tipo: "BOLETA" | "FACTURA" | "NOTA_VENTA"): Promise<EstadoCpe> {
  if (tipo === "NOTA_VENTA") return "NO_APLICA";
  const modo = process.env.SUNAT_MODO ?? "simulado";
  if (modo === "simulado") return "ACEPTADO";
  return "PENDIENTE";
}
