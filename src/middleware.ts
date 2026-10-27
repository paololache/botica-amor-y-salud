import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, leerSesion } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const sesion = await leerSesion(req.cookies.get(COOKIE)?.value);
  const enLogin = req.nextUrl.pathname === "/login";
  if (!sesion && !enLogin) return NextResponse.redirect(new URL("/login", req.url));
  if (sesion && enLogin) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next|favicon.ico|icon.svg).*)"] };
