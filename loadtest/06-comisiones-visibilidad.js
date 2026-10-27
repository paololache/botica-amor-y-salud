// Escenarios 7 y 8: consolidación de comisiones y recorrido de visibilidad de costos con roles sin permiso.
import { check } from "k6";
import { SENSIBLES, get, login, post } from "./lib.js";

export const options = { scenarios: { una: { executor: "per-vu-iterations", vus: 1, iterations: 1 } }, thresholds: { checks: ["rate==1"] } };

const RUTAS = ["/api/panel", "/api/productos?pagina=1", "/api/productos?buscar=para", "/api/productos/1", "/api/ventas?dias=7", "/api/kardex?productoId=1", "/api/compras", "/api/movimientos", "/api/reportes", "/api/reportes/especial/por-vencer", "/api/reportes/especial/salidas-motivo", "/api/comisiones/mias", "/api/comisiones/mes", "/api/caja/sesiones"];

export default function () {
  const admin = login("admin");
  const c = post(admin, "/api/comisiones/consolidar", {}, "consolidar");
  check(c, { "consolidación 200": (x) => x.status === 200 });
  const mes = get(admin, "/api/comisiones/mes", "comisiones_mes").json();
  check(mes, { "acumulados no negativos": (m) => m.vendedores.every((v) => v.total >= 0) });
  const r = post(admin, "/api/reportes/ejecutar", { agrupar: "vendedor", metricas: ["comision"] }, "reporte").json();
  check(r, { "reporte de comisiones responde": (x) => Array.isArray(x.filas) });

  for (const usuario of ["caja1", "qf", "contador", "almacen"]) {
    const t = login(usuario);
    for (const ruta of RUTAS) {
      const res = get(t, ruta, "visibilidad");
      if (res.status !== 200) continue; // 403 = el rol no tiene acceso, también es correcto
      const fuga = SENSIBLES.find((k) => res.body.includes(`"${k}"`));
      check(res, { [`sin costos para ${usuario}`]: () => !fuga });
      if (fuga) console.error(`${usuario} recibió «${fuga}» en ${ruta}`);
    }
  }
  const qf = login("qf");
  const m = post(qf, "/api/reportes/ejecutar", { agrupar: "total", metricas: ["margen_pct"] }, "reporte");
  check(m, { "QF no puede pedir margen": (x) => x.status === 403 });
}
