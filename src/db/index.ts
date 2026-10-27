import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: Promise<Db>; close?: () => Promise<void> };
const g = globalThis as unknown as { __botica?: Holder };
const holder: Holder = (g.__botica ??= {});

async function crear(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = url?.slice("pglite:".length) || process.env.PGLITE_DIR || ".pglite";
    const client = new PGlite(dir === "memory" ? undefined : dir);
    holder.close = () => client.close();
    return drizzle(client, { schema }) as unknown as Db;
  }
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { max: Number(process.env.DB_POOL ?? 5), prepare: false, idle_timeout: 20 });
  holder.close = () => client.end();
  return drizzle(client, { schema }) as unknown as Db;
}

export function getDb(): Promise<Db> {
  return (holder.db ??= crear());
}

export async function closeDb() {
  if (holder.close) await holder.close();
  holder.db = undefined;
  holder.close = undefined;
}

export { schema };
