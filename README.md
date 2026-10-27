# Amor y Salud · MVP del sistema de gestión

Sistema de gestión para la Botica Amor y Salud (Comas, Lima). Frontend y backend van juntos en un solo proyecto Next.js, pensado para una sola instancia de Vercel, y usa Postgres (Neon desde el Marketplace de Vercel). Implementa el alcance MVP del *Documento de Elicitación v4*.

| Módulo | Qué incluye |
|---|---|
| Panel principal | Sección de alertas en forma de blíster, ventas del día y del mes, comisión del vendedor, estado de caja y tarjetas de métricas |
| Vender (POS) | Búsqueda por código, nombre o principio activo, FEFO automático, receta, descuentos con clave de supervisor, pagos mixtos, sugerencias complementarias (F7), comisión al instante |
| Caja | Apertura por denominación, ingresos y egresos con concepto, cierre ciego, validación del administrador y reporte de cierre imprimible |
| Productos | Stock vigente, vencimiento más próximo e interruptor de campaña (solo administrador) |
| Compras | Dos pasos: el inventariador recibe sin ver costos y el administrador costea; recién ahí la compra entra al kardex con costo promedio |
| Salidas y entradas | Motivos de catálogo, evidencia, aprobación por rol y regla de que quien registra no aprueba |
| Kardex | Por producto y lote, con saldo en unidades (y en S/ para el administrador). Exporta a Excel |
| Campañas | Producto del kardex, % de comisión manual y fechas estimadas; se activa por fecha o desde el stock |
| Comisiones | Devengo por venta, reversión por anulación, consolidación diaria y cierre y pago mensual |
| Reportes | Reportes precargados, personalización (periodo, agrupación y métricas), «Mis reportes» y métricas con fórmula |

**Visibilidad de costos:** solo el rol `ADMIN` ve costos, márgenes y valor del inventario. El servidor elimina esos campos en todas las respuestas para los demás roles (`src/lib/permisos.ts`); no es solo un tema de pantalla.

## Probar en local

```bash
npm install
npm run db:setup        # crea la base embebida (.pglite) y siembra datos de prueba
npm run dev             # http://localhost:3000
```

Usuarios de prueba (clave `botica2026`):

| Usuario | Rol |
|---|---|
| `admin` | Propietaria / administradora |
| `qf` | Químico farmacéutico |
| `caja1`, `caja2`, `caja3` | Cajeros |
| `caja4` | Vendedora |
| `almacen` | Inventariador |
| `contador` | Contador |

`caja1` ya tiene la caja abierta con ventas del día (si se siembra después de las 9:00).

## Desplegar en Vercel (una sola instancia)

1. Sube esta carpeta a un repositorio de GitHub y en Vercel elige **Add New → Project → Import**. Vercel detecta Next.js.
2. En el proyecto, entra a **Storage → Marketplace → Neon (Postgres)** y conéctalo. Vercel crea `DATABASE_URL`; usa la cadena *pooled*, que es la que viene por defecto.
3. En **Settings → Environment Variables** agrega:
   - `AUTH_SECRET`: una clave aleatoria de 32 caracteres o más.
   - `CRON_SECRET`: otra clave aleatoria; Vercel Cron la envía sola.
   - `SUNAT_MODO=simulado`: acepta los comprobantes sin conectarse a SUNAT mientras se define el OSE.
   - `NEXT_PUBLIC_MODO_PRUEBA=1` durante las pruebas; ponlo en `0` en producción.
4. Despliega. El script `vercel-build` aplica las migraciones antes de compilar.
5. Carga los datos de prueba una vez desde tu computadora, apuntando a Neon:
   ```bash
   DATABASE_URL="postgres://…neon…" npm run db:seed            # volumen de demostración
   DATABASE_URL="postgres://…neon…" npm run carga:datos        # volumen para pruebas de carga
   ```

`vercel.json` programa dos tareas diarias, que funcionan en el plan Hobby:

- Alertas y reenvío de comprobantes: 6:00 a. m. de Lima.
- Consolidación de comisiones: 11:59 p. m. de Lima.

Además, el panel recalcula las alertas si tienen más de 15 minutos.

## Pruebas

```bash
npm test                # 17 pruebas de reglas de negocio (FEFO, stock concurrente, comisiones, cierre ciego, costos, RN-09…)
```

Las pruebas de carga con k6 están en `loadtest/`; los resultados de la última corrida están en `loadtest/RESULTADOS.md`. Para correrlas contra un Postgres real local:

```bash
npm run db:local                                                     # Postgres embebido en :5433 (otra terminal)
export DATABASE_URL=postgres://botica:botica@localhost:5433/botica
npm run db:migrate && npm run carga:datos && npm run build && npm start
k6 run -e DURACION=30m loadtest/01-hora-pico.js                      # o contra tu URL de Vercel con -e BASE_URL=…
```

## Estructura

- `src/lib/services`: reglas de negocio (caja, ventas, inventario, compras, salidas, campañas, comisiones, alertas, reportes).
- `src/app/api`: API REST. Toda ruta valida la sesión y el rol, y enmascara los costos.
- `src/app/(app)`: pantallas.
- `src/db/schema.ts`: modelo de datos (Drizzle ORM); las migraciones están en `drizzle/`.
- `scripts/seed.ts`: datos de prueba reproducibles (semilla fija).

## Pendiente fuera del MVP

- Integración con un OSE real (`src/lib/services/sunat.ts`).
- Transferencias entre sucursales.
- Inventario físico desde el celular.
- Venta al crédito y cotizaciones.
- Guía de remisión electrónica.
- Multi-sucursal.
