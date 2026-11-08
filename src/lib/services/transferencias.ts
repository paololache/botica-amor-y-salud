import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { puede, tieneRol } from "../permisos";
import { ErrorNegocio, hoy as hoyLima, MEDIOS, r2, r4 } from "../util";
import { monto, montoOCero, texto } from "../validacion";
import { asignarFEFO, bloquearProductos, registrarKardex } from "./inventario";
import { SERIES, siguienteNumero } from "./ventas";

const { transferencia, transferenciaDetalle, producto, presentacion, laboratorio, categoria, lote, campana, usuario, auditoria, venta, ventaDetalle, ventaPago, cliente } = schema;

const SERIE = "TR01";
const id = z.number().int().positive().max(2147483647);
const referencia = (t: { serie: string; numero: number }) => `${t.serie}-${String(t.numero).padStart(8, "0")}`;

export const esquemaTransferencia = z.object({
  tipoDestino: z.enum(["EMPRESA", "SUCURSAL"]),
  destino: texto(3, "escribe la razón social, el nombre del comprador o de la sucursal").max(120),
  destinoTipoDoc: z.enum(["RUC", "DNI"]).optional(),
  destinoDoc: z.string().trim().optional(),
  motivo: texto(5, "escribe el motivo (mínimo 5 caracteres)").max(250),
  items: z.array(z.object({ productoId: id, loteId: id.nullable().optional(), unidades: z.number().int().positive().max(1000000) })).min(1, "agrega al menos un producto").max(100),
}).refine((t) => t.tipoDestino === "SUCURSAL" || (t.destinoTipoDoc === "RUC" ? /^(10|20)\d{9}$/.test(t.destinoDoc ?? "") : t.destinoTipoDoc === "DNI" && /^\d{8}$/.test(t.destinoDoc ?? "")),
  { message: "escribe un RUC de 11 dígitos (empieza con 10 o 20) o un DNI de 8 dígitos", path: ["destinoDoc"] });

/** Venta a otra farmacia: precio, vendedor y medio de pago. Traslado a sucursal: nada de eso, sale a costo. */
export const esquemaAprobacion = z.object({
  precios: z.array(z.object({ detalleId: id, precioUnitario: monto })).default([]),
  vendedorId: id.optional(),
  medioPago: z.enum(MEDIOS).optional(),
  costoAdicional: montoOCero.optional(),
  comentario: z.string().trim().max(250).optional(),
  /** Vender por debajo del precio mínimo (costo + IGV), p. ej. para recuperar la inversión. Solo el administrador, con motivo. */
  motivoBajoCosto: z.string().trim().max(250).optional(),
});

/** Precio mínimo por unidad para no perder: el costo de la mercadería más el IGV que se cobra en la venta. */
export const precioMinimo = (costoUnitario: number) => r4(costoUnitario * 1.18);
/** El mínimo redondeado hacia arriba al céntimo: el precio más bajo que se puede escribir sin perder. */
export const minimoEnCentimos = (minimo: number) => Math.ceil(minimo * 100 - 1e-6) / 100;

export const esquemaRechazo = z.object({ comentario: texto(5, "escribe por qué la rechazas (mínimo 5 caracteres)").max(250) });

async function stockVigente(db: Db, ids: number[]) {
  const rows = await db.select({ productoId: lote.productoId, n: sql<number>`coalesce(sum(${lote.cantidad}),0)`.mapWith(Number) }).from(lote)
    .where(and(inArray(lote.productoId, ids), eq(lote.estado, "ACTIVO"), gt(lote.vencimiento, hoyLima()), gt(lote.cantidad, 0))).groupBy(lote.productoId);
  return new Map(rows.map((r) => [r.productoId, r.n]));
}

