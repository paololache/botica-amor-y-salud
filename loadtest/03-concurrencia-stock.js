// Escenario 3: 5 cajas venden a la vez el mismo lote de 10 unidades. Nunca debe quedar stock negativo.
// Requiere sembrar con SEED_PRUEBA_CONCURRENCIA=1 (producto PRUEBA-CONCURRENCIA).
import { check } from "k6";
import { Counter } from "k6/metrics";
import { CAJEROS, asegurarCaja, get, login, post } from "./lib.js";

const vendidas = new Counter("unidades_vendidas");
const rechazadas = new Counter("ventas_rechazadas_sin_stock");

export const options = {
  scenarios: { concurrencia: { executor: "shared-iterations", vus: 5, iterations: 20, maxDuration: "2m" } },
  thresholds: { unidades_vendidas: ["count==10"], "checks{check:respuesta esperada}": ["rate==1"] },
};

export function setup() {
  const tokens = CAJEROS.slice(0, 5).map((c, i) => { const t = login(c); asegurarCaja(t, i); return t; });
  const p = get(tokens[0], "/api/productos?buscar=PRUEBA-CONCURRENCIA", "buscar").json()[0];
  if (!p) throw new Error("Falta el producto PRUEBA-CONCURRENCIA: siembra con SEED_PRUEBA_CONCURRENCIA=1");
  return { tokens, pres: p.presentaciones[0].id, stockInicial: p.stockVigente };
}

export default function (d) {
  const r = post(d.tokens[(__VU - 1) % 5], "/api/ventas", { items: [{ presentacionId: d.pres, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 2 }] }, "venta");
  check(r, { "respuesta esperada": (x) => x.status === 200 || x.status === 409 });
  if (r.status === 200) vendidas.add(1); else rechazadas.add(1);
}

export function teardown(d) {
  const p = get(d.tokens[0], "/api/productos?buscar=PRUEBA-CONCURRENCIA", "buscar").json()[0];
  check(p, { "stock final = 0 y nunca negativo": (x) => x.stockVigente === 0 });
  console.log(`Stock inicial ${d.stockInicial} → final ${p.stockVigente}`);
}
