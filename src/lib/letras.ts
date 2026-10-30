const UNIDADES = [
  "CERO", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
  "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO",
  "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function menorMil(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100), r = n % 100;
  const partes = c ? [CENTENAS[c]] : [];
  if (r > 0) partes.push(r < 30 ? UNIDADES[r] : DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : ""));
  return partes.join(" ");
}

/** «UNO» pierde la última letra delante de «MIL» y «MILLONES» (veintiún mil, un millón). */
const apocope = (s: string) => s.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");

function enteros(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000), miles = Math.floor(n / 1000) % 1000, resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocope(menorMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(menorMil(miles))} MIL`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(" ");
}

/** Importe en letras como lo piden los comprobantes: «SON: DOCE CON 50/100 SOLES». */
export function importeEnLetras(monto: number): string {
  const centimos = Math.round(monto * 100);
  return `SON: ${enteros(Math.floor(centimos / 100))} CON ${String(centimos % 100).padStart(2, "0")}/100 SOLES`;
}
