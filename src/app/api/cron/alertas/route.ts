import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { errorJson } from "@/lib/api";
import { evaluarAlertas } from "@/lib/services/alertas";
import { refrescarCampanas } from "@/lib/services/campanas";
import { reenviarPendientes } from "@/lib/services/ventas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  try {
    const db = await getDb();
    return NextResponse.json({ campanas: await refrescarCampanas(db), cpe: await reenviarPendientes(db), alertas: await evaluarAlertas(db) });
  } catch (e) {
    return errorJson(e);
  }
}
