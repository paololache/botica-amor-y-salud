/**
 * Envío de comprobantes electrónicos (CPE).
 * SUNAT_MODO=manual (por defecto) → la botica declara sus comprobantes directamente con SUNAT según su régimen de RUC;
 *   el sistema no envía nada y no muestra estados de SUNAT.
 * SUNAT_MODO=simulado  → acepta al instante (ambiente de pruebas).
 * SUNAT_MODO=sin_conexion → deja el CPE PENDIENTE para probar la contingencia.
 * La integración con un OSE real se conecta aquí si algún día se define el proveedor.
 */
export type EstadoCpe = "PENDIENTE" | "ACEPTADO" | "RECHAZADO" | "NO_APLICA";

export const modoSunat = () => process.env.SUNAT_MODO || "manual";
export const sunatManual = () => modoSunat() === "manual";

/** Estado con que nace un comprobante que aún no se envía (p. ej. la factura de una transferencia). */
export const estadoInicialCpe = (): EstadoCpe => (sunatManual() ? "NO_APLICA" : "PENDIENTE");

export async function enviarCpe(tipo: "BOLETA" | "FACTURA" | "NOTA_VENTA"): Promise<EstadoCpe> {
  if (tipo === "NOTA_VENTA" || sunatManual()) return "NO_APLICA";
  if (modoSunat() === "simulado") return "ACEPTADO";
  return "PENDIENTE";
}
