import { SignJWT, jwtVerify } from "jose";
import type { Rol } from "./permisos";

export const COOKIE = "botica_sesion";
export type Sesion = { id: number; nombre: string; login: string; rol: Rol };

function clave() {
  const s = process.env.AUTH_SECRET || "solo-para-desarrollo-local-cambiar-en-vercel-0000";
  return new TextEncoder().encode(s);
}

export async function firmarSesion(s: Sesion): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(clave());
}

export async function leerSesion(token: string | undefined | null): Promise<Sesion | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, clave());
    return { id: Number(payload.id), nombre: String(payload.nombre), login: String(payload.login), rol: payload.rol as Rol };
  } catch {
    return null;
  }
}