/** El personal registra qué sale, de qué lote y cuánto; el stock no se mueve hasta que el propietario aprueba con el precio. */
export async function registrarTransferencia(db: Db, user: Sesion, input: z.infer<typeof esquemaTransferencia>) {
  // El mismo producto y lote agregado dos veces se suma en una sola línea; sin lote, sale por FEFO.
  const lineas = new Map<string, { productoId: number; loteId: number | null; unidades: number }>();
  for (const it of input.items) {
    const k = `${it.productoId}:${it.loteId ?? ""}`;
    const l = lineas.get(k) ?? { productoId: it.productoId, loteId: it.loteId ?? null, unidades: 0 };
    l.unidades += it.unidades; lineas.set(k, l);
  }
  const ids = [...new Set([...lineas.values()].map((l) => l.productoId))];
  const prods = await db.select().from(producto).where(and(inArray(producto.id, ids), eq(producto.activo, true)));
  if (prods.length !== ids.length) throw new ErrorNegocio("PRODUCTO", "Uno de los productos no existe o está inactivo.");
  const nombre = new Map(prods.map((p) => [p.id, p.nombre]));
  const hoy = hoyLima();
  const loteIds = [...lineas.values()].flatMap((l) => (l.loteId ? [l.loteId] : []));
  const lotes = new Map((loteIds.length ? await db.select().from(lote).where(inArray(lote.id, loteIds)) : []).map((l) => [l.id, l]));
  const porLote = new Map<number, number>();
  for (const l of lineas.values()) if (l.loteId) porLote.set(l.loteId, (porLote.get(l.loteId) ?? 0) + l.unidades);
  for (const [loteId, pedidas] of porLote) {
    const l = lotes.get(loteId);
    const linea = [...lineas.values()].find((x) => x.loteId === loteId)!;
    if (!l || l.productoId !== linea.productoId) throw new ErrorNegocio("LOTE", `El lote elegido no pertenece a ${nombre.get(linea.productoId)}.`);
    if (l.estado !== "ACTIVO" || l.vencimiento <= hoy) throw new ErrorNegocio("LOTE_VENCIDO", `El lote ${l.numero} de ${nombre.get(l.productoId)} está vencido o bloqueado.`);
    if (pedidas > l.cantidad) throw new ErrorNegocio("STOCK_INSUFICIENTE", `${nombre.get(l.productoId)}, lote ${l.numero}: pides ${pedidas} unidades y tiene ${l.cantidad}.`, 409);
  }
  const stock = await stockVigente(db, ids);
  for (const p of prods) {
    const pedidas = [...lineas.values()].filter((l) => l.productoId === p.id).reduce((s, l) => s + l.unidades, 0);
    const hay = stock.get(p.id) ?? 0;
    if (pedidas > hay) throw new ErrorNegocio("STOCK_INSUFICIENTE", `${p.nombre}: pides ${pedidas} unidades y hay ${hay} vigentes.`, 409);
  }
  const enCampana = new Set((await db.select({ productoId: campana.productoId }).from(campana)
    .where(and(inArray(campana.productoId, ids), inArray(campana.estado, ["ACTIVA", "PROGRAMADA"]), sql`${campana.inicio} <= ${hoy}`, sql`${campana.fin} >= ${hoy}`))).map((c) => c.productoId));
  return db.transaction(async (tx) => {
    const numero = await siguienteNumero(tx, SERIE);
    const [t] = await tx.insert(transferencia).values({ serie: SERIE, numero, tipoDestino: input.tipoDestino, destino: input.destino, destinoTipoDoc: input.tipoDestino === "EMPRESA" ? input.destinoTipoDoc! : null, destinoDoc: input.tipoDestino === "EMPRESA" ? input.destinoDoc! : null, motivo: input.motivo, registradoPor: user.id }).returning();
    await tx.insert(transferenciaDetalle).values([...lineas.values()].map((l) => ({ transferenciaId: t.id, productoId: l.productoId, loteId: l.loteId, unidades: l.unidades, enCampana: enCampana.has(l.productoId) })));
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "REGISTRAR_TRANSFERENCIA", entidad: "transferencia", entidadId: t.id, detalle: { referencia: referencia(t), destino: t.destino, items: lineas.size } });
    return { id: t.id, referencia: referencia(t), estado: t.estado };
  });
}

