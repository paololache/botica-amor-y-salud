import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { fecha, montoOCero, texto } from "../validacion";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima, precioSugerido, r2, r4, sumarDias } from "../util";
import { actualizarCostoPromedio, bloquearProductos, registrarKardex, restarLote, sumarLote } from "./inventario";
import { parametros } from "./parametros";

const { compra, compraDetalle, proveedor, producto, presentacion, lote, kardex, movimientoInventario, movDetalle, usuario, auditoria } = schema;

export const esquemaRecepcion = z.object({
  proveedor: z.object({ ruc: z.string().regex(/^(10|20)\d{9}$/, "RUC de 11 dígitos"), razonSocial: texto(3) }),
  tipoComprobante: z.enum(["FACTURA", "BOLETA", "NOTA_COMPRA"]),
  serie: texto(1).max(8),
  numero: texto(1).max(12),
  fechaEmision: fecha,
  items: z.array(z.object({
    presentacionId: z.number().int(),
    cantidad: z.number().int().positive().max(1000000),
    numeroLote: texto(1),
    vencimiento: fecha,
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
    const [dup] = await tx.select({ id: compra.id }).from(compra).where(and(eq(compra.proveedorId, prov.id), eq(compra.tipoComprobante, input.tipoComprobante), eq(compra.serie, input.serie.toUpperCase()), eq(compra.numero, input.numero), ne(compra.estado, "ANULADA")));
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
    correcciones: sql<number>`(select count(*) from auditoria a where a.accion = 'CORREGIR_COSTO_COMPRA' and a.entidad_id = ${compra.id})`.mapWith(Number),
    motivoAnulacion: sql<string | null>`(select a.detalle->>'motivo' from auditoria a where a.accion = 'ANULAR_COMPRA' and a.entidad_id = ${compra.id} order by a.id desc limit 1)`,
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
  costos: z.array(z.object({ detalleId: z.number().int(), costoPresentacion: montoOCero })).min(1),
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

export const esquemaCorreccion = z.object({
  motivo: z.string().trim().min(5, "escribe por qué corriges el costo (mínimo 5 caracteres)"),
  costos: z.array(z.object({ detalleId: z.number().int(), costoPresentacion: montoOCero })).min(1),
});

/** Rehace el costo promedio con los costos vigentes y sin las compras anuladas, desde la primera compra corregida o anulada. */
async function recalcularCostoPromedio(tx: Db, productoId: number, compraId: number) {
  const lineas = await tx.select().from(kardex).where(eq(kardex.productoId, productoId)).orderBy(asc(kardex.id));
  const tocadas = new Set(lineas.filter((l) => l.tipo === "CORRECCION_COSTO" || l.tipo === "ANULACION_COMPRA").map((l) => l.documentoId)).add(compraId);
  const inicio = lineas.findIndex((l) => l.tipo === "COMPRA" && tocadas.has(l.documentoId));
  const detalles = await tx.select().from(compraDetalle).where(eq(compraDetalle.productoId, productoId)).orderBy(asc(compraDetalle.id));
  const anuladas = new Set((await tx.select({ id: compra.id }).from(compra).where(eq(compra.estado, "ANULADA"))).map((c) => c.id));
  const primera = lineas[inicio];
  const baseInicial = primera.saldoUnidades - primera.entrada;
  // Stock sin línea previa en el kardex: el promedio anterior se deduce de lo que dejó la compra original.
  let cp = inicio > 0 ? lineas[inicio - 1].costoPromedio : baseInicial > 0 ? (primera.costoPromedio * primera.saldoUnidades - primera.entrada * primera.costoUnitario) / baseInicial : 0;
  // Unidades de compras anuladas que el saldo histórico aún incluye en cada punto.
  let excluidas = 0;
  for (const l of lineas.slice(inicio)) {
    if (l.tipo === "ANULACION_COMPRA") excluidas -= l.salida;
    if (l.tipo !== "COMPRA") continue;
    if (l.documentoId !== null && anuladas.has(l.documentoId)) { excluidas += l.entrada; continue; }
    const i = detalles.findIndex((d) => d.compraId === l.documentoId && d.loteId === l.loteId);
    const costo = i >= 0 ? r4((detalles[i].costoPresentacion ?? 0) * detalles[i].cantidad / detalles[i].unidades) : l.costoUnitario;
    if (i >= 0) detalles.splice(i, 1);
    const base = Math.max(l.saldoUnidades - l.entrada - excluidas, 0);
    cp = base + l.entrada > 0 ? r4((base * cp + l.entrada * costo) / (base + l.entrada)) : costo;
  }
  await tx.update(producto).set({ costoPromedio: cp }).where(eq(producto.id, productoId));
  return cp;
}

/** Corrige el costo de una compra ya ingresada: el kardex original no se borra y las ventas pasadas conservan su costo. */
export async function corregirCostoCompra(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaCorreccion>) {
  const det = await detalleCompra(db, id);
  if (det.compra.estado !== "CONFIRMADA") throw new ErrorNegocio("ESTADO", "Solo se corrige una compra que ya entró al kardex.");
  const nuevos = new Map(input.costos.map((c) => [c.detalleId, c.costoPresentacion]));
  const ref = `${det.compra.serie}-${det.compra.numero}`;
  return db.transaction(async (tx) => {
    const filas = await tx.select().from(compraDetalle).where(eq(compraDetalle.compraId, id)).orderBy(asc(compraDetalle.id));
    for (const c of input.costos) if (!filas.some((f) => f.id === c.detalleId)) throw new ErrorNegocio("DETALLE", "Una línea no pertenece a esta compra.");
    const cambios = filas.filter((f) => nuevos.has(f.id) && nuevos.get(f.id) !== f.costoPresentacion);
    if (!cambios.length) throw new ErrorNegocio("SIN_CAMBIOS", "No cambiaste ningún costo.");
    const productos = [...new Set(cambios.map((f) => f.productoId))];
    await bloquearProductos(tx, productos);
    for (const f of cambios) {
      const antes = r4((f.costoPresentacion ?? 0) * f.cantidad / f.unidades);
      const despues = r4(nuevos.get(f.id)! * f.cantidad / f.unidades);
      const [l] = await tx.select().from(lote).where(eq(lote.id, f.loteId!));
      const [e] = await tx.select({ n: sql<number>`coalesce(sum(${kardex.entrada}),0)`.mapWith(Number) }).from(kardex).where(eq(kardex.loteId, f.loteId!));
      // Un lote puede venir de varias compras: la corrección pesa según las unidades que aportó esta.
      await tx.update(lote).set({ costoUnitario: r4(Math.max(0, l.costoUnitario + (f.unidades / Math.max(e.n, f.unidades)) * (despues - antes))) }).where(eq(lote.id, l.id));
      await tx.update(compraDetalle).set({ costoPresentacion: nuevos.get(f.id)! }).where(eq(compraDetalle.id, f.id));
    }
    const previos = await tx.select({ id: producto.id, cp: producto.costoPromedio }).from(producto).where(inArray(producto.id, productos));
    const promedios = new Map<number, number>();
    for (const p of productos) promedios.set(p, await recalcularCostoPromedio(tx, p, id));
    const total = filas.reduce((s, f) => s + (nuevos.get(f.id) ?? f.costoPresentacion ?? 0) * f.cantidad, 0);
    await tx.update(compra).set({ total: r2(total) }).where(eq(compra.id, id));
    const pvpSugerido: { producto: string; pvpSugerido: number }[] = [];
    const lineasAuditoria = [];
    for (const f of cambios) {
      const it = det.items.find((x) => x.id === f.id)!;
      await registrarKardex(tx, { productoId: f.productoId, loteId: f.loteId, tipo: "CORRECCION_COSTO", motivo: input.motivo, documentoTipo: det.compra.tipoComprobante, documentoId: id, documentoRef: ref, costoUnitario: r4(nuevos.get(f.id)! * f.cantidad / f.unidades), usuarioId: user.id });
      pvpSugerido.push({ producto: it.producto, pvpSugerido: precioSugerido(promedios.get(f.productoId)!, it.factor, it.porcentajeUtilidad) });
      lineasAuditoria.push({ producto: it.producto, presentacion: it.presentacion, lote: f.numeroLote, antes: f.costoPresentacion, despues: nuevos.get(f.id), promedioAntes: previos.find((p) => p.id === f.productoId)?.cp, promedioDespues: promedios.get(f.productoId) });
    }
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "CORREGIR_COSTO_COMPRA", entidad: "compra", entidadId: id, detalle: { motivo: input.motivo, comprobante: ref, totalAntes: det.compra.totalCosto, totalDespues: r2(total), cambios: lineasAuditoria } });
    return { id, total: r2(total), pvpSugerido };
  });
}

export const esquemaAnulacion = z.object({ motivo: z.string().trim().min(5, "escribe por qué anulas la compra (mínimo 5 caracteres)") });

/** Anula una compra: si ya entró al kardex retira sus unidades con una línea nueva, y solo si siguen en el lote. */
export async function anularCompra(db: Db, user: Sesion, id: number, input: z.infer<typeof esquemaAnulacion>) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(compra).where(eq(compra.id, id));
    if (!c) throw new ErrorNegocio("NO_EXISTE", "La compra no existe.", 404);
    if (c.estado === "ANULADA") throw new ErrorNegocio("ESTADO", "Esta compra ya está anulada.");
    const ref = `${c.serie}-${c.numero}`;
    const movio = c.estado === "CONFIRMADA";
    const filas = await tx.select({ d: compraDetalle, producto: producto.nombre }).from(compraDetalle).innerJoin(producto, eq(producto.id, compraDetalle.productoId)).where(eq(compraDetalle.compraId, id)).orderBy(asc(compraDetalle.id));
    if (movio) {
      const productos = [...new Set(filas.map((f) => f.d.productoId))];
      await bloquearProductos(tx, productos);
      const lotes = await tx.select().from(lote).where(inArray(lote.id, filas.map((f) => f.d.loteId!)));
      const faltan: string[] = [];
      for (const l of lotes) {
        const requeridas = filas.filter((f) => f.d.loteId === l.id).reduce((s, f) => s + f.d.unidades, 0);
        if (l.cantidad < requeridas) faltan.push(`${filas.find((f) => f.d.loteId === l.id)!.producto}, lote ${l.numero}: ya salieron ${requeridas - l.cantidad} de ${requeridas} und.`);
      }
      if (faltan.length) throw new ErrorNegocio("YA_SALIERON", `No se puede anular porque parte de la mercadería ya no está. ${faltan.join("; ")}.`, 409);
      const pendientes = await tx.select({ id: movimientoInventario.id }).from(movimientoInventario).innerJoin(movDetalle, eq(movDetalle.movimientoId, movimientoInventario.id))
        .where(and(eq(movimientoInventario.estado, "PENDIENTE"), inArray(movDetalle.loteId, lotes.map((l) => l.id))));
      if (pendientes.length) throw new ErrorNegocio("SALIDA_PENDIENTE", `Primero aprueba o rechaza ${[...new Set(pendientes.map((p) => `MOV-${String(p.id).padStart(5, "0")}`))].join(", ")}: usa un lote de esta compra.`, 409);
      await tx.update(compra).set({ estado: "ANULADA" }).where(eq(compra.id, id));
      for (const p of productos) await recalcularCostoPromedio(tx, p, id);
      for (const { d: f } of filas) {
        const costoU = r4((f.costoPresentacion ?? 0) * f.cantidad / f.unidades);
        const [l] = await tx.select().from(lote).where(eq(lote.id, f.loteId!));
        const [e] = await tx.select({ n: sql<number>`coalesce(sum(${kardex.entrada}),0)`.mapWith(Number) }).from(kardex).where(eq(kardex.loteId, l.id));
        // Si el lote también vino de otras compras, su costo deja de incluir esta.
        if (e.n > f.unidades) await tx.update(lote).set({ costoUnitario: r4(Math.max(0, (l.costoUnitario * e.n - f.unidades * costoU) / (e.n - f.unidades))) }).where(eq(lote.id, l.id));
        await restarLote(tx, l.id, f.unidades);
        await registrarKardex(tx, { productoId: f.productoId, loteId: l.id, tipo: "ANULACION_COMPRA", motivo: input.motivo, documentoTipo: c.tipoComprobante, documentoId: id, documentoRef: ref, salida: f.unidades, costoUnitario: costoU, usuarioId: user.id });
      }
    } else {
      await tx.update(compra).set({ estado: "ANULADA" }).where(eq(compra.id, id));
    }
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "ANULAR_COMPRA", entidad: "compra", entidadId: id, detalle: { motivo: input.motivo, comprobante: ref, estadoAnterior: c.estado, total: c.total, lineas: filas.map((f) => ({ producto: f.producto, lote: f.d.numeroLote, unidades: f.d.unidades, costoPresentacion: f.d.costoPresentacion })) } });
    return { id, estado: "ANULADA", movioStock: movio };
  });
}

