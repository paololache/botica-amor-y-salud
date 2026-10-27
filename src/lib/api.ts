import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { COOKIE, leerSesion, type Sesion } from "./auth";
import { enmascarar, puede, type Permiso } from "./permisos";
import { ErrorNegocio } from "./util";
import { getDb, type Db } from "@/db";

type Ctx = { req: NextRequest; user: Sesion; db: Db; params: Record<string, string> };

export async function usuarioDe(req: NextRequest): Promise<Sesion | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : req.cookies.get(COOKIE)?.value;
  return leerSesion(token);
}

export function errorJson(e: unknown) {
  if (e instanceof ErrorNegocio) return NextResponse.json({ error: { codigo: e.codigo, mensaje: e.message } }, { status: e.status });
  if (e instanceof ZodError) {
    const p = e.issues[0];
    return NextResponse.json({ error: { codigo: "DATOS_INVALIDOS", mensaje: `${p.path.join(".") || "dato"}: ${p.message}` } }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado. Intenta de nuevo." } }, { status: 500 });
}

export function ruta(permiso: Permiso, fn: (ctx: Ctx) => Promise<unknown>) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    const user = await usuarioDe(req);
    if (!user) return NextResponse.json({ error: { codigo: "SIN_SESION", mensaje: "Inicia sesión para continuar." } }, { status: 401 });
    if (!puede(user.rol, permiso)) return NextResponse.json({ error: { codigo: "SIN_PERMISO", mensaje: "Tu rol no tiene acceso a esta acción." } }, { status: 403 });
    try {
      const db = await getDb();
      const data = await fn({ req, user, db, params: (await ctx.params) ?? {} });
      return NextResponse.json(enmascarar(data ?? { ok: true }, user.rol));
    } catch (e) {
      return errorJson(e);
    }
  };
}

export async function cuerpo(req: NextRequest): Promise<unknown> {
  try { return await req.json(); } catch { return {}; }
}
