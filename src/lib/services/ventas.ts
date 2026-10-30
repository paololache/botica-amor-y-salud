import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { ErrorNegocio, hoy as hoyLima, inicioDiaLima, MEDIOS, r2, sumarDias } from "../util";
import { asignarFEFO, bloquearProductos, registrarKardex, sumarLote } from "./inventario";
import { campanaActiva } from "./campanas";
import { revertirComisionesVenta, misComisiones } from "./comisiones";
import { sesionDelUsuario } from "./caja";
import { parametros } from "./parametros";
import { enviarCpe } from "./sunat";

const { venta, ventaDetalle, ventaPago, presentacion, producto, correlativo, cliente, comision, usuario, auditoria, lote } = schema;

export const SERIES = { BOLETA: "B001", FACTURA: "F001", NOTA_VENTA: "NV01" } as const;

export const esquemaVenta = z.object({
  items: z.array(z.object({
    presentacionId: z.number().int(),
    cantidad: z.number().int().positive(),
    descuentoPct: z.number().min(0).max(100).default(0),
    origen: z.enum(["DIRECTA", "SUGERENCIA"]).default("DIRECTA"),
  })).min(1).max(60),
  tipoComprobante: z.enum(["BOLETA", "FACTURA", "NOTA_VENTA"]),
  cliente: z.object({ tipoDoc: z.enum(["DNI", "RUC"]), numero: z.string(), nombre: z.string().min(2) }).optional(),
  pagos: z.array(z.object({ medio: z.enum(MEDIOS), monto: z.number().positive() })).min(1),
  receta: z.object({ medico: z.string().min(3), cmp: z.string().min(3), numero: z.string().min(1) }).optional(),
  autorizacion: z.object({ login: z.string(), password: z.string() }).optional(),
});
export type EntradaVenta = z.infer<typeof esquemaVenta>;

async function siguienteNumero(tx: Db, serie: string): Promise<number> {
  const [r] = await tx.insert(correlativo).values({ serie, ultimo: 1 })
    .onConflictDoUpdate({ target: correlativo.serie, set: { ultimo: sql`${correlativo.ultimo} + 1` } })
    .returning({ ultimo: correlativo.ultimo });
  return r.ultimo;
}

