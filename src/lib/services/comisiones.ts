import { and, asc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { z } from "zod";
import { tieneRol } from "../permisos";
import { filas } from "../sqlrows";
import { diasEntre, ErrorNegocio, esFechaValida, hoy as hoyLima, mesDe, r2, sumarDias } from "../util";

const { comision, comisionDiaria, liquidacionMensual, usuario, venta, ventaDetalle, producto, presentacion, lote, auditoria } = schema;

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
    usuarioId: comisionDiaria.usuarioId, nombre: usuario.nombre,
    total: sql<number>`coalesce(sum(${comisionDiaria.total}),0)`.mapWith(Number), lineas: sql<number>`coalesce(sum(${comisionDiaria.lineas}),0)`.mapWith(Number),
    dias: sql<number>`count(*)`.mapWith(Number),
  }).from(comisionDiaria).innerJoin(usuario, eq(usuario.id, comisionDiaria.usuarioId))
    .where(sql`to_char(${comisionDiaria.fecha}, 'YYYY-MM') = ${mes}`).groupBy(comisionDiaria.usuarioId, usuario.nombre);
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

/** Lo vendido con comisión por un vendedor en el mes; sin las revertidas, para que cuadre con su acumulado. */
export async function detalleVendedor(db: Db, usuarioId: number, mes: string) {
  const [u] = await db.select({ nombre: usuario.nombre }).from(usuario).where(eq(usuario.id, usuarioId));
  if (!u) throw new ErrorNegocio("NO_EXISTE", "El vendedor no existe.", 404);
  const lineas = await db.select({
    id: comision.id, fecha: comision.fecha, origen: comision.origen, porcentaje: comision.porcentaje, base: comision.base, monto: comision.monto,
    tipoComprobante: venta.tipoComprobante, serie: venta.serie, numero: venta.numero,
    producto: producto.nombre, presentacion: presentacion.nombre, lote: lote.numero, cantidad: ventaDetalle.cantidad, vendido: ventaDetalle.subtotal,
  }).from(comision).innerJoin(venta, eq(venta.id, comision.ventaId))
    .leftJoin(ventaDetalle, eq(ventaDetalle.id, comision.ventaDetalleId))
    .leftJoin(producto, eq(producto.id, ventaDetalle.productoId))
    .leftJoin(presentacion, eq(presentacion.id, ventaDetalle.presentacionId))
    .leftJoin(lote, eq(lote.id, ventaDetalle.loteId))
    .where(and(eq(comision.usuarioId, usuarioId), sql`to_char(${comision.fecha}, 'YYYY-MM') = ${mes}`, ne(comision.estado, "REVERTIDA")))
    .orderBy(asc(comision.fecha), asc(comision.id));
  return { vendedor: u.nombre, mes, total: r2(lineas.reduce((s, l) => s + l.monto, 0)), vendido: r2(lineas.reduce((s, l) => s + (l.vendido ?? 0), 0)), lineas };
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

const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const fechaValida = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(esFechaValida, "fecha no válida");
const vacio = (v: unknown) => (v === "" ? undefined : v);

export const esquemaHistoricoComisiones = z.object({
  periodo: z.enum(["dia", "semana", "mes", "anio", "rango"]).default("anio"),
  fecha: z.preprocess(vacio, fechaValida.optional()), // día de referencia para día, semana y mes
  anio: z.preprocess(vacio, z.coerce.number().int().min(2000).max(2100).optional()),
  desde: z.preprocess(vacio, fechaValida.optional()),
  hasta: z.preprocess(vacio, fechaValida.optional()),
  turno: z.preprocess(vacio, z.enum(["MAÑANA", "TARDE", "NOCHE", "COMPLETO"]).optional()),
  usuarioId: z.preprocess(vacio, z.coerce.number().int().optional()),
});

const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();
const fechaLarga = (f: string) => `${DIAS_SEMANA[diaSemana(f)]} ${Number(f.slice(8, 10))} de ${MESES_LARGO[Number(f.slice(5, 7)) - 1]} de ${f.slice(0, 4)}`;

/**
 * Comisiones en barras para quien vende: por mes de un año, por día de un mes, una semana o un rango, o por hora de un día;
 * se puede filtrar por turno. El administrador y el contador pueden ver a un vendedor o a todos.
 */
export async function historicoComisiones(db: Db, user: Sesion, q: z.infer<typeof esquemaHistoricoComisiones>) {
  const hoy = hoyLima();
  const ref = q.fecha ?? hoy;
  let desde: string, hasta: string; // hasta es exclusivo
  if (q.periodo === "dia") { desde = ref; hasta = sumarDias(ref, 1); }
  else if (q.periodo === "semana") { desde = sumarDias(ref, -((diaSemana(ref) + 6) % 7)); hasta = sumarDias(desde, 7); } // de lunes a domingo
  else if (q.periodo === "mes") { desde = `${ref.slice(0, 7)}-01`; const m = Number(ref.slice(5, 7)); hasta = m === 12 ? `${Number(ref.slice(0, 4)) + 1}-01-01` : `${ref.slice(0, 4)}-${String(m + 1).padStart(2, "0")}-01`; }
  else if (q.periodo === "anio") { const a = q.anio ?? Number(hoy.slice(0, 4)); desde = `${a}-01-01`; hasta = `${a + 1}-01-01`; }
  else {
    if (!q.desde || !q.hasta) throw new ErrorNegocio("FILTRO", "Elige la fecha de inicio y de fin del rango.");
    if (q.hasta < q.desde) throw new ErrorNegocio("FILTRO", "La fecha final no puede ser anterior a la inicial.");
    if (diasEntre(q.desde, q.hasta) > 366 * 3) throw new ErrorNegocio("FILTRO", "El rango puede ser de hasta 3 años.");
    desde = q.desde; hasta = sumarDias(q.hasta, 1);
  }
  const nivel: "hora" | "dia" | "mes" = q.periodo === "dia" ? "hora" : q.periodo === "anio" || (q.periodo === "rango" && diasEntre(desde, hasta) > 62) ? "mes" : "dia";

  const gestiona = tieneRol(user.roles, "ADMIN", "CONTADOR");
  const usuarioId = gestiona ? q.usuarioId ?? null : user.id;
  const grupo = nivel === "hora" ? sql`to_char(v.fecha at time zone 'America/Lima', 'HH24')` : nivel === "dia" ? sql`c.fecha::text` : sql`to_char(c.fecha, 'YYYY-MM')`;
  const rows = await filas<{ grupo: string; total: string; lineas: string; ventas: string }>(db, sql`
    select ${grupo} as grupo, sum(c.monto) as total, count(*) as lineas, count(distinct c.venta_id) as ventas
    from comision c join venta v on v.id = c.venta_id left join sesion_caja s on s.id = v.sesion_id
    where c.estado <> 'REVERTIDA' and c.fecha >= ${desde} and c.fecha < ${hasta}
      ${usuarioId ? sql`and c.usuario_id = ${usuarioId}` : sql``} ${q.turno ? sql`and s.turno = ${q.turno}` : sql``}
    group by 1`);
  const mapa = new Map(rows.map((r) => [r.grupo, r]));

  let claves: string[];
  if (nivel === "mes") {
    claves = [];
    for (let m = desde.slice(0, 7); m < hasta.slice(0, 7) || (m === hasta.slice(0, 7) && hasta.slice(8) !== "01"); ) {
      claves.push(m);
      const [a, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`;
    }
  } else if (nivel === "dia") claves = Array.from({ length: diasEntre(desde, hasta) }, (_, i) => sumarDias(desde, i));
  else {
    const horas = rows.map((r) => Number(r.grupo));
    claves = horas.length ? Array.from({ length: Math.max(...horas) - Math.min(...horas) + 1 }, (_, i) => String(Math.min(...horas) + i).padStart(2, "0")) : [];
  }
  const variosAnios = claves.length && nivel === "mes" && claves[0].slice(0, 4) !== claves[claves.length - 1].slice(0, 4);
  const barras = claves.map((clave) => {
    const r = mapa.get(clave);
    const etiqueta = nivel === "mes" ? `${MESES_CORTO[Number(clave.slice(5, 7)) - 1]}${variosAnios ? ` ${clave.slice(2, 4)}` : ""}`
      : nivel === "dia" ? (q.periodo === "semana" ? `${DIAS_SEMANA[diaSemana(clave)]} ${Number(clave.slice(8))}` : String(Number(clave.slice(8))))
      : `${clave}h`;
    const detalle = nivel === "mes" ? `${MESES_LARGO[Number(clave.slice(5, 7)) - 1]} de ${clave.slice(0, 4)}` : nivel === "dia" ? fechaLarga(clave) : `${clave}:00 a ${clave}:59`;
    return { clave, etiqueta, detalle: detalle[0].toUpperCase() + detalle.slice(1), total: r2(Number(r?.total ?? 0)), lineas: Number(r?.lineas ?? 0), ventas: Number(r?.ventas ?? 0) };
  });
  const vendedores = gestiona ? await db.select({ id: usuario.id, nombre: usuario.nombre }).from(usuario)
    .where(sql`exists (select 1 from comision c where c.usuario_id = ${usuario.id})`).orderBy(usuario.nombre) : [];
  return {
    periodo: q.periodo, nivel, desde, hasta: sumarDias(hasta, -1), usuarioId, propias: !gestiona, vendedores,
    total: r2(barras.reduce((a, b) => a + b.total, 0)), lineas: barras.reduce((a, b) => a + b.lineas, 0), ventas: rows.reduce((a, r) => a + Number(r.ventas), 0),
    barras,
  };
}