/** Quien no aprueba ve solo las suyas y nunca precios ni costos. */
export async function listarTransferencias(db: Db, user: Sesion, estado?: string) {
  const aprueba = puede(user.roles, "transferencias.aprobar");
  const reg = usuario;
  const cond = [estado ? eq(transferencia.estado, estado) : undefined, aprueba ? undefined : eq(transferencia.registradoPor, user.id)].filter(Boolean);
  const rows = await db.select({ t: transferencia, registradoPor: reg.nombre }).from(transferencia).innerJoin(reg, eq(reg.id, transferencia.registradoPor))
    .where(cond.length ? and(...cond) : undefined).orderBy(desc(transferencia.id)).limit(100);
  const ids = rows.map((r) => r.t.id);
  const det = ids.length ? await db.select({
    d: transferenciaDetalle, producto: producto.nombre, codigo: producto.codigo, laboratorio: laboratorio.nombre, categoria: categoria.nombre,
    lote: lote.numero, vencimiento: lote.vencimiento, stockLote: lote.cantidad,
  }).from(transferenciaDetalle).innerJoin(producto, eq(producto.id, transferenciaDetalle.productoId)).leftJoin(lote, eq(lote.id, transferenciaDetalle.loteId))
    .leftJoin(laboratorio, eq(laboratorio.id, producto.laboratorioId)).leftJoin(categoria, eq(categoria.id, producto.categoriaId))
    .where(inArray(transferenciaDetalle.transferenciaId, ids)).orderBy(asc(transferenciaDetalle.id)) : [];
  const stock = det.length ? await stockVigente(db, [...new Set(det.map((x) => x.d.productoId))]) : new Map<number, number>();
  const decide = new Map((await db.select({ id: usuario.id, nombre: usuario.nombre }).from(usuario)).map((u) => [u.id, u.nombre]));
  const referencias = aprueba ? await preciosYCostosActuales(db, det.filter((x) => rows.find((r) => r.t.id === x.d.transferenciaId)?.t.estado === "PENDIENTE").map((x) => x.d)) : new Map<number, { precioActual: number | null; costoActual: number | null }>();
  const ventaIds = rows.flatMap((r) => (r.t.ventaId ? [r.t.ventaId] : []));
  const facturas = new Map((ventaIds.length ? await db.select({ id: venta.id, serie: venta.serie, numero: venta.numero }).from(venta).where(inArray(venta.id, ventaIds)) : [])
    .map((v) => [v.id, `${v.serie}-${String(v.numero).padStart(6, "0")}`]));
  return rows.map(({ t, registradoPor }) => ({
    id: t.id, referencia: referencia(t), tipoDestino: t.tipoDestino, destino: t.destino, destinoTipoDoc: t.destinoTipoDoc, destinoDoc: t.destinoDoc, motivo: t.motivo, estado: t.estado,
    registradoEn: t.registradoEn, registradoPor, registradoPorId: t.registradoPor,
    decididoPor: t.decididoPor ? decide.get(t.decididoPor) ?? null : null, decididoEn: t.decididoEn, comentario: t.comentario,
    vendedor: t.vendedorId ? decide.get(t.vendedorId) ?? null : null, ventaId: t.ventaId, factura: t.ventaId ? facturas.get(t.ventaId) ?? null : null,
    ...(aprueba ? { costoAdicional: t.costoAdicional, totalVenta: t.totalVenta, costoTotal: t.costoTotal, medioPago: t.medioPago } : {}),
    items: det.filter((x) => x.d.transferenciaId === t.id).map((x) => ({
      id: x.d.id, productoId: x.d.productoId, producto: x.producto, codigo: x.codigo, laboratorio: x.laboratorio, categoria: x.categoria, unidades: x.d.unidades,
      loteId: x.d.loteId, lote: x.lote, vencimiento: x.vencimiento,
      enCampana: x.d.enCampana, stockActual: x.d.loteId ? x.stockLote ?? 0 : stock.get(x.d.productoId) ?? 0,
      ...(aprueba ? { precioUnitario: x.d.precioUnitario, costoUnitario: x.d.costoUnitario, ...(referencias.get(x.d.id) ?? {}) } : {}),
    })),
  }));
}

