/** Levanta un Postgres real local (puerto 5433) para pruebas de carga sin depender de Neon. */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const pg = new EmbeddedPostgres({ databaseDir: process.env.PG_LOCAL_DIR ?? "./.pg-local", user: "botica", password: "botica", port: 5433, persistent: true });

async function main() {
  if (!existsSync((process.env.PG_LOCAL_DIR ?? "./.pg-local") + "/PG_VERSION")) await pg.initialise();
  await pg.start();
  try { await pg.createDatabase("botica"); } catch { /* ya existe */ }
  console.log("Postgres listo: DATABASE_URL=postgres://botica:botica@localhost:5433/botica");
  const salir = async () => { await pg.stop(); process.exit(0); };
  process.on("SIGINT", salir); process.on("SIGTERM", salir);
}
main().catch((e) => { console.error(e); process.exit(1); });
