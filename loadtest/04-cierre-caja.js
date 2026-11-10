// Escenario 4: 5 cierres simultáneos después de la hora pico. El esperado debe ser la suma de movimientos.
import { check } from "k6";
import { CAJEROS, get, login, post } from "./lib.js";

export const options = {
  scenarios: { cierres: { executor: "per-vu-iterations", vus: CAJEROS.length, iterations: 1, maxDuration: "2m" } },
  thresholds: { "http_req_duration{name:cerrar}": ["p(95)<3000"], "checks": ["rate==1"] },
};

export function setup() { return { tokens: CAJEROS.map(login), admin: login("admin") }; }

export default function (d) {
  const t = d.tokens[__VU - 1];
  const e = get(t, "/api/caja", "caja_estado").json();
  if (!e.sesion) return;
  // Los pagos virtuales están conformes (no se marca ninguno); el efectivo en 0 fuerza un cierre por aprobar.
  const r = post(t, "/api/caja/cerrar", { efectivo: 0, noCuadran: {}, observacion: "Cierre de prueba de carga" }, "cerrar");
  check(r, { "cierre 200": (x) => x.status === 200 });
  if (r.json("estado") === "EN_CIERRE") post(d.admin, "/api/caja/validar", { sesionId: r.json("sesionId"), observacion: "Aprobado en prueba de carga" }, "validar");
  const rep = get(d.admin, `/api/caja/sesiones/${r.json("sesionId")}`, "reporte_cierre").json();
  const esperado = rep.arqueo.reduce((s, a) => s + a.esperado, 0);
  const ingresos = rep.movimientos.reduce((s, m) => s + (m.tipo === "INGRESO" ? m.monto : -m.monto), 0);
  check(rep, { "esperado = fondo + ventas ± movimientos": () => Math.abs(esperado - (rep.fondoInicial + rep.ventas.total + ingresos)) < 0.05 });
}
