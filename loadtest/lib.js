import http from "k6/http";
import { check } from "k6";

export const BASE = __ENV.BASE_URL || "http://localhost:3000";
export const CLAVE = __ENV.CLAVE || "botica2026";
export const CAJEROS = (__ENV.CAJEROS || "caja1,caja2,caja3,caja4,qf").split(",");

export function login(usuario) {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ login: usuario, password: CLAVE }), { headers: { "Content-Type": "application/json" }, tags: { name: "login" } });
  check(r, { "login 200": (x) => x.status === 200 });
  return r.json("token");
}

export function h(token, nombre) {
  return { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, tags: { name: nombre } };
}

export function get(token, ruta, nombre) { return http.get(`${BASE}${ruta}`, h(token, nombre || ruta)); }
export function post(token, ruta, cuerpo, nombre) { return http.post(`${BASE}${ruta}`, JSON.stringify(cuerpo ?? {}), h(token, nombre || ruta)); }

/** Abre la caja del cajero si no la tiene abierta (una caja por cajero). */
export function asegurarCaja(token, indice) {
  const e = get(token, "/api/caja", "caja_estado").json();
  if (e.sesion) return e.sesion.id;
  const caja = e.cajas.filter((c) => !c.ocupadaPor)[0] || e.cajas[indice % e.cajas.length];
  const r = post(token, "/api/caja/abrir", { cajaId: caja.id, turno: "COMPLETO", conteo: { "100": 1, "50": 1 }, observacion: "Apertura de prueba de carga" }, "caja_abrir");
  check(r, { "caja abierta": (x) => x.status === 200 });
  return r.json("id");
}

/** Productos libres (sin receta) con stock para armar carritos. */
export function catalogo(token) {
  const out = [];
  for (const q of ["a", "e", "i", "o"]) {
    const r = get(token, `/api/productos?buscar=${q}&limite=40`, "buscar").json();
    for (const p of r) if (p.condicionVenta === "LIBRE" && p.stockVigente > 50 && p.presentaciones.length) out.push({ id: p.id, pres: p.presentaciones[0].id, pvp: p.presentaciones[0].pvp });
  }
  return out;
}

export const SENSIBLES = ["costoPromedio", "costoUnitario", "costoTotal", "costoPresentacion", "totalCosto", "saldoValorizado", "porcentajeUtilidad", "margen", "costoVentas", "pvpSugerido", "costoAnterior"];
