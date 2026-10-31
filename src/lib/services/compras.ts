import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima, precioSugerido, r2, r4, sumarDias } from "../util";
import { actualizarCostoPromedio, bloquearProductos, registrarKardex, sumarLote } from "./inventario";
import { parametros } from "./parametros";

const { compra, compraDetalle, proveedor, producto, presentacion, lote, usuario, auditoria } = schema;

export const esquemaRecepcion = z.object({
  proveedor: z.object({ ruc: z.string().regex(/^(10|20)\d{9}$/, "RUC de 11 dígitos"), razonSocial: z.string().min(3) }),
  tipoComprobante: z.enum(["FACTURA", "BOLETA", "NOTA_COMPRA"]),
  serie: z.string().min(1).max(8),
  numero: z.string().min(1).max(12),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({
    presentacionId: z.number().int(),
    cantidad: z.number().int().positive(),
    numeroLote: z.string().min(1),
    vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1),
});

/** Paso 1: el inventariador registra lo que llegó (cantidad, lote, vencimiento) sin ver ni ingresar costos. */
export async function registrarRecepcion(db: Db, user: Sesion, input: z.infer<typeof esquemaRecepcion>) {
  const hoy = hoyLima();
  const pres = await db.select().from(presentacion).where(inArray(presentacion.id, input.items.map((i) => i.presentacionId)));
  const mapa = new Map(pres.map((p) => [p.id, p]));
  for (const it of input.items) {
    if (!mapa.has(it.presentacionId)) throw new ErrorNegocio("PRESENTACION", "Una presentación no existe.");
    if (it.vencimiento <= hoy) throw new ErrorNegocio("VENCIDO", `El lote ${it.numeroLote} ya está vencido; no se puede recibir.`);
  }
  return db.transaction(async (tx) => {
    const [prov] = await tx.insert(proveedor).values(input.proveedor).onConflictDoUpdate({ target: proveedor.ruc, set: { razonSocial: input.proveedor.razonSocial } }).returning();
    const [dup] = await tx.select({ id: compra.id }).from(compra).where(and(eq(compra.proveedorId, prov.id), eq(compra.tipoComprobante, input.tipoComprobante), eq(compra.serie, input.serie.toUpperCase()), eq(compra.numero, input.numero)));
    if (dup) throw new ErrorNegocio("DUPLICADO", "Este comprobante del proveedor ya está registrado (RUC + serie + número).", 409);
    const [c] = await tx.insert(compra).values({ proveedorId: prov.id, tipoComprobante: input.tipoComprobante, serie: input.serie.toUpperCase(), numero: input.numero, fechaEmision: input.fechaEmision, registradoPor: user.id, estado: "PENDIENTE_COSTO" }).returning();
    await tx.insert(compraDetalle).values(input.items.map((it) => {
      const p = mapa.get(it.presentacionId)!;
      return { compraId: c.id, productoId: p.productoId, presentacionId: p.id, cantidad: it.cantidad, unidades: it.cantidad * p.factor, numeroLote: it.numeroLote.toUpperCase(), vencimiento: it.vencimiento };
    }));
    const avisos = input.items.filter((it) => it.vencimiento < sumarDias(hoy, 180)).map((it) => `El lote ${it.numeroLote} vence en menos de 6 meses.`);
    return { id: c.id, estado: c.estado, avisos };
  });
}

export async function listarCompras(db: Db, estado?: string) {
  const rows = await db.select({
    id: compra.id, proveedor: proveedor.razonSocial, ruc: proveedor.ruc, tipo: compra.tipoComprobante, serie: compra.serie, numero: compra.numero,
    fechaEmision: compra.fechaEmision, estado: compra.estado, registradoEn: compra.registradoEn, registradoPor: usuario.nombre, totalCosto: compra.total,
  }).from(compra).innerJoin(proveedor, eq(proveedor.id, compra.proveedorId)).innerJoin(usuario, eq(usuario.id, compra.registradoPor))
    .where(estado ? eq(compra.estado, estado) : undefined).orderBy(desc(compra.id)).limit(100);
  return rows;
}

export async function detalleCompra(db: Db, id: number) {
  const [c] = await db.select().from(compra).where(eq(compra.id, id));
  if (!c) throw new ErrorNegocio("NO_EXISTE", "La compra no existe.", 404);
  const items = await db.select({
    id: compraDetalle.id, producto: producto.nombre, productoId: producto.id, presentacion: presentacion.nombre, factor: presentacion.factor, cantidad: compraDetalle.cantidad,
    unidades: compraDetalle.unidades, numeroLote: compraDetalle.numeroLote, vencimiento: compraDetalle.vencimiento, costoPresentacion: compraDetalle.costoPresentacion,
    costoAnterior: producto.costoPromedio, pvp: presentacion.pvp, porcentajeUtilidad: producto.porcentajeUtilidad,
  }).from(compraDetalle).innerJoin(producto, eq(producto.id, compraDetalle.productoId)).innerJoin(presentacion, eq(presentacion.id, compraDetalle.presentacionId))
    .where(eq(compraDetalle.compraId, id));
  const { total, ...cab } = c;
  return { compra: { ...cab, totalCosto: total }, items: items.map((i) => ({ ...i, costoAnterior: r4(i.costoAnterior * i.factor) })) };
}

export const esquemaCosteo = z.object({
  costos: z.array(z.object({ detalleId: z.number().int(), costoPresentacion: z.number().min(0) })).min(1),
  confirmarVariacion: z.boolean().optional(),
});

/** Paso 2: el administrador registra el costo y la compra entra al kardex (RN-21). */
export async function costearCompra(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaCosteo>) {
  const { variacion_costo_pct } = await parametros(db);
  const det = await detalleCompra(db, id);
  if (det.compra.estado !== "PENDIENTE_COSTO") throw new ErrorNegocio("ESTADO", "Esta compra ya fue ingresada al kardex.");
  const costos = new Map(input.costos.map((c) => [c.detalleId, c.costoPresentacion]));
  const variaciones: string[] = [];
  for (const it of det.items) {
    const c = costos.get(it.id);
    if (c === undefined) throw new ErrorNegocio("FALTA_COSTO", `Falta el costo de ${it.producto}.`);
    if (it.costoAnterior > 0 && c > 0 && Math.abs(c - it.costoAnterior) / it.costoAnterior * 100 > variacion_costo_pct)
      variaciones.push(`${it.producto}: S/ ${it.costoAnterior.toFixed(2)} → S/ ${c.toFixed(2)}`);
  }
  if (variaciones.length && !input.confirmarVariacion)
    throw new ErrorNegocio("VARIACION_COSTO", `El costo varía más de ${variacion_costo_pct}% en: ${variaciones.join("; ")}. Confirma para continuar.`, 422);
  return db.transaction(async (tx) => {
    const filas = await tx.select().from(compraDetalle).where(eq(compraDetalle.compraId, id));
    await bloquearProductos(tx, filas.map((f) => f.productoId));
    let total = 0;
    const ref = `${det.compra.serie}-${det.compra.numero}`;
    const pvpSugerido: { producto: string; pvpSugerido: number }[] = [];
    for (const f of filas) {
      const cp = costos.get(f.id)!;
      const costoU = r4(cp * f.cantidad / f.unidades);
      total += cp * f.cantidad;
      const [existente] = await tx.select().from(lote).where(and(eq(lote.productoId, f.productoId), eq(lote.numero, f.numeroLote)));
      let loteId: number;
      if (existente) {
        loteId = existente.id;
        const nuevoCosto = existente.cantidad + f.unidades > 0 ? (existente.cantidad * existente.costoUnitario + f.unidades * costoU) / (existente.cantidad + f.unidades) : costoU;
        await tx.update(lote).set({ costoUnitario: r4(nuevoCosto), vencimiento: f.vencimiento, estado: "ACTIVO" }).where(eq(lote.id, loteId));
        await sumarLote(tx, loteId, f.unidades);
      } else {
        const [l] = await tx.insert(lote).values({ productoId: f.productoId, numero: f.numeroLote, vencimiento: f.vencimiento, costoUnitario: costoU, cantidad: f.unidades }).returning({ id: lote.id });
        loteId = l.id;
      }
      const { cpNuevo } = await actualizarCostoPromedio(tx, f.productoId, f.unidades, costoU);
      await registrarKardex(tx, { productoId: f.productoId, loteId, tipo: "COMPRA", documentoTipo: det.compra.tipoComprobante, documentoId: id, documentoRef: ref, entrada: f.unidades, costoUnitario: costoU, usuarioId: user.id });
      await tx.update(compraDetalle).set({ costoPresentacion: cp, loteId }).where(eq(compraDetalle.id, f.id));
      const it = det.items.find((x) => x.id === f.id)!;
      pvpSugerido.push({ producto: it.producto, pvpSugerido: precioSugerido(cpNuevo, it.factor, it.porcentajeUtilidad) });
    }
    await tx.update(compra).set({ estado: "CONFIRMADA", costeadoPor: user.id, costeadoEn: new Date(), total: r2(total) }).where(eq(compra.id, id));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "COSTEAR_COMPRA", entidad: "compra", entidadId: id, detalle: { total: r2(total) } });
    return { id, estado: "CONFIRMADA", total: r2(total), pvpSugerido };
  });
}