/**
 * Para fijar el precio: el PVP por unidad de lista (sin descuentos) y el costo de la mercadería que saldría.
 * Con lote elegido es el costo de ese lote; en automático, el promedio de los lotes que tomaría el FEFO.
 */
async function preciosYCostosActuales(db: Db, det: (typeof transferenciaDetalle.$inferSelect)[]) {
  const out = new Map<number, { precioActual: number | null; costoActual: number | null }>();
  if (!det.length) return out;
  const ids = [...new Set(det.map((d) => d.productoId))];
  const pvp = new Map((await db.select({ productoId: presentacion.productoId, pvp: presentacion.pvp }).from(presentacion).where(and(inArray(presentacion.productoId, ids), eq(presentacion.factor, 1)))).map((p) => [p.productoId, p.pvp]));
  const lotes = await db.select().from(lote).where(and(inArray(lote.productoId, ids), eq(lote.estado, "ACTIVO"), gt(lote.vencimiento, hoyLima()), gt(lote.cantidad, 0))).orderBy(asc(lote.vencimiento), asc(lote.id));
  for (const d of det) {
    let costo: number | null = null;
    if (d.loteId) costo = lotes.find((l) => l.id === d.loteId)?.costoUnitario ?? null;
    else {
      let falta = d.unidades; let suma = 0; let tomadas = 0;
      for (const l of lotes.filter((x) => x.productoId === d.productoId)) {
        if (falta <= 0) break;
        const toma = Math.min(falta, l.cantidad); suma += toma * l.costoUnitario; tomadas += toma; falta -= toma;
      }
      costo = tomadas ? r4(suma / tomadas) : null;
    }
    out.set(d.id, { precioActual: pvp.get(d.productoId) ?? null, costoActual: costo });
  }
  return out;
}

async function pendiente(db: Db, transferenciaId: number) {
  const [t] = await db.select().from(transferencia).where(eq(transferencia.id, transferenciaId));
  if (!t) throw new ErrorNegocio("NO_EXISTE", "La transferencia no existe.", 404);
  if (t.estado !== "PENDIENTE") throw new ErrorNegocio("ESTADO", "Esta transferencia ya fue aprobada o rechazada.");
  return t;
}

/**
 * Aprobar descuenta el stock por lote (el elegido o FEFO) al costo de cada lote.
 * A otra farmacia es una venta: emite factura a su RUC, atribuida al vendedor elegido, sin comisión y fuera de caja.
 * A una sucursal propia es un traslado: no hay venta, sale a costo.
 */
