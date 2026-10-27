import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { COOKIE, firmarSesion } from "@/lib/auth";
import { errorJson } from "@/lib/api";
import { ErrorNegocio } from "@/lib/util";

const esquema = z.object({ login: z.string().min(1), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { login, password } = esquema.parse(await req.json());
    const db = await getDb();
    const [u] = await db.select().from(schema.usuario).where(and(eq(schema.usuario.login, login.trim().toLowerCase()), eq(schema.usuario.activo, true)));
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new ErrorNegocio("CREDENCIALES", "Usuario o clave incorrectos.", 401);
    const sesion = { id: u.id, nombre: u.nombre, login: u.login, rol: u.rol };
    const token = await firmarSesion(sesion);
    const res = NextResponse.json({ usuario: sesion, token });
    res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
    return res;
  } catch (e) {
    return errorJson(e);
  }
}
