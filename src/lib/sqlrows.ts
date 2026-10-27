import type { SQL } from "drizzle-orm";
import type { Db } from "@/db";

/** Ejecuta SQL crudo y devuelve filas tanto en PGlite como en postgres-js. */
export async function filas<T = Record<string, unknown>>(db: Db, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown;
  return (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
}
