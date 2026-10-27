import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorJson } from "@/lib/api";
import { sembrar } from "@/lib/semilla";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Primera instalación en Vercel: carga los datos de prueba si la base está vacía. Protegida con SEED_SECRET. */
export async function GET(req: NextRequest) {
  const secreto = process.env.SEED_SECRET;
  if (!secreto || req.nextUrl.searchParams.get("clave") !== secreto) return NextResponse.json({ error: "Clave de instalación incorrecta o SEED_SECRET no configurada." }, { status: 401 });
  try {
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.usuario);
    if (n > 0) return NextResponse.json({ ok: true, mensaje: "La base ya tiene datos; no se cambió nada." });
    return NextResponse.json({ ok: true, mensaje: await sembrar(db) });
  } catch (e) {
    return errorJson(e);
  }
}