export async function crearVenta(db: Db, user: Sesion, input: EntradaVenta) {
  const hoy = hoyLima();
  const p = await parametros(db);
  const sesion = await sesionDelUsuario(db, user.id);
  if (!sesion || sesion.estado !== "ABIERTA") throw new ErrorNegocio("SIN_CAJA", "Abre tu caja para poder vender (RN-01).");

  const presIds = input.items.map((i) => i.presentacionId);
  const pres = await db.select({ p: presentacion, prod: producto }).from(presentacion).innerJoin(producto, eq(producto.id, presentacion.productoId))
    .where(inArray(presentacion.id, presIds));
  const mapa = new Map(pres.map((x) => [x.p.id, x]));

  let total = 0, descuento = 0;
  let requiereAutorizacion = false, requiereReceta = false;
  const lineas = input.items.map((it) => {
    const x = mapa.get(it.presentacionId);
    if (!x || !x.p.activo || !x.prod.activo) throw new ErrorNegocio("PRODUCTO_INVALIDO", "Uno de los productos ya no está disponible.");
    if (it.descuentoPct > p.descuento_max_pct) requiereAutorizacion = true;
    if (x.prod.condicionVenta !== "LIBRE") requiereReceta = true;
    const bruto = r2(x.p.pvp * it.cantidad);
    const desc = r2(bruto * it.descuentoPct / 100);
    total += bruto - desc; descuento += desc;
    return { ...it, pres: x.p, prod: x.prod, unidades: it.cantidad * x.p.factor, bruto, desc, subtotal: r2(bruto - desc) };
  });
  total = r2(total); descuento = r2(descuento);

  if (requiereAutorizacion && user.rol !== "ADMIN") {
    if (!input.autorizacion) throw new ErrorNegocio("REQUIERE_AUTORIZACION", `El descuento supera el ${p.descuento_max_pct}% permitido. Pide la clave de un supervisor.`, 422);
    const [a] = await db.select().from(usuario).where(eq(usuario.login, input.autorizacion.login));
    if (!a || a.rol !== "ADMIN" || !(await bcrypt.compare(input.autorizacion.password, a.passwordHash))) throw new ErrorNegocio("CREDENCIALES", "La clave del supervisor no es correcta.", 401);
  }
  if (requiereReceta && !input.receta) throw new ErrorNegocio("REQUIERE_RECETA", "Esta venta incluye un producto con receta: registra médico, CMP y número de receta (RN-03).", 422);
  if (input.tipoComprobante === "FACTURA" && !(input.cliente?.tipoDoc === "RUC" && /^(10|20)\d{9}$/.test(input.cliente.numero)))
    throw new ErrorNegocio("RUC_INVALIDO", "La factura exige un RUC válido de 11 dígitos (RN-04).", 422);
  if (input.tipoComprobante === "BOLETA" && total > p.boleta_dni_desde && !(input.cliente?.tipoDoc === "DNI" && /^\d{8}$/.test(input.cliente.numero)))
    throw new ErrorNegocio("DNI_REQUERIDO", `Una boleta mayor a S/ ${p.boleta_dni_desde.toFixed(2)} exige el DNI del cliente (RN-04).`, 422);

  const pagado = r2(input.pagos.reduce((s, x) => s + x.monto, 0));
  const noEfectivo = r2(input.pagos.filter((x) => x.medio !== "EFECTIVO").reduce((s, x) => s + x.monto, 0));
  if (pagado < total) throw new ErrorNegocio("PAGO_INCOMPLETO", `Falta cobrar S/ ${(total - pagado).toFixed(2)}.`, 422);
  if (noEfectivo > total) throw new ErrorNegocio("PAGO_EXCEDE", "Los pagos con Yape, Plin, tarjeta o transferencia no pueden superar el total.", 422);
  const vuelto = r2(pagado - total);
  const pagos = input.pagos.map((x) => ({ ...x })).filter((x) => x.monto > 0);
  const ef = pagos.find((x) => x.medio === "EFECTIVO");
  if (ef) ef.monto = r2(ef.monto - vuelto);

  const resultado = await db.transaction(async (tx) => {
    await bloquearProductos(tx, lineas.map((l) => l.prod.id));
    const serie = SERIES[input.tipoComprobante];
    const numero = await siguienteNumero(tx, serie);
    let clienteId: number | null = null;
    if (input.cliente) {
      const [c] = await tx.insert(cliente).values(input.cliente).onConflictDoUpdate({ target: cliente.numero, set: { nombre: input.cliente.nombre } }).returning({ id: cliente.id });
      clienteId = c.id;
    }
    const subtotal = r2(total / 1.18);
    const [v] = await tx.insert(venta).values({
      sesionId: sesion.id, usuarioId: user.id, clienteId, tipoComprobante: input.tipoComprobante, serie, numero,
      subtotal, igv: r2(total - subtotal), descuento, total, receta: input.receta ?? null, cpeEstado: "PENDIENTE",
    }).returning();
    const ref = `${serie}-${String(numero).padStart(6, "0")}`;
    let costoTotal = 0, comisionVenta = 0;
    for (const l of lineas) {
      const asign = await asignarFEFO(tx, l.prod.id, l.unidades, hoy);
      let restante = l.subtotal;
      for (let i = 0; i < asign.length; i++) {
        const a = asign[i];
        const parte = i === asign.length - 1 ? r2(restante) : r2(l.subtotal * a.unidades / l.unidades);
        restante = r2(restante - parte);
        const costoU = l.prod.costoPromedio;
        costoTotal += costoU * a.unidades;
        const [d] = await tx.insert(ventaDetalle).values({
          ventaId: v.id, productoId: l.prod.id, presentacionId: l.pres.id, loteId: a.loteId, cantidad: a.unidades / l.pres.factor, unidades: a.unidades,
          precioUnitario: l.pres.pvp, descuento: r2(l.desc * a.unidades / l.unidades), subtotal: parte, costoUnitario: costoU, origen: l.origen,
        }).returning({ id: ventaDetalle.id });
        await registrarKardex(tx, { productoId: l.prod.id, loteId: a.loteId, tipo: "VENTA", documentoTipo: input.tipoComprobante, documentoId: v.id, documentoRef: ref, salida: a.unidades, costoUnitario: costoU, usuarioId: user.id });
        const camp = await campanaActiva(tx, l.prod.id, a.loteId, hoy);
        if (camp) {
          const base = r2(parte / 1.18);
          const monto = r2(base * camp.porcentaje / 100);
          comisionVenta += monto;
          await tx.insert(comision).values({ ventaId: v.id, ventaDetalleId: d.id, usuarioId: user.id, campanaId: camp.id, porcentaje: camp.porcentaje, base, monto, origen: l.origen, fecha: hoy });
        }
      }
    }
    await tx.update(venta).set({ costoTotal: r2(costoTotal) }).where(eq(venta.id, v.id));
    await tx.insert(ventaPago).values(pagos.map((x) => ({ ventaId: v.id, medio: x.medio, monto: r2(x.monto) })));
    return { id: v.id, serie, numero, ref, total, subtotal, igv: r2(total - subtotal), vuelto, comisionVenta: r2(comisionVenta), tipoComprobante: input.tipoComprobante };
  });

  const cpeEstado = await enviarCpe(input.tipoComprobante);
  await db.update(venta).set({ cpeEstado }).where(eq(venta.id, resultado.id));
  const mias = await misComisiones(db, user.id);
  return { ...resultado, cpeEstado, comisionHoy: mias.hoy, comisionMes: mias.mes };
}

