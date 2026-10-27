import { getDb, closeDb } from "../src/db";

async function main() {
  const db = await getDb();
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
  }
  console.log("Migraciones aplicadas");
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
