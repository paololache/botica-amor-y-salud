// Escenario 9: carga media sostenida (por defecto 4 horas). Usa el mismo flujo de venta de la hora pico.
// k6 run -e DURACION=4h -e PAUSA=40 loadtest/07-resistencia.js
export { setup, default } from "./01-hora-pico.js";
export const options = {
  scenarios: { resistencia: { executor: "constant-vus", vus: 3, duration: __ENV.DURACION || "4h" } },
  thresholds: { "http_req_duration{name:venta}": ["p(95)<2000"], "checks{check:venta 200}": ["rate>0.99"] },
};
