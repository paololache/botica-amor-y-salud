/** Datos del emisor que se imprimen en los comprobantes. Se configuran con variables de entorno en Vercel. */
export function datosEmpresa() {
  return {
    razonSocial: process.env.EMPRESA_RAZON_SOCIAL || "Botica Amor y Salud",
    nombreComercial: process.env.EMPRESA_NOMBRE_COMERCIAL || "Amor y Salud",
    ruc: process.env.EMPRESA_RUC || "",
    direccion: process.env.EMPRESA_DIRECCION || "Jr. Tacna 142, Collique, Comas - Lima",
    telefono: process.env.EMPRESA_TELEFONO || "",
  };
}
