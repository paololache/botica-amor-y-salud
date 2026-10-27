import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, r4 } from "../util";
import { bloquearProductos, registrarKardex, restarLote, sumarLote } from "./inventario";
import { parametros } from "./parametros";

const { motivo, movimientoInventario, movDetalle, lote, producto, usuario, auditoria } = schema;

export async function listarMotivos(db: Db) {
  return db.select().from(motivo).where(eq(motivo.activo, true)).orderBy(motivo.tipo, motivo.nombre);
}

export const esquemaMovimiento = z.object({
  motivoId: z.number().int(),
  descripcion: z.string().min(10, "mínimo 10 caracteres"),
  evidencia: z.string().optional(),
  items: z.array(z.object({ loteId: z.number().int(), unidades: z.number().int().positive() })).min(1),
});

async function aplicar(tx: Db, movId: number, tipo: string, motivoCodigo: string, usuarioId: number) {
  const det = await tx.select().from(movDetalle).where(eq(movDetalle.movimientoId, movId));
  await bloquearProductos(tx, det.map((d) => d.productoId));
  for (const d of det) {
    if (tipo === "SALIDA") await restarLote(tx, d.loteId, d.unidades);
    else await sumarLote(tx, d.loteId, d.unidades);
    await registrarKardex(tx, { productoId: d.productoId, loteId: d.loteId, tipo, motivo: motivoCodigo, documentoTipo: tipo === "SALIDA" ? "SALIDA" : "ENTRADA", documentoId: movId, documentoRef: `MOV-${String(movId).padStart(5, "0")}`, salida: tipo === "SALIDA" ? d.unidades : 0, entrada: tipo === "SALIDA" ? 0 : d.unidades, costoUnitario: d.costoUnitario, usuarioId });
  }
}

/** Salida o entrada no comercial con motivo del catálogo (RN-08). Pasa a aprobación según el motivo o el monto. */
export async function registrarMovimiento(db: Db, user: Sesion, input: z.infer<typeof esquemaMovimiento>) {
  const [m] = await db.select().from(motivo).where(eq(motivo.id, input.motivoId));
  if (!m || !m.activo) throw new ErrorNegocio("MOTIVO", "Elige un motivo del catálogo.");
  if (m.requiereEvidencia && !input.evidencia?.trim()) throw new ErrorNegocio("EVIDENCIA", `El motivo «${m.nombre}» exige adjuntar evidencia.`, 422);
  const lotes = await db.select().from(lote).where(inArray(lote.id, input.items.map((i) => i.loteId)));
  const mapa = new Map(lotes.map((l) => [l.id, l]));
  let total = 0;
  for (const it of input.items) {
    const l = mapa.get(it.loteId);
    if (!l) throw new ErrorNegocio("LOTE", "Uno de los lotes no existe.");
    if (m.tipo === "SALIDA" && l.cantidad < it.unidades) throw new ErrorNegocio("STOCK_INSUFICIENTE", `El lote ${l.numero} solo tiene ${l.cantidad} unidades.`, 409);
    total += l.costoUnitario * it.unidades;
  }
  const { umbral_aprobacion_salida } = await parametros(db);
  const requiere = m.requiereAprobacion || total > umbral_aprobacion_salida;
  return db.transaction(async (tx) => {
    const [mov] = await tx.insert(movimientoInventario).values({
      motivoId: m.id, descripcion: input.descripcion, evidencia: input.evidencia ?? null, estado: requiere ? "PENDIENTE" : "APROBADA",
      totalCosto: r4(total), registradoPor: user.id, decididoEn: requiere ? null : new Date(),
    }).returning();
    await tx.insert(movDetalle).values(input.items.map((it) => {
      const l = mapa.get(it.loteId)!;
      return { movimientoId: mov.id, productoId: l.productoId, loteId: l.id, unidades: it.unidades, costoUnitario: l.costoUnitario };
    }));
    if (!requiere) await aplicar(tx, mov.id, m.tipo, m.codigo, user.id);
    return { id: mov.id, estado: mov.estado, requiereAprobacion: requiere, aprobador: requiere ? m.rolAprobador : null, totalCosto: r4(total) };
  });
}

