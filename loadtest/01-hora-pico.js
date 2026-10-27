// Escenario 1: 5 cajas en paralelo, una venta cada 20 s por caja durante 30 min (≈450 ventas).
// k6 run -e BASE_URL=https://tu-app.vercel.app -e DURACION=30m loadtest/01-hora-pico.js
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { CAJEROS, asegurarCaja, catalogo, get, login, post } from "./lib.js";

const ventasOk = new Counter("ventas_ok");
const PAUSA = Number(__ENV.PAUSA || 20);

export const options = {
  scenarios: { cajas: { executor: "constant-vus", vus: CAJEROS.length, duration: __ENV.DURACION || "30m" } },
  thresholds: {
    "http_req_duration{name:venta}": ["p(95)<2000"],
    "http_req_duration{name:buscar}": ["p(95)<300"],
    "checks{check:venta 200}": ["rate>0.99"],
  },
};

export function setup() {
  const tokens = CAJEROS.map((c, i) => { const t = login(c); asegurarCaja(t, i); return t; });
  return { tokens, productos: catalogo(tokens[0]) };
}

export default function (d) {
  const token = d.tokens[(__VU - 1) % d.tokens.length];
  const n = 1 + Math.floor(Math.random() * 3);
  const items = [];
  for (let i = 0; i < n; i++) {
    const p = d.productos[Math.floor(Math.random() * d.productos.length)];
    if (!items.some((x) => x.presentacionId === p.pres)) items.push({ presentacionId: p.pres, cantidad: 1 + Math.floor(Math.random() * 3), descuentoPct: 0, origen: "DIRECTA", pvp: p.pvp });
  }
  get(token, `/api/productos?buscar=${["para", "vita", "ibu", "amo", "omep"][Math.floor(Math.random() * 5)]}`, "buscar");
  post(token, "/api/productos/sugerencias", { ids: d.productos.slice(0, 2).map((p) => p.id) }, "sugerencias");
  const total = items.reduce((s, x) => s + x.pvp * x.cantidad, 0);
  const medio = Math.random() < 0.6 ? "EFECTIVO" : "YAPE";
  const r = post(token, "/api/ventas", {
    items: items.map(({ pvp, ...x }) => x), tipoComprobante: "BOLETA",
    pagos: [{ medio, monto: medio === "EFECTIVO" ? Math.ceil(total) : Math.round(total * 100) / 100 }],
    cliente: total > 700 ? { tipoDoc: "DNI", numero: "45678912", nombre: "Cliente de prueba" } : undefined,
  }, "venta");
  if (check(r, { "venta 200": (x) => x.status === 200 })) ventasOk.add(1);
  else console.warn(`venta ${r.status}: ${r.body && r.body.slice(0, 200)}`);
  sleep(PAUSA);
}
