# Resultados de las pruebas de carga · 26-10-2026

**Ambiente:**

- Producción local: `next build` y `next start`, una sola instancia.
- Base de datos: Postgres 18 real (embebido), pool de 10 conexiones.
- Datos: `npm run carga:datos`, con 2,096 productos, 6,316 lotes, 28,783 ventas históricas (180 días) y 52,696 líneas de kardex.
- Herramienta: k6 v1.3.0.

> Son tiempos de un servidor local. En Vercel y Neon hay que sumar la latencia de red y el arranque en frío de las funciones. Repite los escenarios contra la URL de Vercel con `-e BASE_URL=https://…` antes de salir a producción.

| # | Escenario | Carga ejecutada | Criterio | Resultado |
|---|---|---|---|---|
| 1 | Hora pico de venta | 5 cajas, una venta cada 2 s durante 3 min (443 ventas, 10× el ritmo pedido) | p95 de la venta ≤ 2 s; 0 errores | ✅ p95 **65 ms**; 0 de 1,343 peticiones fallidas |
| 2 | Búsqueda de productos | 20 usuarios sin pausa durante 1 min (20,334 búsquedas) | p95 ≤ 300 ms | ✅ p95 **84 ms** |
| 3 | Concurrencia de stock | 5 cajas, 20 intentos sobre un lote de 10 unidades | Nunca negativo; solo 10 vendidas | ✅ **10 vendidas, 10 rechazadas (409)**, stock final 0 |
| 4 | Cierre de caja | 5 cierres simultáneos | Esperado = movimientos; ≤ 3 s | ✅ p95 **22 ms**; el esperado cuadra en las 5 sesiones |
| 5 | Alertas | Recálculo sobre 2,096 productos y 6,316 lotes | ≤ 60 s | ✅ máx. **237 ms** |
| 6 | Reportes y métricas | 10 consultas personalizadas y 4 especiales, × 3 usuarios × 3 rondas, sobre 6 meses | ≤ 5 s | ✅ p95 **144 ms** |
| 7 | Comisiones | Consolidación y cierre de mes | Totales consistentes | ✅ |
| 8 | Visibilidad de costos | 14 rutas × cajero, QF, contador e inventariador | Ningún costo expuesto | ✅ 0 fugas; el QF recibe 403 al pedir margen |
| 9 | Resistencia (4 h) | `07-resistencia.js` | Sin degradación > 20 % | Pendiente: correrlo en Vercel |
| 10 | Contingencia SUNAT | `SUNAT_MODO=sin_conexion`: vender, volver a `simulado` y usar «Reenviar CPE» | Las ventas siguen; los CPE se envían | Pendiente: prueba manual |

Para la prueba completa del documento, corre el escenario 1 con `-e DURACION=30m -e PAUSA=20` y el escenario 2 sembrando con `SEED_PRODUCTOS=20000`.
