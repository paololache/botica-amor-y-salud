import bcrypt from "bcryptjs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { puede, ROLES, type Rol } from "../permisos";
import { ErrorNegocio } from "../util";

const { usuario, sesionCaja, auditoria } = schema;

const perfiles = z.array(z.enum(ROLES)).min(1, "elige al menos un perfil").transform((r) => [...new Set(r)]);
const clave = z.string().min(8, "la clave debe tener al menos 8 caracteres").max(72, "la clave admite hasta 72 caracteres");
const nombre = z.string().trim().min(3, "escribe el nombre completo").max(80);

export const esquemaNuevoUsuario = z.object({
  nombre,
  login: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, "usa de 3 a 30 letras, números, punto o guion, sin espacios"),
  password: clave,
  roles: perfiles,
});

export const esquemaEdicionUsuario = z.object({
  nombre,
  roles: perfiles,
  activo: z.boolean(),
  password: clave.optional(),
});

const columnas = { id: usuario.id, nombre: usuario.nombre, login: usuario.login, roles: usuario.roles, activo: usuario.activo, creadoEn: usuario.creadoEn };

export async function listarUsuarios(db: Db) {
  return db.select(columnas).from(usuario).orderBy(asc(usuario.nombre));
}

export async function crearUsuario(db: Db, user: Sesion, input: z.infer<typeof esquemaNuevoUsuario>) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.login, input.login));
    if (dup) throw new ErrorNegocio("LOGIN_DUPLICADO", `El usuario «${input.login}» ya existe. Elige otro.`, 409);
    const [u] = await tx.insert(usuario).values({ nombre: input.nombre, login: input.login, passwordHash, roles: input.roles }).returning(columnas);
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "CREAR_USUARIO", entidad: "usuario", entidadId: u.id, detalle: { login: u.login, roles: u.roles } });
    return u;
  });
}

/** Borra un usuario sin operaciones. Quien ya tiene historial se desactiva: sus ventas, cajas y kardex deben seguir mostrando quién las hizo. */
export async function eliminarUsuario(db: Db, user: Sesion, id: number) {
  if (id === user.id) throw new ErrorNegocio("USUARIO_PROPIO", "No puedes eliminar tu propio usuario.");
  const [u] = await db.select(columnas).from(usuario).where(eq(usuario.id, id));
  if (!u) throw new ErrorNegocio("NO_EXISTE", "El usuario no existe.", 404);
  try {
    await db.transaction(async (tx) => {
      await tx.delete(usuario).where(eq(usuario.id, id));
      await tx.insert(auditoria).values({ usuarioId: user.id, accion: "ELIMINAR_USUARIO", entidad: "usuario", entidadId: id, detalle: { login: u.login, nombre: u.nombre, roles: u.roles } });
    });
  } catch (e) {
    // La base impide borrar a quien otras tablas referencian: así ninguna tabla con historial queda sin revisar.
    if ((e as { cause?: { code?: string } }).cause?.code === "23503" || (e as { code?: string }).code === "23503")
      throw new ErrorNegocio("CON_HISTORIAL", `${u.nombre} tiene operaciones registradas y no se puede eliminar. Desactívalo para quitarle el acceso.`, 409);
    throw e;
  }
  return { id };
}

/** Edita un usuario sin dejar el portal sin administrador ni una caja abierta sin quien pueda cerrarla. */
export async function editarUsuario(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaEdicionUsuario>) {
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined;
  return db.transaction(async (tx) => {
    // Dos administradores editándose a la vez no deben poder dejar el portal sin ninguno.
    await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
    const [u] = await tx.select(columnas).from(usuario).where(eq(usuario.id, id));
    if (!u) throw new ErrorNegocio("NO_EXISTE", "El usuario no existe.", 404);
    const seguiraAdmin = input.activo && input.roles.includes("ADMIN");
    if (id === user.id && !input.activo) throw new ErrorNegocio("USUARIO_PROPIO", "No puedes desactivar tu propio usuario.");
    if (id === user.id && !seguiraAdmin) throw new ErrorNegocio("USUARIO_PROPIO", "No puedes quitarte el perfil de propietario. Pídeselo a otro administrador.");
    if (u.activo && u.roles.includes("ADMIN") && !seguiraAdmin) {
      const admins = await tx.select({ id: usuario.id, roles: usuario.roles }).from(usuario).where(eq(usuario.activo, true));
      if (admins.filter((a) => a.roles.includes("ADMIN")).length <= 1) throw new ErrorNegocio("ULTIMO_ADMIN", "Debe quedar al menos un propietario activo.", 409);
    }
    if (!input.activo || !puede(input.roles, "caja")) {
      const [abierta] = await tx.select({ id: sesionCaja.id }).from(sesionCaja).where(and(eq(sesionCaja.usuarioId, id), inArray(sesionCaja.estado, ["ABIERTA", "EN_CIERRE"])));
      if (abierta) throw new ErrorNegocio("CAJA_ABIERTA", `${u.nombre} tiene una caja sin cerrar. Ciérrala antes de ${input.activo ? "quitarle el acceso a caja" : "desactivar el usuario"}.`, 409);
    }
    const [n] = await tx.update(usuario).set({ nombre: input.nombre, roles: input.roles, activo: input.activo, ...(passwordHash ? { passwordHash } : {}) }).where(eq(usuario.id, id)).returning(columnas);
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "EDITAR_USUARIO", entidad: "usuario", entidadId: id, detalle: { login: u.login, antes: { nombre: u.nombre, roles: u.roles as Rol[], activo: u.activo }, despues: { nombre: n.nombre, roles: n.roles, activo: n.activo }, claveCambiada: !!passwordHash } });
    return n;
  });
}
