import { and, asc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima, mesDe, r2 } from "../util";

const { comision, comisionDiaria, liquidacionMensual, usuario, auditoria } = schema;

export async function misComisiones(db: Db, usuarioId: number) {
  const hoy = hoyLima();
  const mes = mesDe(hoy);
  const [d] = await db.select({ t: sql<number>`coalesce(sum(${comision.monto}),0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
    .from(comision).where(and(eq(comision.usuarioId, usuarioId), eq(comision.fecha, hoy), ne(comision.estado, "REVERTIDA")));
  const [m] = await db.select({ t: sql<number>`coalesce(sum(${comision.monto}),0)`.mapWith(Number) })
    .from(comision).where(and(eq(comision.usuarioId, usuarioId), sql`to_char(${comision.fecha}, 'YYYY-MM') = ${mes}`, ne(comision.estado, "REVERTIDA")));
  const dias = await db.select({ fecha: comision.fecha, total: sql<number>`coalesce(sum(${comision.monto}),0)`.mapWith(Number), lineas: sql<number>`count(*)`.mapWith(Number) })
    .from(comision).where(and(eq(comision.usuarioId, usuarioId), sql`to_char(${comision.fecha}, 'YYYY-MM') = ${mes}`, ne(comision.estado, "REVERTIDA")))
    .groupBy(comision.fecha).orderBy(asc(comision.fecha));
  const liquidaciones = await db.select().from(liquidacionMensual).where(eq(liquidacionMensual.usuarioId, usuarioId)).orderBy(sql`${liquidacionMensual.mes} desc`).limit(6);
  return { hoy: r2(d?.t ?? 0), lineasHoy: d?.n ?? 0, mes: r2(m?.t ?? 0), mesActual: mes, dias: dias.map((x) => ({ ...x, total: r2(x.total) })), liquidaciones };
}

/** Consolida las comisiones devengadas hasta una fecha y las suma al acumulado diario del vendedor (idempotente). */
export async function consolidarHasta(db: Db, fecha: string) {
  return db.transaction(async (tx) => {
    const grupos = await tx.select({ usuarioId: comision.usuarioId, fecha: comision.fecha, total: sql<number>`sum(${comision.monto})`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(comision).where(and(eq(comision.estado, "DEVENGADA"), lte(comision.fecha, fecha))).groupBy(comision.usuarioId, comision.fecha);
    for (const g of grupos) {
      const [cd] = await tx.insert(comisionDiaria).values({ usuarioId: g.usuarioId, fecha: g.fecha, lineas: g.n, total: r2(g.total) })
        .onConflictDoUpdate({ target: [comisionDiaria.usuarioId, comisionDiaria.fecha], set: { lineas: sql`${comisionDiaria.lineas} + ${g.n}`, total: sql`${comisionDiaria.total} + ${r2(g.total)}` } })
        .returning({ id: comisionDiaria.id });
      await tx.update(comision).set({ estado: "CONSOLIDADA", comisionDiariaId: cd.id })
        .where(and(eq(comision.usuarioId, g.usuarioId), eq(comision.fecha, g.fecha), eq(comision.estado, "DEVENGADA")));
    }
    return { grupos: grupos.length };
  });
}

/** Revierte las comisiones de una venta anulada o con nota de crédito (RN-15). */
export async function revertirComisionesVenta(tx: Db, ventaId: number, usuarioId: number) {
  const hoy = hoyLima();
  const lineas = await tx.select().from(comision).where(and(eq(comision.ventaId, ventaId), ne(comision.estado, "REVERTIDA")));
  for (const c of lineas) {
    if (c.estado === "DEVENGADA") {
      await tx.update(comision).set({ estado: "REVERTIDA" }).where(eq(comision.id, c.id));
    } else if (c.estado === "CONSOLIDADA") {
      await tx.update(comision).set({ estado: "REVERTIDA" }).where(eq(comision.id, c.id));
      if (c.comisionDiariaId) await tx.update(comisionDiaria).set({ total: sql`${comisionDiaria.total} - ${c.monto}`, lineas: sql`${comisionDiaria.lineas} - 1` }).where(eq(comisionDiaria.id, c.comisionDiariaId));
    } else if (c.origen !== "AJUSTE") {
      // Ya liquidada o pagada: el descuento entra al mes en curso como ajuste negativo (RN-16).
      await tx.insert(comision).values({ ventaId, usuarioId: c.usuarioId, campanaId: c.campanaId, porcentaje: c.porcentaje, base: -c.base, monto: -c.monto, origen: "AJUSTE", estado: "DEVENGADA", fecha: hoy });
    }
  }
  if (lineas.length) await tx.insert(auditoria).values({ usuarioId, accion: "REVERTIR_COMISIONES", entidad: "venta", entidadId: ventaId, detalle: { lineas: lineas.length } });
}

function finDeMes(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export async function resumenMes(db: Db, mes: string) {
  const hoy = hoyLima();
  const fin = finDeMes(mes);
  await consolidarHasta(db, fin < hoy ? fin : hoy);
  const rows = await db.select({
    usuarioId: comisionDiaria.usuarioId, nombre: usuario.nombre, rol: usuario.rol,
    total: sql<number>`coalesce(sum(${comisionDiaria.total}),0)`.mapWith(Number), lineas: sql<number>`coalesce(sum(${comisionDiaria.lineas}),0)`.mapWith(Number),
    dias: sql<number>`count(*)`.mapWith(Number),
  }).from(comisionDiaria).innerJoin(usuario, eq(usuario.id, comisionDiaria.usuarioId))
    .where(sql`to_char(${comisionDiaria.fecha}, 'YYYY-MM') = ${mes}`).groupBy(comisionDiaria.usuarioId, usuario.nombre, usuario.rol);
  const liqs = await db.select().from(liquidacionMensual).where(eq(liquidacionMensual.mes, mes));
  const pendientes = await db.select({ usuarioId: comision.usuarioId, t: sql<number>`coalesce(sum(${comision.monto}),0)`.mapWith(Number) })
    .from(comision).where(and(eq(comision.estado, "DEVENGADA"), sql`to_char(${comision.fecha}, 'YYYY-MM') = ${mes}`)).groupBy(comision.usuarioId);
  return {
    mes, cerrable: fin <= hoy, finDeMes: fin,
    vendedores: rows.map((r) => {
      const l = liqs.find((x) => x.usuarioId === r.usuarioId);
      return { ...r, total: r2(r.total + (pendientes.find((p) => p.usuarioId === r.usuarioId)?.t ?? 0)), liquidacion: l ? { id: l.id, estado: l.estado, total: l.total, pagadoEn: l.pagadoEn } : null };
    }),
  };
}

/** Cierre de mes: el administrador aprueba el acumulado de cada vendedor (pago mensual). */
export async function cerrarMes(db: Db, user: Sesion, mes: string) {
  const hoy = hoyLima();
  const fin = finDeMes(mes);
  if (fin > hoy) throw new ErrorNegocio("MES_ABIERTO", `El mes ${mes} se puede cerrar desde el ${fin}, su último día.`);
  await consolidarHasta(db, fin);
  return db.transaction(async (tx) => {
    const grupos = await tx.select({ usuarioId: comisionDiaria.usuarioId, total: sql<number>`sum(${comisionDiaria.total})`.mapWith(Number) })
      .from(comisionDiaria).where(and(sql`to_char(${comisionDiaria.fecha}, 'YYYY-MM') = ${mes}`, isNull(comisionDiaria.liquidacionId))).groupBy(comisionDiaria.usuarioId);
    const creadas = []; const omitidas = [];
    for (const g of grupos) {
      if (g.usuarioId === user.id) { omitidas.push({ usuarioId: g.usuarioId, motivo: "El aprobador no puede aprobar su propia comisión." }); continue; }
      const [l] = await tx.insert(liquidacionMensual).values({ usuarioId: g.usuarioId, mes, total: r2(g.total), aprobadoPor: user.id }).returning();
      const dias = await tx.update(comisionDiaria).set({ liquidacionId: l.id })
        .where(and(eq(comisionDiaria.usuarioId, g.usuarioId), sql`to_char(${comisionDiaria.fecha}, 'YYYY-MM') = ${mes}`, isNull(comisionDiaria.liquidacionId))).returning({ id: comisionDiaria.id });
      if (dias.length) await tx.update(comision).set({ estado: "LIQUIDADA" }).where(and(inArray(comision.comisionDiariaId, dias.map((d) => d.id)), eq(comision.estado, "CONSOLIDADA")));
      creadas.push(l);
    }
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "CERRAR_MES_COMISIONES", entidad: "liquidacion_mensual", detalle: { mes, liquidaciones: creadas.length } });
    return { mes, liquidaciones: creadas, omitidas };
  });
}

export async function pagarLiquidacion(db: Db, user: Sesion, id: number) {
  const [l] = await db.select().from(liquidacionMensual).where(eq(liquidacionMensual.id, id));
  if (!l) throw new ErrorNegocio("NO_EXISTE", "La liquidación no existe.", 404);
  if (l.estado === "PAGADA") throw new ErrorNegocio("YA_PAGADA", "Esta liquidación ya fue pagada.");
  await db.transaction(async (tx) => {
    await tx.update(liquidacionMensual).set({ estado: "PAGADA", pagadoEn: new Date() }).where(eq(liquidacionMensual.id, id));
    const dias = await tx.select({ id: comisionDiaria.id }).from(comisionDiaria).where(eq(comisionDiaria.liquidacionId, id));
    if (dias.length) await tx.update(comision).set({ estado: "PAGADA" }).where(inArray(comision.comisionDiariaId, dias.map((d) => d.id)));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "PAGAR_COMISION", entidad: "liquidacion_mensual", entidadId: id, detalle: { total: l.total } });
  });
  return { id, estado: "PAGADA" };
}
