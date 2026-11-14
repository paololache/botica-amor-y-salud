/**
 * Importa el catálogo de productos desde el Excel del cliente.
 *
 *   npm run importar:productos -- external/BD_productos.xlsx               → simulación: muestra qué haría, no escribe nada
 *   npm run importar:productos -- external/BD_productos.xlsx --reemplazar  → simulación del reemplazo de los datos de prueba
 *   ... --reemplazar --confirmar                                           → borra los datos de prueba y carga el Excel
 *
 * Usa la base de DATABASE_URL (si no hay, la local). Antes de correrlo contra producción, saca un respaldo de la base.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, closeDb, schema } from "../src/db";
import { leerXlsx } from "../src/lib/xlsx";
import { aplicarImportacion, interpretarFilas } from "../src/lib/importacion";

async function main() {
  const args = process.argv.slice(2);
  const archivo = args.find((a) => !a.startsWith("--"));
  if (!archivo) throw new Error("Indica el archivo: npm run importar:productos -- ruta/al/archivo.xlsx");
  const reemplazar = args.includes("--reemplazar"), confirmar = args.includes("--confirmar");
  const { hoja, filas } = leerXlsx(readFileSync(archivo));
  const plan = interpretarFilas(filas);

  const lotes = plan.productos.reduce((s, p) => s + p.lotes.length, 0);
  const unidades = plan.productos.reduce((s, p) => s + p.lotes.reduce((t, l) => t + l.cantidad, 0), 0);
  const porTipo = plan.observaciones.reduce<Record<string, number>>((a, o) => ({ ...a, [o.tipo]: (a[o.tipo] ?? 0) + 1 }), {});
  const destino = !process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("pglite:") ? `local (${process.env.DATABASE_URL ?? "pglite:.pglite"})` : `Postgres en ${new URL(process.env.DATABASE_URL).host}`;
  console.log(`Archivo: ${archivo} · hoja «${hoja}»`);
  console.log(`Base de datos: ${destino}`);
  console.log(`Productos: ${plan.productos.length} (${plan.productos.filter((p) => !p.activo).length} inactivos por falta de precio) · lotes: ${lotes} · unidades: ${unidades.toLocaleString("es-PE")}`);
  console.log(`Presentaciones por caja deducidas del nombre: ${plan.productos.filter((p) => p.caja).length}`);
  console.log(`Servicios encontrados (no se cargan como productos): ${plan.servicios.map((s) => `${s.nombre} S/ ${s.precio.toFixed(2)}`).join(" · ") || "ninguno"}`);
  console.log(`Por revisar: ${Object.entries(porTipo).map(([k, n]) => `${k} ${n}`).join(" · ") || "nada"}`);

  const csv = archivo.replace(/\.xlsx$/i, "") + "_revision.csv";
  const celda = (t: string) => `"${String(t).replace(/"/g, '""')}"`;
  writeFileSync(csv, "﻿" + ["Código;Producto;Qué revisar;Detalle", ...plan.observaciones.map((o) => [o.codigo, o.nombre, o.tipo, o.detalle].map(celda).join(";"))].join("\r\n"));
  console.log(`Lista para revisar: ${csv}`);

  if (!confirmar) {
    console.log(`\nSIMULACIÓN: no se escribió nada.${reemplazar ? " Con --confirmar se BORRARÁN los productos, ventas, cajas, compras, clientes y demás datos de prueba (se conservan usuarios, parámetros y servicios)." : ""} Agrega --confirmar para aplicar.`);
    return;
  }
  const db = await getDb();
  const [admin] = await db.select({ id: schema.usuario.id }).from(schema.usuario).where(eq(schema.usuario.login, process.env.IMPORTAR_USUARIO ?? "admin"));
  const r = await aplicarImportacion(db, plan, { reemplazar, usuarioId: admin?.id ?? null });
  console.log("\nIMPORTACIÓN APLICADA:", r);
  await closeDb();
}
main().catch(async (e) => { console.error("Error:", e instanceof Error ? e.message : e); await closeDb().catch(() => undefined); process.exit(1); });
