import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio } from "../util";

const { categoria, producto, auditoria } = schema;

/** «  medicamentos   genéricos » → «Medicamentos genéricos». */
const normalizar = (t: string) => { const s = t.replace(/\s+/g, " ").trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

export async function listarCategorias(db: Db) {
  // Conteo con alias explícitos: dentro de la subconsulta «id» sería el del producto, no el de la categoría.
  const rows = await db.execute(sql`select c.id, c.nombre, (select count(*) from producto p where p.categoria_id = c.id) as productos from categoria c order by c.nombre`);
  const lista = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  return lista.map((r) => ({ id: Number(r.id), nombre: String(r.nombre), productos: Number(r.productos) }));
}

export const esquemaCategoria = z.object({ nombre: z.string().trim().min(2, "escribe el nombre de la categoría").max(60) });

export async function crearCategoria(db: Db, user: Sesion, input: z.infer<typeof esquemaCategoria>) {
  const nombre = normalizar(input.nombre);
  const [existe] = await db.select().from(categoria).where(sql`lower(${categoria.nombre}) = lower(${nombre})`);
  if (existe) throw new ErrorNegocio("DUPLICADO", `Ya existe la categoría «${existe.nombre}».`, 409);
  const [c] = await db.insert(categoria).values({ nombre }).returning();
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "CREAR_CATEGORIA", entidad: "categoria", entidadId: c.id, detalle: { nombre } });
  return { ...c, productos: 0 };
}

export async function renombrarCategoria(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaCategoria>) {
  const nombre = normalizar(input.nombre);
  const [otra] = await db.select().from(categoria).where(sql`lower(${categoria.nombre}) = lower(${nombre}) and ${categoria.id} <> ${id}`);
  if (otra) throw new ErrorNegocio("DUPLICADO", `Ya existe la categoría «${otra.nombre}».`, 409);
  const [c] = await db.update(categoria).set({ nombre }).where(eq(categoria.id, id)).returning();
  if (!c) throw new ErrorNegocio("NO_EXISTE", "La categoría no existe.", 404);
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "RENOMBRAR_CATEGORIA", entidad: "categoria", entidadId: id, detalle: { nombre } });
  return c;
}

/** Solo se elimina una categoría que ningún producto usa; si la usan, primero hay que mover esos productos. */
export async function eliminarCategoria(db: Db, user: Sesion, id: number) {
  const [c] = await db.select().from(categoria).where(eq(categoria.id, id));
  if (!c) throw new ErrorNegocio("NO_EXISTE", "La categoría no existe.", 404);
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(producto).where(eq(producto.categoriaId, id));
  if (n > 0) throw new ErrorNegocio("EN_USO", `«${c.nombre}» tiene ${n} ${n === 1 ? "producto" : "productos"}: cámbialos de categoría antes de eliminarla.`, 409);
  await db.delete(categoria).where(eq(categoria.id, id));
  await db.insert(auditoria).values({ usuarioId: user.id, accion: "ELIMINAR_CATEGORIA", entidad: "categoria", entidadId: id, detalle: { nombre: c.nombre } });
  return { id, eliminada: true };
}
