/** Siembra datos de prueba. Variables: SEED_PRODUCTOS, SEED_DIAS, SEED_VENTAS_DIA, SEED_CAJAS, SEED_RESET=1 (ver src/lib/semilla.ts). */
import { getDb, closeDb } from "../src/db";
import { sembrar } from "../src/lib/semilla";

async function main() {
  const db = await getDb();
  console.log(await sembrar(db, { reset: process.env.SEED_RESET === "1" }));
  await closeDb();
}
main().catch(async (e) => { console.error("Error:", e?.cause?.message ?? e?.message ?? e); await closeDb(); process.exit(1); });