export async function listarMovimientos(db: Db, user: Sesion, estado?: string) {
  const reg = usuario;
  const rows = await db.select({
    id: movimientoInventario.id, motivo: motivo.nombre, motivoCodigo: motivo.codigo, tipo: motivo.tipo, rolAprobador: motivo.rolAprobador, descripcion: movimientoInventario.descripcion,
    evidencia: movimientoInventario.evidencia, estado: movimientoInventario.estado, totalCosto: movimientoInventario.totalCosto, fecha: movimientoInventario.fecha,
    registradoPor: reg.nombre, registradoPorId: movimientoInventario.registradoPor, comentario: movimientoInventario.comentario,
  }).from(movimientoInventario).innerJoin(motivo, eq(motivo.id, movimientoInventario.motivoId)).innerJoin(reg, eq(reg.id, movimientoInventario.registradoPor))
    .where(estado ? eq(movimientoInventario.estado, estado) : undefined).orderBy(desc(movimientoInventario.id)).limit(100);
  const ids = rows.map((r) => r.id);
  const det = ids.length ? await db.select({ movimientoId: movDetalle.movimientoId, producto: producto.nombre, lote: lote.numero, vencimiento: lote.vencimiento, unidades: movDetalle.unidades })
    .from(movDetalle).innerJoin(producto, eq(producto.id, movDetalle.productoId)).innerJoin(lote, eq(lote.id, movDetalle.loteId)).where(inArray(movDetalle.movimientoId, ids)) : [];
  return rows.map((r) => ({ ...r, puedoAprobar: r.estado === "PENDIENTE" && r.registradoPorId !== user.id && (user.rol === "ADMIN" || user.rol === r.rolAprobador), items: det.filter((d) => d.movimientoId === r.id) }));
}

export const esquemaDecision = z.object({ decision: z.enum(["APROBAR", "RECHAZAR"]), comentario: z.string().optional() });

/** Quien registra una salida no puede aprobarla (RN-09). El stock solo se mueve al aprobar. */
export async function decidirMovimiento(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaDecision>) {
  const [mov] = await db.select().from(movimientoInventario).where(eq(movimientoInventario.id, id));
  if (!mov || mov.estado !== "PENDIENTE") throw new ErrorNegocio("ESTADO", "Este movimiento ya no está pendiente.");
  const [m] = await db.select().from(motivo).where(eq(motivo.id, mov.motivoId));
  if (mov.registradoPor === user.id) throw new ErrorNegocio("SEGREGACION", "No puedes aprobar un movimiento que registraste tú (RN-09).", 403);
  if (user.rol !== "ADMIN" && user.rol !== m.rolAprobador) throw new ErrorNegocio("SIN_PERMISO", "Este motivo lo aprueba otro rol.", 403);
  if (input.decision === "RECHAZAR" && !input.comentario?.trim()) throw new ErrorNegocio("COMENTARIO", "Escribe el motivo del rechazo.");
  await db.transaction(async (tx) => {
    if (input.decision === "APROBAR") await aplicar(tx, id, m.tipo, m.codigo, user.id);
    await tx.update(movimientoInventario).set({ estado: input.decision === "APROBAR" ? "APROBADA" : "RECHAZADA", aprobadoPor: user.id, comentario: input.comentario ?? null, decididoEn: new Date() }).where(eq(movimientoInventario.id, id));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: `${input.decision}_MOVIMIENTO`, entidad: "movimiento_inventario", entidadId: id });
  });
  return { id, estado: input.decision === "APROBAR" ? "APROBADA" : "RECHAZADA" };
}

export { and };
