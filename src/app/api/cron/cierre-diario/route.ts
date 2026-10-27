import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { errorJson } from "@/lib/api";
import { consolidarHasta } from "@/lib/services/comisiones";
import { hoy } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  try {
    const db = await getDb();
    return NextResponse.json({ comisiones: await consolidarHasta(db, hoy()) });
  } catch (e) {
    return errorJson(e);
  }
}