/** Lo que el administrador necesita ver antes de corregir: unidades que ya salieron y correcciones anteriores. */
export async function datosCorreccion(db: Db, id: number) {
  const filas = await db.select({ id: compraDetalle.id, loteId: compraDetalle.loteId, unidades: compraDetalle.unidades, enLote: lote.cantidad }).from(compraDetalle).leftJoin(lote, eq(lote.id, compraDetalle.loteId)).where(eq(compraDetalle.compraId, id));
  const salidas: Record<number, number> = {};
  for (const f of filas) {
    if (!f.loteId) continue;
    const [e] = await db.select({ n: sql<number>`coalesce(sum(${kardex.entrada}),0)`.mapWith(Number) }).from(kardex).where(eq(kardex.loteId, f.loteId));
    salidas[f.id] = Math.min(f.unidades, Math.max(0, e.n - (f.enLote ?? 0)));
  }
  const historial = await db.select({ id: auditoria.id, fecha: auditoria.fecha, usuario: usuario.nombre, detalle: auditoria.detalle }).from(auditoria).leftJoin(usuario, eq(usuario.id, auditoria.usuarioId))
    .where(and(eq(auditoria.accion, "CORREGIR_COSTO_COMPRA"), eq(auditoria.entidadId, id))).orderBy(desc(auditoria.id));
  return { salidas, historial };
}
