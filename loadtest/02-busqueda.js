// Escenario 2: 20 usuarios buscando sin pausa (cargar SEED_PRODUCTOS=20000 para la prueba completa).
import { check } from "k6";
import { get, login } from "./lib.js";

export const options = {
  scenarios: { busqueda: { executor: "constant-vus", vus: Number(__ENV.VUS || 20), duration: __ENV.DURACION || "5m" } },
  thresholds: { "http_req_duration{name:buscar}": ["p(95)<300"], checks: ["rate>0.99"] },
};
const TERMINOS = ["para", "ibupro", "amoxi", "vitamina", "omepra", "lorat", "cetiri", "suero", "pañal", "proto", "crema", "jarabe", "producto 1", "fórmula", "7750215", "genér"];

export function setup() { return { token: login("caja1") }; }
export default function (d) {
  const r = get(d.token, `/api/productos?buscar=${encodeURIComponent(TERMINOS[Math.floor(Math.random() * TERMINOS.length)])}`, "buscar");
  check(r, { "búsqueda 200": (x) => x.status === 200 });
}