export async function aprobarTransferencia(db: Db, user: Sesion, transferenciaId: number, input: z.input<typeof esquemaAprobacion>) {
  const t = await pendiente(db, transferenciaId);
  const esVenta = t.tipoDestino === "EMPRESA";
  const precios = new Map((input.precios ?? []).map((p) => [p.detalleId, p.precioUnitario]));
  if (esVenta) {
    if (!input.vendedorId) throw new ErrorNegocio("VENDEDOR", "Elige a quién se atribuye la venta.");
    if (!input.medioPago) throw new ErrorNegocio("MEDIO_PAGO", "Elige cómo pagó la farmacia.");
    const [v] = await db.select({ id: usuario.id }).from(usuario).where(and(eq(usuario.id, input.vendedorId), eq(usuario.activo, true)));
    if (!v) throw new ErrorNegocio("VENDEDOR", "El vendedor elegido no existe o está inactivo.");
  }
  const hoy = hoyLima();
  return db.transaction(async (tx) => {
    const det = await tx.select({ d: transferenciaDetalle, nombre: producto.nombre }).from(transferenciaDetalle).innerJoin(producto, eq(producto.id, transferenciaDetalle.productoId))
      .where(eq(transferenciaDetalle.transferenciaId, transferenciaId)).orderBy(asc(transferenciaDetalle.id));
    if (esVenta) for (const { d, nombre } of det) if (!precios.has(d.id)) throw new ErrorNegocio("FALTA_PRECIO", `Falta el precio de venta de ${nombre}.`);
    await bloquearProductos(tx, det.map((x) => x.d.productoId));
    // La venta se crea primero para que el kardex y el detalle apunten a la factura.
    const totalVenta = esVenta ? r2(det.reduce((s, x) => s + precios.get(x.d.id)! * x.d.unidades, 0)) : null;
    let ventaId: number | null = null;
    let docRef = referencia(t);
    if (esVenta) {
      // Con RUC se factura; una persona sin RUC compra con DNI y recibe boleta.
      const tipoComprobante = t.destinoTipoDoc === "DNI" ? "BOLETA" : "FACTURA";
      const [c] = await tx.insert(cliente).values({ tipoDoc: t.destinoTipoDoc ?? "RUC", numero: t.destinoDoc!, nombre: t.destino }).onConflictDoUpdate({ target: cliente.numero, set: { nombre: t.destino } }).returning({ id: cliente.id });
      const numero = await siguienteNumero(tx, SERIES[tipoComprobante]);
      const subtotal = r2(totalVenta! / 1.18);
      const [v] = await tx.insert(venta).values({ sesionId: null, usuarioId: input.vendedorId!, canal: "TRANSFERENCIA", clienteId: c.id, tipoComprobante, serie: SERIES[tipoComprobante], numero, subtotal, igv: r2(totalVenta! - subtotal), total: totalVenta!, cpeEstado: "PENDIENTE" }).returning();
      await tx.insert(ventaPago).values({ ventaId: v.id, medio: input.medioPago!, monto: totalVenta! });
      ventaId = v.id; docRef = `${v.serie}-${String(v.numero).padStart(6, "0")}`;
    }
    const unidadDe = new Map((await tx.select().from(presentacion).where(and(inArray(presentacion.productoId, det.map((x) => x.d.productoId)), eq(presentacion.factor, 1)))).map((p) => [p.productoId, p.id]));
    let costoTotal = 0;
    const bajoCosto: { producto: string; precio: number; minimo: number; perdida: number }[] = [];
    for (const { d, nombre } of det) {
      const asign = await asignarFEFO(tx, d.productoId, d.unidades, hoy, d.loteId).catch((e) => {
        throw e instanceof ErrorNegocio && e.codigo === "STOCK_INSUFICIENTE" ? new ErrorNegocio("STOCK_INSUFICIENTE", `${nombre}: ${e.message}`, 409) : e;
      });
      const precio = precios.get(d.id) ?? null;
      let costo = 0; let restante = precio !== null ? r2(precio * d.unidades) : 0;
      for (const [i, a] of asign.entries()) {
        costo += a.unidades * a.costoUnitario;
        await registrarKardex(tx, { productoId: d.productoId, loteId: a.loteId, tipo: "TRANSFERENCIA", motivo: `${referencia(t)} · ${t.destino}`, documentoTipo: esVenta ? "FACTURA" : "TRASLADO", documentoId: ventaId ?? t.id, documentoRef: docRef, salida: a.unidades, costoUnitario: a.costoUnitario, usuarioId: user.id });
        if (ventaId && precio !== null) {
          const pres = unidadDe.get(d.productoId);
          if (!pres) throw new ErrorNegocio("PRESENTACION", `${nombre} no tiene presentación por unidad para facturar.`);
          const parte = i === asign.length - 1 ? restante : r2(precio * a.unidades);
          restante = r2(restante - parte);
          await tx.insert(ventaDetalle).values({ ventaId, productoId: d.productoId, presentacionId: pres, loteId: a.loteId, cantidad: a.unidades, unidades: a.unidades, precioUnitario: precio, descuento: 0, subtotal: parte, costoUnitario: a.costoUnitario, origen: "DIRECTA" });
        }
      }
      costoTotal += costo;
      if (precio !== null && d.unidades > 0) {
        const minimo = precioMinimo(costo / d.unidades);
        if (precio < minimo - 0.00005) bajoCosto.push({ producto: nombre, precio, minimo, perdida: r2((minimo - precio) / 1.18 * d.unidades) });
      }
      await tx.update(transferenciaDetalle).set({ precioUnitario: precio, costoUnitario: r4(costo / d.unidades) }).where(eq(transferenciaDetalle.id, d.id));
    }
    // Regla de negocio: nadie vende bajo costo por descuido. Solo el administrador, a propósito y con motivo.
    const motivoBajoCosto = input.motivoBajoCosto?.trim() || null;
    if (bajoCosto.length) {
      const lista = bajoCosto.map((b) => `${b.producto} (mínimo S/ ${minimoEnCentimos(b.minimo).toFixed(2)})`).join(", ");
      if (!tieneRol(user.roles, "ADMIN")) throw new ErrorNegocio("BAJO_COSTO", `Solo el administrador puede vender por debajo del costo: ${lista}.`, 403);
      if (!motivoBajoCosto || motivoBajoCosto.length < 5) throw new ErrorNegocio("BAJO_COSTO", `El precio queda por debajo del costo en: ${lista}. Si lo vendes así a propósito, escribe el motivo.`, 422);
    }
    if (ventaId) await tx.update(venta).set({ costoTotal: r2(costoTotal) }).where(eq(venta.id, ventaId));
    // Otro administrador pudo aprobarla al mismo tiempo: solo una de las dos aprobaciones aplica.
    const hecho = await tx.update(transferencia).set({
      estado: "APROBADA", decididoPor: user.id, decididoEn: new Date(),
      comentario: bajoCosto.length ? [input.comentario, `Venta bajo costo: ${motivoBajoCosto}`].filter(Boolean).join(" · ").slice(0, 500) : input.comentario || null, costoAdicional: input.costoAdicional ?? 0,
      totalVenta, costoTotal: r2(costoTotal), vendedorId: esVenta ? input.vendedorId! : null, medioPago: esVenta ? input.medioPago! : null, ventaId,
    }).where(and(eq(transferencia.id, t.id), eq(transferencia.estado, "PENDIENTE"))).returning({ id: transferencia.id });
    if (!hecho.length) throw new ErrorNegocio("ESTADO", "Esta transferencia ya fue aprobada o rechazada.");
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "APROBAR_TRANSFERENCIA", entidad: "transferencia", entidadId: t.id, detalle: { referencia: referencia(t), tipo: t.tipoDestino, factura: esVenta ? docRef : null, vendedorId: input.vendedorId ?? null, totalVenta, costoAdicional: input.costoAdicional ?? 0, ...(bajoCosto.length ? { bajoCosto, motivoBajoCosto } : {}) } });
    return { id: t.id, referencia: referencia(t), estado: "APROBADA", ventaId, factura: esVenta ? docRef : null, comprobante: esVenta ? (t.destinoTipoDoc === "DNI" ? "BOLETA" : "FACTURA") : null, totalVenta, costoTotal: r2(costoTotal) };
  });
}

export async function rechazarTransferencia(db: Db, user: Sesion, transferenciaId: number, input: z.infer<typeof esquemaRechazo>) {
  const t = await pendiente(db, transferenciaId);
  await db.transaction(async (tx) => {
    const hecho = await tx.update(transferencia).set({ estado: "RECHAZADA", decididoPor: user.id, decididoEn: new Date(), comentario: input.comentario })
      .where(and(eq(transferencia.id, t.id), eq(transferencia.estado, "PENDIENTE"))).returning({ id: transferencia.id });
    if (!hecho.length) throw new ErrorNegocio("ESTADO", "Esta transferencia ya fue aprobada o rechazada.");
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: "RECHAZAR_TRANSFERENCIA", entidad: "transferencia", entidadId: t.id, detalle: { referencia: referencia(t), comentario: input.comentario } });
  });
  return { id: t.id, referencia: referencia(t), estado: "RECHAZADA" };
}
