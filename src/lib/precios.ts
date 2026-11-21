import { IGV, r2, r4 } from "./util";

/**
 * Cálculos de precio del formulario de productos.
 * El costo se guarda SIN IGV (es lo que realmente cuesta a la botica: el IGV de la compra se recupera).
 * Al cargar, se escribe CON IGV (como viene en la factura) y el sistema lo descuenta; si no se tiene ese dato, se escribe sin IGV.
 * «Ganancia sobre el costo» = cuánto se gana respecto a lo que costó; «margen» = qué parte del precio es ganancia.
 */
export const costoSinIgv = (costo: number, incluyeIgv: boolean) => (incluyeIgv ? r4(costo / IGV) : r4(costo));
export const costoConIgv = (sinIgv: number) => r2(sinIgv * IGV);

/** Lo que queda del precio de venta para la botica: si el producto es gravado, el IGV se paga a SUNAT. */
const neto = (precio: number, gravado: boolean) => (gravado ? precio / IGV : precio);

/** Precio sugerido a partir de la ganancia sobre el costo; sube a los 10 céntimos. */
export function precioDesdeGanancia(costoSinIgvUnidad: number, factor: number, gananciaPct: number, gravado = true) {
  if (!(costoSinIgvUnidad > 0) || !(factor > 0)) return 0;
  return Math.ceil(r4(costoSinIgvUnidad * factor * (1 + gananciaPct / 100) * (gravado ? IGV : 1) * 10)) / 10;
}

/** Ganancia sobre el costo (%) que deja un precio. */
export function gananciaDesdePrecio(precio: number, costoSinIgvUnidad: number, factor = 1, gravado = true) {
  const costo = costoSinIgvUnidad * factor;
  if (!(precio > 0) || !(costo > 0)) return null;
  return Math.round(((neto(precio, gravado) - costo) / costo) * 1000) / 10;
}

/** Cuánto se gana con un precio: en soles, sobre el costo y como parte del precio. */
export function resultadoPrecio(precio: number, costoSinIgvUnidad: number, factor = 1, gravado = true) {
  const costo = r4(costoSinIgvUnidad * factor);
  const n = neto(precio, gravado);
  const ganancia = r2(n - costo);
  return {
    costo: r2(costo), ganancia,
    sobreCosto: costo > 0 ? Math.round((ganancia / costo) * 1000) / 10 : null,
    delPrecio: n > 0 ? Math.round((ganancia / n) * 1000) / 10 : null,
    pierde: ganancia < 0,
  };
}
