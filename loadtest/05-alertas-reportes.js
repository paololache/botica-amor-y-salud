// Escenarios 5 y 6: recálculo de alertas durante la venta, y reportes precargados + métricas personalizadas.
import { check } from "k6";
import { get, login, post } from "./lib.js";

export const options = {
  scenarios: {
    alertas: { executor: "per-vu-iterations", vus: 1, iterations: Number(__ENV.ITER_ALERTAS || 3), exec: "alertas" },
    reportes: { executor: "per-vu-iterations", vus: 3, iterations: Number(__ENV.ITER_REPORTES || 3), exec: "reportes" },
  },
  thresholds: { "http_req_duration{name:evaluar_alertas}": ["max<60000"], "http_req_duration{name:reporte}": ["p(95)<5000"], checks: ["rate>0.99"] },
};

export function setup() {
  const admin = login("admin");
  const m = post(admin, "/api/metricas", { nombre: `Carga ${Date.now()}`, formula: "(ventas - descuentos) / tickets", unidad: "SOLES", roles: ["ADMIN"], enPanel: false }, "crear_metrica");
  return { admin, extra: m.json("codigo") };
}

export function alertas(d) {
  const r = post(d.admin, "/api/alertas/evaluar", {}, "evaluar_alertas");
  check(r, { "alertas 200": (x) => x.status === 200 });
}

const CONSULTAS = [
  ["categoria", ["ventas", "unidades", "tickets", "ticket_promedio", "tasa_complemento"]], ["dia", ["ventas", "tickets", "ticket_promedio"]],
  ["hora", ["ventas", "tickets"]], ["producto", ["unidades", "ventas"]], ["vendedor", ["ventas", "tickets", "comision"]],
  ["campana", ["ventas_campana", "comision"]], ["categoria", ["ventas_sin_igv", "costo_ventas", "margen_pct"]], ["mes", ["ventas", "unidades_por_ticket"]],
  ["laboratorio", ["ventas", "unidades"]], ["semana", ["ventas", "tickets"]],
];

export function reportes(d) {
  for (const [agrupar, metricas] of CONSULTAS) {
    const r = post(d.admin, "/api/reportes/ejecutar", { agrupar, metricas: [...metricas, d.extra].filter(Boolean), desde: __ENV.DESDE, hasta: __ENV.HASTA }, "reporte");
    check(r, { "reporte 200": (x) => x.status === 200 });
  }
  for (const id of ["por-vencer", "stock-critico", "salidas-motivo", "cierres-caja"]) check(get(d.admin, `/api/reportes/especial/${id}`, "reporte"), { "especial 200": (x) => x.status === 200 });
}
