import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodIssue } from "zod";
import { COOKIE, leerSesion, type Sesion } from "./auth";
import { enmascarar, puede, type Permiso } from "./permisos";
import { ErrorNegocio, esIdValido } from "./util";
import { getDb, schema, type Db } from "@/db";
import { and, eq } from "drizzle-orm";

type Ctx = { req: NextRequest; user: Sesion; db: Db; params: Record<string, string> };

export async function usuarioDe(req: NextRequest): Promise<Sesion | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : req.cookies.get(COOKIE)?.value;
  return leerSesion(token);
}

/** Los mensajes propios ya están en español; los que trae zod por defecto están en inglés. */
function mensajeZod(p: ZodIssue): string {
  if (!/^(Number|String|Array|Required|Expected|Invalid)\b/.test(p.message)) return p.message;
  if (p.code === "too_big") return "el valor es demasiado grande";
  if (p.code === "too_small") return p.type === "number" ? "el valor es demasiado pequeño" : "falta completar este dato";
  return "falta o no es válido";
}

export function errorJson(e: unknown) {
  if (e instanceof ErrorNegocio) return NextResponse.json({ error: { codigo: e.codigo, mensaje: e.message } }, { status: e.status });
  if (e instanceof ZodError) {
    const p = e.issues[0];
    const campo = [...p.path].reverse().find((x) => typeof x === "string") ?? "dato";
    return NextResponse.json({ error: { codigo: "DATOS_INVALIDOS", mensaje: `${campo}: ${mensajeZod(p)}` } }, { status: 400 });
  }
  // Valores que la base rechaza (demasiado grandes, caracteres inválidos, referencias inexistentes) son datos malos, no fallas del sistema.
  const pg = String((e as { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (e as { code?: unknown }).code ?? "");
  if (pg.startsWith("22")) return NextResponse.json({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Uno de los valores no es válido o es demasiado grande." } }, { status: 400 });
  if (pg === "23503") return NextResponse.json({ error: { codigo: "REFERENCIA", mensaje: "Uno de los registros indicados no existe o está en uso." } }, { status: 409 });
  if (pg === "23505") return NextResponse.json({ error: { codigo: "DUPLICADO", mensaje: "Ese registro ya existe." } }, { status: 409 });
  console.error(e);
  return NextResponse.json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado. Intenta de nuevo." } }, { status: 500 });
}

export function ruta(permiso: Permiso, fn: (ctx: Ctx) => Promise<unknown>, opciones: { idTexto?: boolean } = {}) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    const user = await usuarioDe(req);
    if (!user) return NextResponse.json({ error: { codigo: "SIN_SESION", mensaje: "Inicia sesión para continuar." } }, { status: 401 });
    try {
      const db = await getDb();
      // Los perfiles se leen en cada petición: un cambio o una baja rige de inmediato, sin esperar a que venza la sesión.
      const [vigente] = await db.select({ nombre: schema.usuario.nombre, roles: schema.usuario.roles }).from(schema.usuario).where(and(eq(schema.usuario.id, user.id), eq(schema.usuario.activo, true)));
      if (!vigente) {
        const res = NextResponse.json({ error: { codigo: "SIN_SESION", mensaje: "Tu usuario ya no está activo." } }, { status: 401 });
        res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
        return res;
      }
      const actual = { ...user, ...vigente };
      if (!puede(actual.roles, permiso)) return NextResponse.json({ error: { codigo: "SIN_PERMISO", mensaje: "Tus perfiles no tienen acceso a esta acción." } }, { status: 403 });
      const params = (await ctx.params) ?? {};
      if (params.id !== undefined && !opciones.idTexto && !esIdValido(params.id)) throw new ErrorNegocio("NO_EXISTE", "El registro no existe.", 404);
      const data = await fn({ req, user: actual, db, params });
      return NextResponse.json(enmascarar(data ?? { ok: true }, actual.roles));
    } catch (e) {
      return errorJson(e);
    }
  };
}

export async function cuerpo(req: NextRequest): Promise<unknown> {
  try { return await req.json(); } catch { return {}; }
}
