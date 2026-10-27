import { cookies } from "next/headers";
import { COOKIE, leerSesion } from "./auth";

export async function sesionActual() {
  const c = await cookies();
  return leerSesion(c.get(COOKIE)?.value);
}
