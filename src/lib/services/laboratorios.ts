import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { claveLaboratorio, ErrorNegocio } from "../util";

const { laboratorio, producto, auditoria } = schema;

const nombreLaboratorio = z.string().trim().min(2, "mínimo 2 caracteres").max(80).transform((s) => s.replace(/\s+/g, " ")).refine((s) => claveLaboratorio(s).length >= 2, "escribe un nombre válido");
export const esquemaCrearLaboratorio = z.object({ nombre: nombreLaboratorio, confirmarParecido: z.boolean().optional() });
export const esquemaRenombrarLaboratorio = z.object({ nombre: nombreLaboratorio });
export const esquemaUnificarLaboratorio = z.object({ destinoId: z.number().int() });

function distancia(a: string, b: string) {
  let fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i];
    for (let j = 1; j <= b.length; j++) nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    fila = nueva;
  }
  return fila[b.length];
}

/** Probable error de redacción: pocas letras de diferencia, o un nombre contenido en el otro. */
function seParecen(a: string, b: string) {
  const corta = Math.min(a.length, b.length);
  if (corta >= 5 && (a.includes(b) || b.includes(a))) return true;
  return corta >= 4 && distancia(a, b) <= (corta >= 7 ? 2 : 1);
}

export async function catalogoLaboratorios(db: Db) {
  return db.select({ id: laboratorio.id, nombre: laboratorio.nombre }).from(laboratorio).orderBy(asc(laboratorio.nombre));
}

export async function listarLaboratorios(db: Db) {
  const filas = await db.select({ id: laboratorio.id, nombre: laboratorio.nombre, clave: laboratorio.clave, productos: sql<number>`count(${producto.id})`.mapWith(Number) })
    .from(laboratorio).leftJoin(producto, eq(producto.laboratorioId, laboratorio.id)).groupBy(laboratorio.id).orderBy(asc(laboratorio.nombre));
  return filas.map(({ clave, ...l }) => ({ ...l, parecidos: filas.filter((o) => o.id !== l.id && seParecen(clave, o.clave)).map((o) => o.nombre) }));
}

/** Nunca crea un segundo registro del mismo laboratorio: si la clave existe lo devuelve, y si se parece a otro pide confirmar. */
export async function crearLaboratorio(db: Db, user: Sesion, d: z.infer<typeof esquemaCrearLaboratorio>) {
  const clave = claveLaboratorio(d.nombre);
  const todos = await db.select().from(laboratorio);
  const igual = todos.find((l) => l.clave === clave);
  if (igual) return { laboratorio: { id: igual.id, nombre: igual.nombre }, existente: true, parecidos: [] };
  const parecidos = d.confirmarParecido ? [] : todos.filter((l) => seParecen(clave, l.clave)).map((l) => ({ id: l.id, nombre: l.nombre }));
  if (parecidos.length) return { laboratorio: null, existente: false, parecidos };
  return db.transaction(async (tx) => {
    const [nuevo] = await tx.insert(laboratorio).values({ nombre: d.nombre, clave }).onConflictDoNothing({ target: laboratorio.clave }).returning({ id: laboratorio.id, nombre: laboratorio.nombre });
    if (!nuevo) {
      const [ganador] = await tx.select({ id: laboratorio.id, nombre: laboratorio.nombre }).from(laboratorio).where(eq(laboratorio.clave, clave));
      return { laboratorio: ganador, existente: true, parecidos: [] };
    }
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "CREAR_LABORATORIO", entidad: "laboratorio", entidadId: nuevo.id, detalle: { nombre: d.nombre } });
    return { laboratorio: nuevo, existente: false, parecidos: [] };
  });
}

async function obtener(db: Db, id: number) {
  const [l] = await db.select().from(laboratorio).where(eq(laboratorio.id, id));
  if (!l) throw new ErrorNegocio("NO_EXISTE", "El laboratorio no existe.", 404);
  return l;
}

export async function renombrarLaboratorio(db: Db, user: Sesion, id: number, d: z.infer<typeof esquemaRenombrarLaboratorio>) {
  const actual = await obtener(db, id);
  const clave = claveLaboratorio(d.nombre);
  const [otro] = await db.select().from(laboratorio).where(eq(laboratorio.clave, clave));
  if (otro && otro.id !== id) throw new ErrorNegocio("LABORATORIO_DUPLICADO", `Ya existe «${otro.nombre}». Si son el mismo, usa Unificar.`, 409);
  await db.transaction(async (tx) => {
    await tx.update(laboratorio).set({ nombre: d.nombre, clave }).where(eq(laboratorio.id, id));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "RENOMBRAR_LABORATORIO", entidad: "laboratorio", entidadId: id, detalle: { antes: actual.nombre, despues: d.nombre } });
  });
  return { id };
}

/** Pasa los productos al laboratorio correcto y elimina el repetido; la auditoría guarda qué productos se movieron. */
export async function unificarLaboratorios(db: Db, user: Sesion, id: number, destinoId: number) {
  if (id === destinoId) throw new ErrorNegocio("MISMO_LABORATORIO", "Elige otro laboratorio de destino.");
  const origen = await obtener(db, id);
  const destino = await obtener(db, destinoId);
  return db.transaction(async (tx) => {
    const movidos = await tx.update(producto).set({ laboratorioId: destinoId }).where(eq(producto.laboratorioId, id)).returning({ id: producto.id });
    await tx.delete(laboratorio).where(eq(laboratorio.id, id));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "UNIFICAR_LABORATORIOS", entidad: "laboratorio", entidadId: destinoId, detalle: { origen: origen.nombre, destino: destino.nombre, productos: movidos.map((p) => p.id) } });
    return { id: destinoId, productos: movidos.length };
  });
}

export async function eliminarLaboratorio(db: Db, user: Sesion, id: number) {
  const l = await obtener(db, id);
  const [uso] = await db.select({ id: producto.id }).from(producto).where(eq(producto.laboratorioId, id)).limit(1);
  if (uso) throw new ErrorNegocio("LABORATORIO_EN_USO", `«${l.nombre}» tiene productos. Usa Unificar para moverlos a otro laboratorio.`, 409);
  await db.transaction(async (tx) => {
    await tx.delete(laboratorio).where(eq(laboratorio.id, id));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "ELIMINAR_LABORATORIO", entidad: "laboratorio", entidadId: id, detalle: { nombre: l.nombre } });
  });
  return { id };
}
