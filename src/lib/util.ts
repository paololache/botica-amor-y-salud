export const TZ = "America/Lima";

export function hoy(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function mesDe(fecha: string): string {
  return fecha.slice(0, 7);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta + "T12:00:00Z") - Date.parse(desde + "T12:00:00Z")) / 86400000);
}

/** Inicio del día en Lima (UTC-5, sin horario de verano) como Date. */
export function inicioDiaLima(fecha: string): Date {
  return new Date(fecha + "T05:00:00.000Z");
}

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export const IGV = 1.18;

/** PVP con IGV a partir del costo unitario sin IGV y la utilidad sobre el costo; sube a los 10 céntimos. */
export function precioSugerido(costo: number, factor: number, utilidad: number): number {
  return Math.ceil(r4(costo * factor * (1 + utilidad / 100) * IGV * 10)) / 10;
}

const GENERICOS_LABORATORIO = new Set(["laboratorio", "laboratorios", "lab", "labs", "sa", "sac", "saa", "srl", "eirl", "ltda", "inc", "cia"]);

/** Identidad de un laboratorio: sin tildes, mayúsculas, signos, espacios ni razón social. "Lab. IQ-Farma S.A.C." e "iqfarma" son el mismo. */
export function claveLaboratorio(nombre: string): string {
  const tokens = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const propios = tokens.filter((t) => !GENERICOS_LABORATORIO.has(t));
  return (propios.length ? propios : tokens).join("");
}

/** Deja solo lo que puede ser un número positivo: acepta coma decimal y separador de miles al pegar ("S/ 1,250.50" → "1250.50"). */
export function limpiarNumero(valor: string, entero = false): string {
  if (entero) return valor.replace(/\D/g, "");
  const conAmbos = valor.includes(",") && valor.includes(".");
  const miles = valor.lastIndexOf(",") > valor.lastIndexOf(".") ? /\./g : /,/g;
  const s = (conAmbos ? valor.replace(miles, "") : valor).replace(/,/g, ".").replace(/[^\d.]/g, "");
  const punto = s.indexOf(".");
  return punto < 0 ? s : s.slice(0, punto + 1) + s.slice(punto + 1).replace(/\./g, "");
}

/** Fecha AAAA-MM-DD que existe en el calendario (rechaza 2026-02-31). */
export function esFechaValida(f: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(f + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

export function esMesValido(m: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

/** Número de la URL dentro de un rango; lo que no sea número usa el valor por defecto. */
export function enRango(valor: string | null, porDefecto: number, min: number, max: number): number {
  const n = Number(valor ?? porDefecto);
  return Number.isFinite(n) ? Math.trunc(Math.min(max, Math.max(min, n))) : porDefecto;
}

/** Id de la URL: entero positivo que cabe en la columna de la base. */
export function esIdValido(id: string): boolean {
  return /^\d{1,10}$/.test(id) && Number(id) > 0 && Number(id) <= 2147483647;
}

export class ErrorNegocio extends Error {
  constructor(public codigo: string, mensaje: string, public status = 400) {
    super(mensaje);
  }
}

export const DENOMINACIONES = ["200", "100", "50", "20", "10", "5", "2", "1", "0.5", "0.2", "0.1"] as const;

export function totalConteo(conteo: Record<string, number> | undefined | null): number {
  if (!conteo) return 0;
  return r2(Object.entries(conteo).reduce((s, [den, n]) => s + Number(den) * (Number(n) || 0), 0));
}

export const MEDIOS = ["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"] as const;
export type Medio = (typeof MEDIOS)[number];