export const esquemaAnulacion = z.object({ motivo: z.string().min(5) });

/** Mismo día: anulación (comunicación de baja). Días posteriores: nota de crédito. Ambas devuelven el stock al lote original (RN-06). */
export async function anularVenta(db: Db, user: Sesion, ventaId: number, input: z.infer<typeof esquemaAnulacion>) {
  const [v] = await db.select().from(venta).where(eq(venta.id, ventaId));
  if (!v) throw new ErrorNegocio("NO_EXISTE", "La venta no existe.", 404);
  if (v.estado === "ANULADA") throw new ErrorNegocio("YA_ANULADA", "La venta ya fue anulada.");
  const modo = hoyLima(v.fecha) === hoyLima() ? "ANULACION" : "NOTA_CREDITO";
  await db.transaction(async (tx) => {
    const det = await tx.select().from(ventaDetalle).where(eq(ventaDetalle.ventaId, ventaId));
    await bloquearProductos(tx, det.map((d) => d.productoId));
    for (const d of det) {
      await sumarLote(tx, d.loteId, d.unidades);
      await registrarKardex(tx, { productoId: d.productoId, loteId: d.loteId, tipo: "ANULACION_VENTA", motivo: modo, documentoTipo: modo, documentoId: v.id, documentoRef: `${v.serie}-${String(v.numero).padStart(6, "0")}`, entrada: d.unidades, costoUnitario: d.costoUnitario, usuarioId: user.id });
    }
    await tx.update(venta).set({ estado: "ANULADA", anuladaPor: user.id, anuladaEn: new Date() }).where(eq(venta.id, ventaId));
    await revertirComisionesVenta(tx, ventaId, user.id);
    await tx.insert(auditoria).values({ usuarioId: user.id, accion: modo, entidad: "venta", entidadId: ventaId, detalle: { motivo: input.motivo, total: v.total } });
  });
  return { id: ventaId, estado: "ANULADA", modo };
}

export async function listarVentas(db: Db, user: Sesion, dias = 7) {
  const desde = inicioDiaLima(sumarDias(hoyLima(), -dias + 1));
  const cond = [gte(venta.fecha, desde)];
  if (!["ADMIN", "CONTADOR"].includes(user.rol)) cond.push(eq(venta.usuarioId, user.id));
  return db.select({
    id: venta.id, serie: venta.serie, numero: venta.numero, fecha: venta.fecha, tipo: venta.tipoComprobante, total: venta.total, costoTotal: venta.costoTotal,
    estado: venta.estado, cpeEstado: venta.cpeEstado, vendedor: usuario.nombre, cliente: cliente.nombre,
  }).from(venta).innerJoin(usuario, eq(usuario.id, venta.usuarioId)).leftJoin(cliente, eq(cliente.id, venta.clienteId))
    .where(and(...cond)).orderBy(desc(venta.id)).limit(300);
}

export async function detalleVenta(db: Db, id: number) {
  const [v] = await db.select().from(venta).where(eq(venta.id, id));
  if (!v) throw new ErrorNegocio("NO_EXISTE", "La venta no existe.", 404);
  const items = await db.select({ producto: producto.nombre, presentacion: presentacion.nombre, lote: lote.numero, vencimiento: lote.vencimiento, cantidad: ventaDetalle.cantidad, precio: ventaDetalle.precioUnitario, subtotal: ventaDetalle.subtotal, costoUnitario: ventaDetalle.costoUnitario })
    .from(ventaDetalle).innerJoin(producto, eq(producto.id, ventaDetalle.productoId)).innerJoin(presentacion, eq(presentacion.id, ventaDetalle.presentacionId)).innerJoin(lote, eq(lote.id, ventaDetalle.loteId))
    .where(eq(ventaDetalle.ventaId, id));
  const pagos = await db.select().from(ventaPago).where(eq(ventaPago.ventaId, id));
  const [cli] = v.clienteId ? await db.select().from(cliente).where(eq(cliente.id, v.clienteId)) : [];
  const [vend] = await db.select({ nombre: usuario.nombre }).from(usuario).where(eq(usuario.id, v.usuarioId));
  return { venta: v, items, pagos, cliente: cli ?? null, vendedor: vend?.nombre ?? null };
}

export async function reenviarPendientes(db: Db) {
  const limite = new Date(Date.now() - 60 * 1000);
  const pend = await db.select({ id: venta.id, tipo: venta.tipoComprobante }).from(venta).where(and(inArray(venta.cpeEstado, ["PENDIENTE", "RECHAZADO"]), lt(venta.fecha, limite))).limit(200);
  let aceptados = 0;
  for (const p of pend) {
    const e = await enviarCpe(p.tipo);
    await db.update(venta).set({ cpeEstado: e }).where(eq(venta.id, p.id));
    if (e === "ACEPTADO") aceptados++;
  }
  return { revisados: pend.length, aceptados };
}
