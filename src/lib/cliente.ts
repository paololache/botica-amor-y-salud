"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ErrorApi extends Error {
  constructor(public codigo: string, mensaje: string, public status: number) { super(mensaje); }
}

export async function api<T = unknown>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
  const res = await fetch(ruta, {
    method: opciones.metodo ?? (opciones.cuerpo !== undefined ? "POST" : "GET"),
    headers: opciones.cuerpo !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !ruta.includes("/auth/")) window.location.href = "/login";
  if (!res.ok) throw new ErrorApi(data?.error?.codigo ?? "ERROR", data?.error?.mensaje ?? "No se pudo completar la acción.", res.status);
  return data as T;
}

export function useDatos<T>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(!!ruta);
  const actual = useRef(ruta);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    actual.current = ruta;
    setCargando(true);
    try {
      const d = await api<T>(ruta);
      if (actual.current === ruta) { setDatos(d); setError(null); }
    } catch (e) {
      if (actual.current === ruta) setError((e as Error).message);
    } finally {
      if (actual.current === ruta) setCargando(false);
    }
  }, [ruta]);
  useEffect(() => { recargar(); }, [recargar]);
  return { datos, error, cargando, recargar, setDatos };
}

const fmtSoles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
export const soles = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? "—" : fmtSoles.format(n).replace("PEN", "S/").replace(/\s+/, " "));
export const numero = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("es-PE", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n));
export const fechaCorta = (f: string | Date | null | undefined) => {
  if (!f) return "—";
  const d = typeof f === "string" && f.length === 10 ? new Date(f + "T12:00:00-05:00") : new Date(f);
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", year: "numeric" }).format(d).replace(".", "");
};
export const fechaHora = (f: string | Date | null | undefined) =>
  f ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(f)).replace(".", "") : "—";
export const vence = (f: string | null | undefined) => {
  if (!f) return "—";
  const [y, m] = f.slice(0, 10).split("-");
  return `${m}/${y.slice(2)}`;
};
export function hoyLima() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function sumarDias(f: string, d: number) {
  const x = new Date(f + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10);
}
