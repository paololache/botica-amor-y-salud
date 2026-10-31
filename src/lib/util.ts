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
