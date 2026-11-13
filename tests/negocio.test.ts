import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { listarCargos, pagarCargo, regularizarEfectivo, esquemaRegularizacionEfectivo } from "@/lib/services/caja";
import { abrirCaja, cerrarCaja, calcularEsperado, esquemaApertura, esquemaCierre, esquemaRegularizacion, esquemaValidacion, estadoCaja, listarSesiones, pagosVirtuales, regularizarPago, registrarMovimiento as movimientoDeCaja, reporteCierre, validarCierre } from "@/lib/services/caja";
import { crearVenta, anularVenta } from "@/lib/services/ventas";
import { crearCampana, alternarCampana, campanasVigentes, recordatorioCampanas } from "@/lib/services/campanas";
import { consolidarHasta, misComisiones, cerrarMes, detalleVendedor, resumenMes, esquemaHistoricoComisiones, historicoComisiones } from "@/lib/services/comisiones";
import { registrarRecepcion, anularCompra, costearCompra, corregirCostoCompra, datosCorreccion, esquemaCorreccion, esquemaRecepcion, listarCompras } from "@/lib/services/compras";
import { registrarMovimiento, decidirMovimiento, listarMovimientos } from "@/lib/services/salidas";
import { evaluarAlertas, alertasDelRol } from "@/lib/services/alertas";
import { ejecutarReporte, crearMetrica, reporteEspecial } from "@/lib/services/reportes";
import { buscarProductos, crearProducto, editarProducto, esquemaProducto, fichaProducto, listarStock, masVendidos } from "@/lib/services/productos";
import { crearLaboratorio, eliminarLaboratorio, listarLaboratorios, renombrarLaboratorio, unificarLaboratorios } from "@/lib/services/laboratorios";
import bcrypt from "bcryptjs";
import { enmascarar, MODULOS, moduloDeRuta, puede, tieneRol, verCostos, type Rol } from "@/lib/permisos";
import { firmarSesion, leerSesion } from "@/lib/auth";
import { crearUsuario, editarUsuario, eliminarUsuario, esquemaNuevoUsuario } from "@/lib/services/usuarios";
import { esquemaHistorico, historicoVentas, panel } from "@/lib/services/panel";
import { accesosFrecuentes, registrarUso } from "@/lib/services/accesos";
import { filas } from "@/lib/sqlrows";
import { avanceDelMes, cumplimientoCuotas, esquemaMetasMes, guardarMetasMes, metaDelDia, metasDelMes } from "@/lib/services/metas";
import { mensajeMotivacional } from "@/lib/motivacion";
import { aprobarTransferencia, esquemaTransferencia, listarTransferencias, rechazarTransferencia, registrarTransferencia } from "@/lib/services/transferencias";
import { detalleVenta, listarVentas } from "@/lib/services/ventas";
import { evaluar, validarFormula } from "@/lib/formula";
import { claveLaboratorio, hoy, esIdValido, limpiarNumero, precioSugerido, r4, sumarDias } from "@/lib/util";
import { base, preparar } from "./fixture";
import { enviarCpe, estadoInicialCpe } from "@/lib/services/sunat";

let db: Db;
let F: Awaited<ReturnType<typeof base>>;

/** El primer lote vigente del producto (el que vence antes) con al menos esas unidades: las transferencias salen de un lote elegido. */
const loteVigente = async (productoId: number, minimo = 1) => {
  const ls = (await db.select().from(schema.lote).where(eq(schema.lote.productoId, productoId)))
    .filter((l) => l.estado === "ACTIVO" && l.vencimiento > hoy() && l.cantidad >= minimo).sort((a, b) => (a.vencimiento < b.vencimiento ? -1 : a.vencimiento > b.vencimiento ? 1 : a.id - b.id));
  if (!ls.length) throw new Error(`sin lote vigente con ${minimo} unidades`);
  return ls[0];
};

beforeAll(async () => {
  db = await preparar();
  F = await base(db);
  await abrirCaja(db, F.caja1, { turno: "MAÑANA", monto: 150 });
});

describe("Fórmulas de métricas", () => {
  it("respeta precedencia y paréntesis", () => {
    expect(evaluar("(ventas - costo) / ventas * 100", { ventas: 200, costo: 150 })).toBe(25);
    expect(evaluar("-a + 3", { a: 1 })).toBe(2);
  });
  it("división por cero devuelve vacío", () => expect(evaluar("a / b", { a: 1, b: 0 })).toBeNull());
  it("rechaza métricas desconocidas", () => expect(() => validarFormula("ventas / foo", ["ventas"])).toThrow(/foo/));
});

describe("Visibilidad de costos (RN-13)", () => {
  it("quita costos para cajero y QF, los deja al administrador", () => {
    const dato = { nombre: "X", pvp: 5, costoPromedio: 3, lotes: [{ costoUnitario: 2, cantidad: 1 }] };
    expect(enmascarar(dato, ["CAJERO"])).toEqual({ nombre: "X", pvp: 5, lotes: [{ cantidad: 1 }] });
    expect(enmascarar(dato, ["QF"])).not.toHaveProperty("costoPromedio");
    expect(enmascarar(dato, ["ADMIN"])).toEqual(dato);
  });
});

describe("Venta con FEFO, campañas y comisiones", () => {
  it("no vende sin caja abierta (RN-01)", async () => {
    await expect(crearVenta(db, F.caja2, { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 20 }] })).rejects.toThrow(/caja/);
  });
  it("no crea campaña para un producto sin kardex (RN-19)", async () => {
    await expect(crearCampana(db, F.admin, { codigo: "222", nombre: "Amox promo", porcentaje: 5, inicio: hoy(), fin: sumarDias(hoy(), 10) })).rejects.toThrow(/kardex/);
  });
  it("descuenta primero el lote que vence antes y nunca el vencido", async () => {
    await crearCampana(db, F.admin, { codigo: "111", nombre: "Vitamina C noviembre", porcentaje: 5, inicio: hoy(), fin: sumarDias(hoy(), 30) });
    await expect(crearCampana(db, F.admin, { codigo: "111", nombre: "Otra", porcentaje: 3, inicio: hoy(), fin: sumarDias(hoy(), 5) })).rejects.toThrow(/ya tiene/);
    const v = await crearVenta(db, F.caja1, { items: [{ presentacionId: F.pres.id, cantidad: 4, descuentoPct: 0, origen: "SUGERENCIA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 100 }] });
    expect(v.total).toBe(72);
    expect(v.vuelto).toBe(28);
    const lotes = await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id));
    const q = Object.fromEntries(lotes.map((l) => [l.numero, l.cantidad]));
    expect(q).toEqual({ VENCIDO: 5, PROXIMO: 0, LEJANO: 9 });
    // comisión = 5% × 72 / 1.18
    expect(v.comisionVenta).toBeCloseTo(3.05, 2);
    const k = await db.select().from(schema.kardex).where(eq(schema.kardex.tipo, "VENTA"));
    expect(k.map((x) => x.salida)).toEqual([3, 1]);
    expect(k[1].saldoUnidades).toBe(14);
  });
  it("pausar la campaña desde el stock detiene la comisión", async () => {
    const r = await alternarCampana(db, F.admin, F.vit.id);
    expect(r.estado).toBe("PAUSADA");
    const v = await crearVenta(db, F.caja1, { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "YAPE", monto: 18 }] });
    expect(v.comisionVenta).toBe(0);
    await alternarCampana(db, F.admin, F.vit.id);
  });
  it("vende sin pedir receta y bloquea stock insuficiente", async () => {
    const conReceta = await crearVenta(db, F.caja1, { items: [{ presentacionId: F.presAmox.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 6 }] });
    expect(conReceta.total).toBe(6);
    await anularVenta(db, F.admin, conReceta.id, { motivo: "Prueba de venta sin receta" });
    await expect(crearVenta(db, F.caja1, { items: [{ presentacionId: F.pres.id, cantidad: 50, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 900 }], cliente: { tipoDoc: "DNI", numero: "12345678", nombre: "Cliente" } })).rejects.toThrow(/insuficiente/);
  });
  it("ventas simultáneas nunca dejan stock negativo", async () => {
    const intento = () => crearVenta(db, F.caja1, { items: [{ presentacionId: F.pres.id, cantidad: 3, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 54 }] });
    const r = await Promise.allSettled([intento(), intento(), intento(), intento()]);
    const ok = r.filter((x) => x.status === "fulfilled").length;
    const [l] = await db.select().from(schema.lote).where(eq(schema.lote.numero, "LEJANO"));
    expect(ok).toBe(2);
    expect(l.cantidad).toBe(2);
  });
  it("anular devuelve el stock al lote y revierte la comisión (RN-06, RN-15)", async () => {
    const antes = await misComisiones(db, F.caja1.id);
    const [v] = await db.select().from(schema.venta).orderBy(schema.venta.id).limit(1);
    await anularVenta(db, F.admin, v.id, { motivo: "Cliente devolvió el producto" });
    const despues = await misComisiones(db, F.caja1.id);
    expect(despues.hoy).toBeCloseTo(antes.hoy - 3.05, 2);
    const [p] = await db.select().from(schema.lote).where(eq(schema.lote.numero, "PROXIMO"));
    expect(p.cantidad).toBe(3);
  });
});

describe("Cierre de caja", () => {
  it("el cajero declara el efectivo, valida los pagos virtuales y queda la diferencia", async () => {
    const sesionId = (await db.select().from(schema.sesionCaja))[0].id;
    const esp = await calcularEsperado(db, sesionId);
    expect(esp.EFECTIVO).toBe(150 + 54 * 2);
    expect(esp.YAPE).toBe(18);
    const virtuales = await pagosVirtuales(db, sesionId);
    expect(virtuales.map((v) => [v.medio, v.monto])).toEqual([["YAPE", 18]]);
    expect(esquemaCierre.safeParse({ noCuadran: {} }).success).toBe(false);
    // El Yape no llegó: el cajero solo marca ese pago y escribe 0.
    const r = await cerrarCaja(db, F.caja1, { efectivo: esp.EFECTIVO - 2, noCuadran: { [virtuales[0].clave]: 0 } });
    expect(r).toMatchObject({ estado: "EN_CIERRE", requiereValidacion: true, diferencia: -20, efectivo: { sistema: esp.EFECTIVO, declarado: esp.EFECTIVO - 2 }, virtual: { sistema: 18, declarado: 0, noCuadran: 1 } });
    const [s] = await db.select().from(schema.sesionCaja).where(eq(schema.sesionCaja.id, r.sesionId));
    expect(r.observaciones).toEqual(["Faltante de S/ 20.00 (tolerancia S/ 5.00)", `${virtuales[0].referencia} · Yape: no llegó (S/ 18.00)`]);
    expect(s).toMatchObject({ estado: "EN_CIERRE", diferencia: -20, retiro: esp.EFECTIVO - 2, pagosNoConfirmados: [virtuales[0].clave] });
    const rep = await reporteCierre(db, F.admin, r.sesionId);
    expect(rep).toMatchObject({ saldoEfectivo: esp.EFECTIVO - 2, saldoVirtual: 0, diferencia: -20 });
    expect(rep.virtuales[0].confirmado).toBe(false);
    const ventas = rep.transacciones.filter((t) => t.ventaId);
    expect(ventas.length).toBeGreaterThan(0);
    for (const t of ventas) { expect(t.pagos.length).toBeGreaterThan(0); expect(t.usuario).toBeTruthy(); expect(["BOLETA", "FACTURA", "NOTA_VENTA"]).toContain(t.tipo); }
    expect(ventas.every((t) => "ganancia" in t)).toBe(true);
    expect(typeof rep.ganancia).toBe("number");
    const delCajero = await reporteCierre(db, F.caja1, r.sesionId);
    expect(delCajero.transacciones.some((t) => "ganancia" in t)).toBe(false);
    expect(delCajero).not.toHaveProperty("ganancia");
    expect(delCajero).not.toHaveProperty("costoVentas");
    expect(delCajero).not.toHaveProperty("margen");
    const idVenta = ventas[0].ventaId!;
    const comp = await detalleVenta(db, idVenta, F.caja1);
    expect(comp.venta).not.toHaveProperty("costoTotal");
    expect(comp.items.every((i) => !("costoUnitario" in i))).toBe(true);
    expect((await detalleVenta(db, idVenta, F.admin)).venta).toHaveProperty("costoTotal");
    expect((await listarVentas(db, F.caja1)).some((v) => "costoTotal" in v)).toBe(false);
    expect((await listarVentas(db, F.admin))[0]).toHaveProperty("costoTotal");
    const fila = (await listarSesiones(db, F.admin)).find((x) => x.id === r.sesionId)!;
    expect(fila).toMatchObject({ cajero: expect.any(String), saldoEfectivo: esp.EFECTIVO - 2, saldoVirtual: 0, diferencia: -20 });
    expect(fila.abiertaEn).toBeTruthy();
  });
  it("un cierre antiguo que quedó por validar lo valida otro administrador", async () => {
    const [s] = await db.select().from(schema.sesionCaja).orderBy(schema.sesionCaja.id).limit(1);
    await db.update(schema.sesionCaja).set({ estado: "EN_CIERRE", cerradaEn: null }).where(eq(schema.sesionCaja.id, s.id));
    await expect(validarCierre(db, F.caja1, { sesionId: s.id, observacion: "faltante" })).rejects.toThrow();
    const ok = await validarCierre(db, F.admin, { sesionId: s.id, observacion: "Revisado con el cajero" });
    expect(ok.estado).toBe("CERRADA");
  });
});

describe("Compra en dos pasos y salidas", () => {
  it("la recepción no mueve stock hasta que el administrador registra el costo", async () => {
    const r = await registrarRecepcion(db, F.almacen, { proveedor: { ruc: "20100000011", razonSocial: "Droguería" }, tipoComprobante: "FACTURA", serie: "F001", numero: "77", fechaEmision: hoy(), items: [{ presentacionId: F.pres.id, cantidad: 10, numeroLote: "NUEVO", vencimiento: sumarDias(hoy(), 500) }] });
    const [{ s: antes }] = await db.select({ s: sql<number>`sum(cantidad)`.mapWith(Number) }).from(schema.lote).where(eq(schema.lote.productoId, F.vit.id));
    await expect(registrarRecepcion(db, F.almacen, { proveedor: { ruc: "20100000011", razonSocial: "Droguería" }, tipoComprobante: "FACTURA", serie: "F001", numero: "77", fechaEmision: hoy(), items: [{ presentacionId: F.pres.id, cantidad: 1, numeroLote: "X", vencimiento: sumarDias(hoy(), 500) }] })).rejects.toThrow(/ya está registrado/);
    await expect(costearCompra(db, F.admin, r.id, { costos: [{ detalleId: (await db.select().from(schema.compraDetalle))[0].id, costoPresentacion: 14 }] })).rejects.toThrow(/varía/);
    const c = await costearCompra(db, F.admin, r.id, { costos: [{ detalleId: (await db.select().from(schema.compraDetalle))[0].id, costoPresentacion: 14 }], confirmarVariacion: true });
    expect(c.estado).toBe("CONFIRMADA");
    const [{ s: despues }] = await db.select({ s: sql<number>`sum(cantidad)`.mapWith(Number) }).from(schema.lote).where(eq(schema.lote.productoId, F.vit.id));
    expect(despues - antes).toBe(10);
    const [p] = await db.select().from(schema.producto).where(eq(schema.producto.id, F.vit.id));
    expect(p.costoPromedio).toBeGreaterThan(10);
    const [det] = await db.select({ factor: schema.presentacion.factor }).from(schema.compraDetalle).innerJoin(schema.presentacion, eq(schema.presentacion.id, schema.compraDetalle.presentacionId)).where(eq(schema.compraDetalle.compraId, r.id));
    expect(c.pvpSugerido[0].pvpSugerido).toBe(precioSugerido(p.costoPromedio, det.factor, p.porcentajeUtilidad));
    expect(c.pvpSugerido[0].pvpSugerido).toBeGreaterThan(p.costoPromedio * det.factor * 1.18);
  });
  it("quien registra la salida no la aprueba (RN-09)", async () => {
    const [venc] = await db.select().from(schema.motivo).where(eq(schema.motivo.codigo, "VENCIMIENTO"));
    await expect(registrarMovimiento(db, F.qf, { motivoId: venc.id, descripcion: "Baja de lote vencido", items: [{ loteId: F.lotes.vencido.id, unidades: 5 }] })).rejects.toThrow(/evidencia/);
    const m = await registrarMovimiento(db, F.qf, { motivoId: venc.id, descripcion: "Baja de lote vencido", evidencia: "acta-001.pdf", items: [{ loteId: F.lotes.vencido.id, unidades: 5 }] });
    expect(m.estado).toBe("PENDIENTE");
    await expect(decidirMovimiento(db, F.qf, m.id, { decision: "APROBAR" })).rejects.toThrow(/RN-09/);
    await decidirMovimiento(db, F.admin, m.id, { decision: "APROBAR" });
    const [l] = await db.select().from(schema.lote).where(eq(schema.lote.id, F.lotes.vencido.id));
    expect(l.cantidad).toBe(0);
  });
});

describe("Comisiones diarias y cierre de mes", () => {
  it("consolida a diario y paga meses cerrados", async () => {
    await consolidarHasta(db, hoy());
    const [d] = await db.select().from(schema.comisionDiaria);
    expect(d.total).toBeGreaterThan(0);
    const mesPasado = sumarDias(hoy().slice(0, 8) + "01", -1);
    const [v] = await db.select().from(schema.venta).limit(1);
    await db.insert(schema.comision).values({ ventaId: v.id, usuarioId: F.caja2.id, porcentaje: 5, base: 100, monto: 5, origen: "DIRECTA", fecha: mesPasado });
    const r = await cerrarMes(db, F.admin, mesPasado.slice(0, 7));
    expect(r.liquidaciones).toHaveLength(1);
    expect(r.liquidaciones[0].total).toBe(5);
    const mesSiguiente = sumarDias(hoy().slice(0, 8) + "28", 7).slice(0, 7);
    await expect(cerrarMes(db, F.admin, mesSiguiente)).rejects.toThrow(/último día/);
  });
  it("el detalle del vendedor cuadra con su acumulado y no incluye lo revertido", async () => {
    const mes = hoy().slice(0, 7);
    await db.insert(schema.sesionCaja).values({ cajaId: F.cajas[1].id, usuarioId: F.caja2.id, turno: "TARDE", fondoInicial: 150, estado: "ABIERTA" });
    const v = await crearVenta(db, F.caja2, { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 100 }] });
    const anulada = await crearVenta(db, F.caja2, { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 100 }] });
    await anularVenta(db, F.admin, anulada.id, { motivo: "Cliente devolvió el producto" });
    const d = await detalleVendedor(db, F.caja2.id, mes);
    const fila = (await resumenMes(db, mes)).vendedores.find((x) => x.usuarioId === F.caja2.id);
    expect(d.lineas).toHaveLength(1);
    expect(d.lineas[0].producto).toBeTruthy();
    expect(d.lineas[0].serie).toBe(v.serie);
    expect(d.total).toBe(v.comisionVenta);
    expect(d.total).toBe(fila?.total);
    await expect(detalleVendedor(db, 999999, mes)).rejects.toThrow(/no existe/);
  });
});

describe("Alertas y reportes", () => {
  it("genera alertas por vencimiento y las filtra por rol", async () => {
    await evaluarAlertas(db);
    const qf = await alertasDelRol(db, ["QF"]);
    expect(qf.conteos.find((c) => c.tipo === "POR_VENCER")?.total).toBeGreaterThan(0);
    const cajero = await alertasDelRol(db, ["CAJERO"]);
    // El cajero solo recibe los productos en campaña, nada de stock ni vencimientos.
    expect(cajero.alertas.every((a) => a.tipo === "CAMPANA_ACTIVA")).toBe(true);
  });
  it("el filtro por tipo trae todas sus alertas aunque haya más urgentes (contador = lista)", async () => {
    const claves = Array.from({ length: 50 }, (_, i) => ({ clave: `PRUEBA:${i}`, tipo: "VENCIDO", severidad: "CRITICA", titulo: "Lote", detalle: "Vencido" }));
    await db.insert(schema.alerta).values([...claves, { clave: "PRUEBA:dif", tipo: "DIF_CAJA", severidad: "ALTA", titulo: "Cierre", detalle: "Diferencia" }]);
    const panelAdmin = await alertasDelRol(db, ["ADMIN"], { limite: 40 });
    expect(panelAdmin.alertas.some((a) => a.tipo === "DIF_CAJA")).toBe(false);
    const dif = await alertasDelRol(db, ["ADMIN"], { tipo: "DIF_CAJA", limite: 200 });
    expect(dif.alertas).toHaveLength(dif.conteos.find((c) => c.tipo === "DIF_CAJA")!.total);
    expect(dif.alertas.length).toBeGreaterThan(0);
    await evaluarAlertas(db);
    expect((await db.select().from(schema.alerta).where(eq(schema.alerta.clave, "PRUEBA:dif")))[0].estado).toBe("CERRADA");
  });
  it("una salida pendiente recién registrada ya aparece y las evaluaciones simultáneas no duplican", async () => {
    const [m] = await db.select().from(schema.motivo).where(eq(schema.motivo.codigo, "VENCIMIENTO"));
    const mov = await registrarMovimiento(db, F.qf, { motivoId: m.id, descripcion: "Baja reciente de prueba", evidencia: "Acta 1", items: [{ loteId: F.lotes.lejano.id, unidades: 1 }] });
    await Promise.all([evaluarAlertas(db), evaluarAlertas(db)]);
    const filas = await db.select().from(schema.alerta).where(eq(schema.alerta.clave, `SAL:m:${mov.id}`));
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe("ABIERTA");
    await decidirMovimiento(db, F.admin, mov.id, { decision: "RECHAZAR", comentario: "Solo prueba" });
  });
  it("las métricas con costo solo las ve el administrador (RN-20)", async () => {
    const m = await crearMetrica(db, F.admin, { nombre: "Margen prueba", formula: "(ventas / 1.18 - costo_ventas) / (ventas / 1.18) * 100", unidad: "PORCENTAJE", roles: ["QF"], enPanel: false });
    expect(m.sensible).toBe(true);
    await expect(ejecutarReporte(db, ["QF"], { agrupar: "categoria", metricas: [m.codigo] })).rejects.toThrow(/no está disponible/);
    const r = await ejecutarReporte(db, ["ADMIN"], { agrupar: "categoria", metricas: ["ventas", m.codigo] });
    expect(r.filas.length).toBeGreaterThan(0);
  });
});

describe("Alta y edición de productos", () => {
  const datos = { codigo: "7750000000011", nombre: "Dolofenex Forte", laboratorioId: 1, costoUnitario: 0.67, precioUnidad: 2, blister: { factor: 10, pvp: 18 }, caja: { factor: 100, pvp: 150 } };

  it("crea el producto con sus presentaciones y sin stock; rechaza el código repetido", async () => {
    const { id } = await crearProducto(db, F.admin, esquemaProducto.parse(datos));
    const f = (await fichaProducto(db, id))!;
    expect(f.stock).toBe(0);
    expect(f.costoPromedio).toBe(0.67);
    expect(f.presentaciones.map((p) => [p.nombre, p.factor, p.pvp])).toEqual([["Unidad", 1, 2], ["Blíster x10", 10, 18], ["Caja x100", 100, 150]]);
    await expect(crearProducto(db, F.admin, esquemaProducto.parse({ ...datos, nombre: "Otro" }))).rejects.toThrow(/ya pertenece/);
  });

  it("no acepta blíster y caja con las mismas unidades", () => {
    expect(() => esquemaProducto.parse({ ...datos, caja: { factor: 10, pvp: 100 } })).toThrow();
  });

  it("al editar desactiva la presentación quitada y respeta el costo si ya hay kardex", async () => {
    const [p] = await db.select().from(schema.producto).where(eq(schema.producto.codigo, datos.codigo));
    await editarProducto(db, F.admin, p.id, esquemaProducto.parse({ ...datos, costoUnitario: 0.8, precioUnidad: 2.5, caja: null }));
    const f = (await fichaProducto(db, p.id))!;
    expect(f.costoPromedio).toBe(0.8);
    expect(f.presentaciones.map((x) => [x.factor, x.pvp])).toEqual([[1, 2.5], [10, 18]]);
    await db.insert(schema.kardex).values({ productoId: p.id, tipo: "COMPRA", documentoTipo: "FACTURA", entrada: 1, costoUnitario: 0.8, saldoUnidades: 1, costoPromedio: 0.8, saldoValorizado: 0.8 });
    await editarProducto(db, F.admin, p.id, esquemaProducto.parse({ ...datos, costoUnitario: 9 }));
    expect((await fichaProducto(db, p.id))!.costoPromedio).toBe(0.8);
  });

  it("sugiere el precio con utilidad e IGV, redondeando hacia arriba a 10 céntimos", () => {
    expect(precioSugerido(0.67, 1, 30)).toBe(1.1);
    expect(precioSugerido(0.67, 10, 30)).toBe(10.3);
    expect(precioSugerido(1, 1, 0)).toBe(1.2);
  });

  describe("códigos por presentación", () => {
    const conCodigos = { codigo: "7750000000100", nombre: "Amoxicilina 500", laboratorioId: 2, concentracion: "500 mg", formaFarmaceutica: "Cápsula", registroSanitario: "EE-01234", registroVence: "2030-01-31", porcentajeUtilidad: 40, costoUnitario: 1, precioUnidad: 2, blister: { factor: 10, pvp: 18, codigo: "7750000000101" }, caja: { factor: 100, pvp: 150, codigo: "7750000000102" } };
    let id: number;

    it("guarda los datos farmacéuticos y la utilidad", async () => {
      ({ id } = await crearProducto(db, F.admin, esquemaProducto.parse(conCodigos)));
      const f = (await fichaProducto(db, id))!;
      expect([f.concentracion, f.formaFarmaceutica, f.registroSanitario, f.registroVence, f.porcentajeUtilidad]).toEqual(["500 mg", "Cápsula", "EE-01234", "2030-01-31", 40]);
    });

    it("al escanear identifica la presentación y por el código general no fuerza ninguna", async () => {
      const f = (await fichaProducto(db, id))!;
      const caja = f.presentaciones.find((p) => p.factor === 100)!;
      const [r] = await buscarProductos(db, "7750000000102");
      expect([r.id, r.presentacionEscaneadaId]).toEqual([id, caja.id]);
      const [g] = await buscarProductos(db, "7750000000100");
      expect([g.id, g.presentacionEscaneadaId]).toEqual([id, undefined]);
      expect((await listarStock(db, { q: "7750000000101" })).productos.map((p) => p.id)).toEqual([id]);
    });

    it("rechaza códigos repetidos dentro del producto y entre productos", async () => {
      expect(() => esquemaProducto.parse({ ...conCodigos, caja: { ...conCodigos.caja, codigo: conCodigos.blister.codigo } })).toThrow(/código distinto/);
      const otro = { ...conCodigos, codigo: "7750000000200", blister: null, caja: null };
      await expect(crearProducto(db, F.admin, esquemaProducto.parse({ ...otro, codigo: "7750000000101" }))).rejects.toThrow(/ya pertenece/);
      await expect(crearProducto(db, F.admin, esquemaProducto.parse({ ...otro, blister: { factor: 10, pvp: 18, codigo: "7750000000100" } }))).rejects.toThrow(/ya pertenece/);
    });

    it("permite intercambiar códigos y libera el de la presentación quitada", async () => {
      await editarProducto(db, F.admin, id, esquemaProducto.parse({ ...conCodigos, blister: { factor: 10, pvp: 18, codigo: "7750000000102" }, caja: { factor: 100, pvp: 150, codigo: "7750000000101" } }));
      expect((await fichaProducto(db, id))!.presentaciones.map((p) => p.codigo)).toEqual([null, "7750000000102", "7750000000101"]);
      await editarProducto(db, F.admin, id, esquemaProducto.parse({ ...conCodigos, blister: { factor: 10, pvp: 18, codigo: "7750000000102" }, caja: null }));
      const { id: nuevo } = await crearProducto(db, F.admin, esquemaProducto.parse({ ...conCodigos, codigo: "7750000000300", blister: { factor: 10, pvp: 18, codigo: "7750000000101" }, caja: null, confirmarDuplicado: true }));
      expect(nuevo).toBeGreaterThan(id);
    });
  });

  describe("mismo nombre", () => {
    const base = { ...datos, nombre: "Paracetamol 500", laboratorioId: 2, blister: null, caja: null };
    let id: number;

    it("con otro laboratorio se crea sin aviso, como producto aparte", async () => {
      ({ id } = await crearProducto(db, F.admin, esquemaProducto.parse({ ...base, codigo: "7750000000600" })));
      const otro = await crearProducto(db, F.admin, esquemaProducto.parse({ ...base, codigo: "7750000000601", laboratorioId: 3 }));
      expect(otro.id).not.toBe(id);
      expect((await listarStock(db, { q: "Portugal" })).productos.map((p) => p.id)).toEqual([otro.id]);
      expect((await fichaProducto(db, otro.id))!.laboratorio).toBe("Portugal");
    });

    it("con el mismo laboratorio pide confirmar, sin distinguir mayúsculas en el nombre", async () => {
      const copia = { ...base, codigo: "7750000000602", nombre: "PARACETAMOL 500" };
      await expect(crearProducto(db, F.admin, esquemaProducto.parse(copia))).rejects.toThrow(/Confirma si es un producto distinto/);
      const { id: confirmado } = await crearProducto(db, F.admin, esquemaProducto.parse({ ...copia, confirmarDuplicado: true }));
      expect(confirmado).toBeGreaterThan(id);
    });

    it("al editar no se avisa contra sí mismo, pero sí contra otro", async () => {
      const { id: propio } = await crearProducto(db, F.admin, esquemaProducto.parse({ ...base, codigo: "7750000000603", nombre: "Ibuprofeno 400" }));
      await editarProducto(db, F.admin, propio, esquemaProducto.parse({ ...base, codigo: "7750000000603", nombre: "Ibuprofeno 400", precioUnidad: 3 }));
      await expect(editarProducto(db, F.admin, propio, esquemaProducto.parse({ ...base, codigo: "7750000000603" }))).rejects.toThrow(/Confirma/);
    });
  });

  it("«bajo mínimo» cuenta solo el stock vigente, igual que la tabla", async () => {
    const { id } = await crearProducto(db, F.admin, esquemaProducto.parse({ ...datos, codigo: "7750000000400", nombre: "Solo vencido", blister: null, caja: null, stockMinimo: 5 }));
    await db.insert(schema.lote).values({ productoId: id, numero: "VENC1", vencimiento: sumarDias(hoy(), -1), costoUnitario: 1, cantidad: 100, estado: "VENCIDO" });
    expect((await listarStock(db, { q: "Solo vencido", filtro: "bajo" })).productos.map((p) => p.id)).toEqual([id]);
  });

  it("«por vencer» trae los lotes vigentes dentro de 90 días", async () => {
    const { id } = await crearProducto(db, F.admin, esquemaProducto.parse({ ...datos, codigo: "7750000000500", nombre: "Vence pronto", blister: null, caja: null }));
    await db.insert(schema.lote).values({ productoId: id, numero: "PRONTO1", vencimiento: sumarDias(hoy(), 30), costoUnitario: 1, cantidad: 10 });
    expect((await listarStock(db, { q: "Vence pronto", filtro: "vencer" })).productos.map((p) => p.id)).toEqual([id]);
    expect((await listarStock(db, { q: "Solo vencido", filtro: "vencer" })).productos).toEqual([]);
  });
});

describe("Catálogo de laboratorios", () => {
  const crear = (nombre: string, confirmarParecido?: boolean) => crearLaboratorio(db, F.admin, { nombre, confirmarParecido });

  it("trata como uno solo las distintas formas de escribir un laboratorio", async () => {
    for (const v of ["IQ Farma", "IQFARMA", "iq-farma", "Laboratorios IQ Farma S.A.C.", "  IQ   Farma  ", "Lab. Iq Farma SAC"]) expect(claveLaboratorio(v)).toBe("iqfarma");
    expect(claveLaboratorio("Induquímica")).toBe(claveLaboratorio("INDUQUIMICA"));
    expect(claveLaboratorio("Laboratorio")).toBe("laboratorio");
    const r = await crear("Laboratorios IQ-FARMA S.A.C.");
    expect([r.existente, r.laboratorio?.nombre]).toEqual([true, "IQ Farma"]);
  });

  it("pregunta ante un nombre parecido y solo crea si se confirma", async () => {
    const r = await crear("Genfarr");
    expect(r.laboratorio).toBeNull();
    expect(r.parecidos.map((p) => p.nombre)).toEqual(["Genfar"]);
    expect((await crear("Genfarr", true)).laboratorio?.nombre).toBe("Genfarr");
    expect((await listarLaboratorios(db)).find((l) => l.nombre === "Genfar")?.parecidos).toContain("Genfarr");
    expect((await crear("Bayer")).existente).toBe(false);
  });

  it("no permite renombrar hacia un laboratorio existente", async () => {
    const { laboratorio } = await crear("Genfarr");
    await expect(renombrarLaboratorio(db, F.admin, laboratorio!.id, { nombre: "GENFAR" })).rejects.toThrow(/Unificar/);
    await renombrarLaboratorio(db, F.admin, laboratorio!.id, { nombre: "Genfarr Perú" });
    expect((await crear("genfarr peru")).laboratorio?.id).toBe(laboratorio!.id);
  });

  it("rechaza un producto con un laboratorio fuera del catálogo", async () => {
    const d = { codigo: "7750000000700", nombre: "Sin lab", costoUnitario: 1, precioUnidad: 2 };
    expect(() => esquemaProducto.parse(d)).toThrow(/catálogo/);
    await expect(crearProducto(db, F.admin, esquemaProducto.parse({ ...d, laboratorioId: 9999 }))).rejects.toThrow(/catálogo/);
  });

  it("unifica moviendo los productos, y solo elimina si no tiene productos", async () => {
    const origen = (await crear("Hersil Perú")).laboratorio!;
    const destino = (await crear("Roemmers")).laboratorio!;
    const { id } = await crearProducto(db, F.admin, esquemaProducto.parse({ codigo: "7750000000800", nombre: "Producto a mover", laboratorioId: origen.id, costoUnitario: 1, precioUnidad: 2 }));
    await expect(eliminarLaboratorio(db, F.admin, origen.id)).rejects.toThrow(/Unificar/);
    await expect(unificarLaboratorios(db, F.admin, origen.id, origen.id)).rejects.toThrow(/otro laboratorio/);
    expect((await unificarLaboratorios(db, F.admin, origen.id, destino.id)).productos).toBe(1);
    expect((await fichaProducto(db, id))!.laboratorio).toBe("Roemmers");
    const sinUso = (await crear("Zzz Temporal")).laboratorio!;
    await eliminarLaboratorio(db, F.admin, sinUso.id);
    expect((await listarLaboratorios(db)).map((l) => l.nombre)).not.toContain("Zzz Temporal");
  });

  it("el reporte por laboratorio usa el catálogo", async () => {
    const r = await ejecutarReporte(db, ["ADMIN"], { agrupar: "laboratorio", metricas: ["ventas"] });
    expect(r.filas.length).toBeGreaterThan(0);
  });

  it("la migración une las variantes, conserva los productos y coincide con la clave de la app", async () => {
    const pg = new PGlite();
    const aplicar = async (archivo: string) => { for (const s of readFileSync(`drizzle/${archivo}`, "utf8").split("--> statement-breakpoint")) await pg.exec(s); };
    const archivos = readdirSync("drizzle").filter((a) => a.endsWith(".sql")).sort();
    for (const a of archivos.filter((x) => x < "0002")) await aplicar(a);
    const variantes = ["IQ Farma", "IQ Farma", "IQFARMA", "Lab. IQ-Farma S.A.C.", "Induquímica", "INDUQUIMICA", "  Genfar ", "Laboratorio", "---", null];
    for (const [i, lab] of variantes.entries()) await pg.query(`insert into producto (codigo, nombre, laboratorio) values ($1, $2, $3)`, [`C${i}`, `P${i}`, lab]);
    for (const a of archivos.filter((x) => x >= "0002")) await aplicar(a);
    const labs = (await pg.query<{ nombre: string; clave: string }>("select nombre, clave from laboratorio order by clave")).rows;
    expect(labs.map((l) => l.nombre)).toEqual(["Genfar", "Induquímica", "IQ Farma", "Laboratorio"].sort((a, b) => claveLaboratorio(a).localeCompare(claveLaboratorio(b))));
    for (const l of labs) expect(l.clave).toBe(claveLaboratorio(l.nombre));
    const prods = (await pg.query<{ codigo: string; nombre: string | null }>("select p.codigo, l.nombre from producto p left join laboratorio l on l.id = p.laboratorio_id order by p.id")).rows;
    expect(prods.map((p) => p.nombre)).toEqual(["IQ Farma", "IQ Farma", "IQ Farma", "IQ Farma", "Induquímica", "Induquímica", "Genfar", "Laboratorio", null, null]);
    await pg.close();
  });
});

describe("Campos numéricos", () => {
  it.each([["12abc", "12"], ["abc", ""], ["12,5", "12.5"], ["1.2.3", "1.23"], ["-5", "5"], ["S/ 1,250.50", "1250.50"], ["1.250,50", "1250.50"], ["12.", "12."], ["1e5", "15"]])("decimal: %s → %s", (entrada, salida) => {
    expect(limpiarNumero(entrada)).toBe(salida);
  });
  it("entero: descarta letras, signos y decimales", () => {
    expect(limpiarNumero("1a2.5", true)).toBe("125");
    expect(limpiarNumero("abc", true)).toBe("");
  });
  it("el servidor rechaza texto aunque se salte la pantalla", () => {
    expect(esquemaCorreccion.safeParse({ motivo: "Costo mal digitado", costos: [{ detalleId: 1, costoPresentacion: "abc" }] }).success).toBe(false);
    expect(esquemaRecepcion.safeParse({ proveedor: { ruc: "20100000011", razonSocial: "Droguería" }, tipoComprobante: "FACTURA", serie: "F1", numero: "1", fechaEmision: hoy(), items: [{ presentacionId: 1, cantidad: "diez", numeroLote: "L", vencimiento: hoy() }] }).success).toBe(false);
  });
});

describe("Corrección de costo de una compra", () => {
  const ingresar = async (numero: string, numeroLote: string, cantidad: number, costo: number) => {
    const r = await registrarRecepcion(db, F.almacen, { proveedor: { ruc: "20100000011", razonSocial: "Droguería" }, tipoComprobante: "FACTURA", serie: "F009", numero, fechaEmision: hoy(), items: [{ presentacionId: F.presAmox.id, cantidad, numeroLote, vencimiento: sumarDias(hoy(), 500) }] });
    const [d] = await db.select().from(schema.compraDetalle).where(eq(schema.compraDetalle.compraId, r.id));
    await costearCompra(db, F.admin, r.id, { costos: [{ detalleId: d.id, costoPresentacion: costo }], confirmarVariacion: true });
    return { id: r.id, d };
  };
  const promedio = async () => (await db.select().from(schema.producto).where(eq(schema.producto.id, F.amox.id)))[0].costoPromedio;

  it("deja el mismo promedio que si se hubiera digitado bien, también con compras posteriores", async () => {
    const stock = async () => Number((await db.select({ s: sql<number>`sum(cantidad)` }).from(schema.lote).where(eq(schema.lote.productoId, F.amox.id)))[0].s);
    const cp0 = await promedio(); const s0 = await stock();
    const a = await ingresar("100", "CORR-A", 10, 500);
    const uA = a.d.unidades;
    const b = await ingresar("101", "CORR-B", 5, 20);
    const uB = b.d.unidades;
    const r = await corregirCostoCompra(db, F.admin, a.id, { motivo: "Costo mal digitado", costos: [{ detalleId: a.d.id, costoPresentacion: 20 }] });
    const costoA = r4(20 * 10 / uA); const costoB = r4(20 * 5 / uB);
    const esperadoA = r4((s0 * cp0 + uA * costoA) / (s0 + uA));
    expect(await promedio()).toBe(r4(((s0 + uA) * esperadoA + uB * costoB) / (s0 + uA + uB)));
    expect(r.total).toBe(200);
    expect(r.pvpSugerido).toHaveLength(1);
    const [l] = await db.select().from(schema.lote).where(eq(schema.lote.numero, "CORR-A"));
    expect(l.costoUnitario).toBe(costoA);
    expect(l.cantidad).toBe(uA);
    expect((await db.select().from(schema.compra).where(eq(schema.compra.id, a.id)))[0].total).toBe(200);
  });

  it("conserva la línea original del kardex, no mueve stock y lo deja en auditoría", async () => {
    const [c] = await db.select().from(schema.compra).where(eq(schema.compra.numero, "100"));
    const lineas = await db.select().from(schema.kardex).where(eq(schema.kardex.documentoId, c.id));
    const original = lineas.find((l) => l.tipo === "COMPRA" && l.documentoRef === "F009-100")!;
    const correccion = lineas.find((l) => l.tipo === "CORRECCION_COSTO")!;
    expect(original.costoUnitario).toBeGreaterThan(correccion.costoUnitario);
    expect(correccion.entrada).toBe(0);
    expect(correccion.salida).toBe(0);
    expect(correccion.motivo).toBe("Costo mal digitado");
    const { historial, salidas } = await datosCorreccion(db, c.id);
    expect(Object.values(salidas)).toEqual([0]);
    expect(historial[0].usuario).toBeTruthy();
    expect(historial[0].detalle).toMatchObject({ motivo: "Costo mal digitado", totalAntes: 5000, totalDespues: 200, cambios: [{ lote: "CORR-A", antes: 500, despues: 20 }] });
    expect((await listarCompras(db)).find((x) => x.id === c.id)?.correcciones).toBe(1);
  });

  it("una segunda corrección usa el costo vigente y las ventas pasadas no cambian", async () => {
    const [c] = await db.select().from(schema.compra).where(eq(schema.compra.numero, "100"));
    const [d] = await db.select().from(schema.compraDetalle).where(eq(schema.compraDetalle.compraId, c.id));
    const ventas = await db.select({ id: schema.ventaDetalle.id, costo: schema.ventaDetalle.costoUnitario }).from(schema.ventaDetalle);
    const p = await corregirCostoCompra(db, F.admin, c.id, { motivo: "Faltaba el descuento", costos: [{ detalleId: d.id, costoPresentacion: 18 }] });
    expect(p.total).toBe(180);
    expect((await datosCorreccion(db, c.id)).historial).toHaveLength(2);
    expect(await db.select({ id: schema.ventaDetalle.id, costo: schema.ventaDetalle.costoUnitario }).from(schema.ventaDetalle)).toEqual(ventas);
  });

  it("rechaza si no hay cambios, si la línea es de otra compra o si aún está pendiente de costo", async () => {
    const [c] = await db.select().from(schema.compra).where(eq(schema.compra.numero, "100"));
    const [d] = await db.select().from(schema.compraDetalle).where(eq(schema.compraDetalle.compraId, c.id));
    await expect(corregirCostoCompra(db, F.admin, c.id, { motivo: "Sin cambios", costos: [{ detalleId: d.id, costoPresentacion: 18 }] })).rejects.toThrow(/ningún costo/);
    await expect(corregirCostoCompra(db, F.admin, c.id, { motivo: "Línea ajena", costos: [{ detalleId: 999999, costoPresentacion: 1 }] })).rejects.toThrow(/no pertenece/);
    const r = await registrarRecepcion(db, F.almacen, { proveedor: { ruc: "20100000011", razonSocial: "Droguería" }, tipoComprobante: "FACTURA", serie: "F009", numero: "102", fechaEmision: hoy(), items: [{ presentacionId: F.presAmox.id, cantidad: 1, numeroLote: "CORR-C", vencimiento: sumarDias(hoy(), 500) }] });
    await expect(corregirCostoCompra(db, F.admin, r.id, { motivo: "Aún sin costo", costos: [{ detalleId: 1, costoPresentacion: 1 }] })).rejects.toThrow(/ya entró/);
  });
});

describe("Anulación de compra", () => {
  const recibir = (numero: string, numeroLote: string, cantidad: number) => registrarRecepcion(db, F.almacen, { proveedor: { ruc: "20100000011", razonSocial: "Droguería" }, tipoComprobante: "FACTURA", serie: "A001", numero, fechaEmision: hoy(), items: [{ presentacionId: F.presAmox.id, cantidad, numeroLote, vencimiento: sumarDias(hoy(), 500) }] });
  const ingresar = async (numero: string, numeroLote: string, cantidad: number, costo: number) => {
    const r = await recibir(numero, numeroLote, cantidad);
    const [d] = await db.select().from(schema.compraDetalle).where(eq(schema.compraDetalle.compraId, r.id));
    await costearCompra(db, F.admin, r.id, { costos: [{ detalleId: d.id, costoPresentacion: costo }], confirmarVariacion: true });
    return { id: r.id, d };
  };
  const estado = async () => {
    const [p] = await db.select().from(schema.producto).where(eq(schema.producto.id, F.amox.id));
    const [{ s }] = await db.select({ s: sql<number>`sum(cantidad)`.mapWith(Number) }).from(schema.lote).where(eq(schema.lote.productoId, F.amox.id));
    return { cp: p.costoPromedio, stock: s };
  };

  it("deja stock y promedio como si no hubiera existido, conserva el kardex y audita", async () => {
    const antes = await estado();
    const c = await ingresar("1", "ANUL-A", 10, 700);
    await anularCompra(db, F.admin, c.id, { motivo: "Compra registrada dos veces" });
    expect(await estado()).toEqual(antes);
    const lineas = await db.select().from(schema.kardex).where(eq(schema.kardex.documentoRef, "A001-1"));
    expect(lineas.map((l) => l.tipo)).toEqual(["COMPRA", "ANULACION_COMPRA"]);
    expect(lineas[1].salida).toBe(c.d.unidades);
    expect(lineas[1].motivo).toBe("Compra registrada dos veces");
    expect(lineas[1].saldoUnidades).toBe(antes.stock);
    const [a] = await db.select().from(schema.auditoria).where(and(eq(schema.auditoria.accion, "ANULAR_COMPRA"), eq(schema.auditoria.entidadId, c.id)));
    expect(a.usuarioId).toBe(F.admin.id);
    expect(a.detalle).toMatchObject({ motivo: "Compra registrada dos veces", estadoAnterior: "CONFIRMADA", comprobante: "A001-1" });
    const fila = (await listarCompras(db)).find((x) => x.id === c.id);
    expect(fila?.estado).toBe("ANULADA");
    expect(fila?.motivoAnulacion).toBe("Compra registrada dos veces");
  });

  it("el promedio sale bien con compras posteriores y al corregir o anular otra después", async () => {
    const inicial = await estado();
    const a = await ingresar("2", "ANUL-B", 5, 700);
    const b = await ingresar("3", "ANUL-C", 5, 20);
    await anularCompra(db, F.admin, a.id, { motivo: "No correspondía" });
    const uB = b.d.unidades; const costoB = r4(20 * 5 / uB);
    const esperado = r4((inicial.stock * inicial.cp + uB * costoB) / (inicial.stock + uB));
    expect((await estado()).cp).toBe(esperado);
    await corregirCostoCompra(db, F.admin, b.id, { motivo: "Costo mal digitado", costos: [{ detalleId: b.d.id, costoPresentacion: 10 }] });
    const corregido = r4((inicial.stock * inicial.cp + uB * r4(10 * 5 / uB)) / (inicial.stock + uB));
    expect((await estado()).cp).toBe(corregido);
    await anularCompra(db, F.admin, b.id, { motivo: "Tampoco correspondía" });
    expect(await estado()).toEqual({ cp: r4(inicial.cp), stock: inicial.stock });
  });

  it("corregir una compra respeta una corrección anterior de otra compra", async () => {
    const inicial = await estado();
    const a = await ingresar("4", "ANUL-D", 2, 900);
    const b = await ingresar("5", "ANUL-E", 2, 20);
    await corregirCostoCompra(db, F.admin, a.id, { motivo: "Costo mal digitado", costos: [{ detalleId: a.d.id, costoPresentacion: 20 }] });
    await corregirCostoCompra(db, F.admin, b.id, { motivo: "Costo mal digitado", costos: [{ detalleId: b.d.id, costoPresentacion: 30 }] });
    const ua = a.d.unidades; const ub = b.d.unidades;
    const trasA = r4((inicial.stock * inicial.cp + ua * r4(20 * 2 / ua)) / (inicial.stock + ua));
    expect((await estado()).cp).toBe(r4(((inicial.stock + ua) * trasA + ub * r4(30 * 2 / ub)) / (inicial.stock + ua + ub)));
    await anularCompra(db, F.admin, b.id, { motivo: "Limpieza de prueba" });
    await anularCompra(db, F.admin, a.id, { motivo: "Limpieza de prueba" });
  });

  it("bloquea si ya salió mercadería o hay una salida pendiente, sin cambiar nada", async () => {
    const c = await ingresar("6", "ANUL-F", 3, 20);
    const [l] = await db.select().from(schema.lote).where(eq(schema.lote.numero, "ANUL-F"));
    const [m] = await db.select().from(schema.motivo).where(eq(schema.motivo.codigo, "VENCIMIENTO"));
    const mov = await registrarMovimiento(db, F.qf, { motivoId: m.id, descripcion: "Baja de prueba pendiente", evidencia: "Acta 2", items: [{ loteId: l.id, unidades: 1 }] });
    await expect(anularCompra(db, F.admin, c.id, { motivo: "Con salida pendiente" })).rejects.toThrow(/MOV-/);
    await decidirMovimiento(db, F.admin, mov.id, { decision: "APROBAR" });
    const antes = await estado();
    await expect(anularCompra(db, F.admin, c.id, { motivo: "Ya salió una unidad" })).rejects.toThrow(/ya salieron 1 de/);
    expect(await estado()).toEqual(antes);
    expect((await db.select().from(schema.compra).where(eq(schema.compra.id, c.id)))[0].estado).toBe("CONFIRMADA");
  });

  it("anula una recepción pendiente sin mover stock y libera el comprobante para registrarlo otra vez", async () => {
    const antes = await estado();
    const r = await recibir("7", "ANUL-G", 4);
    await expect(recibir("7", "ANUL-G", 4)).rejects.toThrow(/ya está registrado/);
    await anularCompra(db, F.admin, r.id, { motivo: "Datos equivocados" });
    await expect(anularCompra(db, F.admin, r.id, { motivo: "Otra vez" })).rejects.toThrow(/ya está anulada/);
    await expect(costearCompra(db, F.admin, r.id, { costos: [{ detalleId: 1, costoPresentacion: 1 }] })).rejects.toThrow(/ya fue ingresada/);
    expect(await estado()).toEqual(antes);
    expect((await recibir("7", "ANUL-G", 4)).estado).toBe("PENDIENTE_COSTO");
  });
});

describe("Usuarios y perfiles", () => {
  it("varios perfiles dan la unión de permisos, también si se solapan o repiten", () => {
    const mixto: Rol[] = ["CAJERO", "CONTADOR"];
    expect(puede(mixto, "caja")).toBe(true);
    expect(puede(mixto, "caja.auditoria")).toBe(true);
    expect(puede(mixto, "productos.gestionar")).toBe(false);
    expect(puede(["CAJERO", "VENDEDOR"], "ventas")).toBe(true);
    expect(esquemaNuevoUsuario.parse({ nombre: "Ana Pérez", login: " Ana.P ", password: "12345678", roles: ["CAJERO", "CAJERO", "VENDEDOR"] })).toMatchObject({ login: "ana.p", roles: ["CAJERO", "VENDEDOR"] });
    expect(verCostos(["CONTADOR", "ADMIN"])).toBe(true);
    expect(enmascarar({ costoPromedio: 1, nombre: "x" }, mixto)).toEqual({ nombre: "x" });
  });
  it("rechaza datos raros al crear", () => {
    const base = { nombre: "Ana Pérez", login: "ana.p", password: "12345678", roles: ["CAJERO"] };
    for (const malo of [{ roles: [] }, { roles: ["DIOS"] }, { roles: "ADMIN" }, { login: "con espacio" }, { login: "a" }, { password: "corta" }, { nombre: "  " }, { login: 123 }])
      expect(esquemaNuevoUsuario.safeParse({ ...base, ...malo }).success).toBe(false);
  });
  it("crea con varios perfiles, no repite usuario, ingresa y se audita sin la clave", async () => {
    const u = await crearUsuario(db, F.admin, { nombre: "Multi Perfil", login: "multi", password: "clave-segura", roles: ["CAJERO", "VENDEDOR", "CONTADOR"] });
    expect(u).not.toHaveProperty("passwordHash");
    await expect(crearUsuario(db, F.admin, { nombre: "Otro", login: "multi", password: "clave-segura", roles: ["QF"] })).rejects.toThrow(/ya existe/);
    const [a] = await db.select().from(schema.auditoria).where(and(eq(schema.auditoria.accion, "CREAR_USUARIO"), eq(schema.auditoria.entidadId, u.id)));
    expect(JSON.stringify(a.detalle)).not.toContain("clave-segura");
    const sesion = { id: u.id, nombre: u.nombre, login: u.login, roles: u.roles };
    const leida = await leerSesion(await firmarSesion(sesion));
    expect(leida?.roles).toEqual(["CAJERO", "VENDEDOR", "CONTADOR"]);
    const a1 = await alertasDelRol(db, ["ADMIN"]);
    expect((await alertasDelRol(db, ["QF", "INVENTARIADOR"])).conteos.map((c) => c.tipo).filter((t, i, l) => l.indexOf(t) !== i)).toEqual([]);
    expect(a1.conteos.length).toBeGreaterThan(0);
    await expect(panel(db, sesion)).resolves.toBeTruthy();
    await expect(panel(db, { ...sesion, roles: ["QF", "INVENTARIADOR", "CAJERO", "VENDEDOR", "CONTADOR", "ADMIN"] })).resolves.toBeTruthy();
    expect(MODULOS.filter((m) => tieneRol(sesion.roles, ...m.roles)).map((m) => m.href)).toEqual(expect.arrayContaining(["/caja", "/ventas", "/comisiones", "/reportes", "/kardex"]));
  });
  it("lee sesiones antiguas de un solo perfil sin errores", async () => {
    const { SignJWT } = await import("jose");
    const viejo = await new SignJWT({ id: 1, nombre: "X", login: "x", rol: "CAJERO" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET || "solo-para-desarrollo-local-cambiar-en-vercel-0000"));
    expect((await leerSesion(viejo))?.roles).toEqual(["CAJERO"]);
  });
  it("no deja el portal sin propietario, ni se quita su acceso, ni abandona una caja abierta", async () => {
    const ed = (id: number, roles: Rol[], activo = true, nombre = "Nombre válido") => ({ id, input: { nombre, roles, activo } });
    let c = ed(F.admin.id, ["CAJERO"]);
    await expect(editarUsuario(db, F.admin, c.id, c.input)).rejects.toThrow(/quitarte/);
    c = ed(F.admin.id, ["ADMIN"], false);
    await expect(editarUsuario(db, F.admin, c.id, c.input)).rejects.toThrow(/propio/);
    await expect(editarUsuario(db, F.admin, 999999, ed(1, ["QF"]).input)).rejects.toThrow(/no existe/);
    const otro = await crearUsuario(db, F.admin, { nombre: "Otra Dueña", login: "duena2", password: "clave-segura", roles: ["ADMIN", "QF"] });
    const sOtro = { id: otro.id, nombre: otro.nombre, login: otro.login, roles: otro.roles };
    await editarUsuario(db, sOtro, F.admin.id, { nombre: F.admin.nombre, roles: ["QF"], activo: true });
    await expect(editarUsuario(db, sOtro, otro.id, { nombre: otro.nombre, roles: ["QF"], activo: true })).rejects.toThrow(/quitarte/);
    await editarUsuario(db, sOtro, F.admin.id, { nombre: F.admin.nombre, roles: ["ADMIN"], activo: true });
    await expect(editarUsuario(db, F.admin, otro.id, { nombre: otro.nombre, roles: ["QF"], activo: false })).resolves.toMatchObject({ activo: false });
    await expect(editarUsuario(db, sOtro, F.admin.id, { nombre: F.admin.nombre, roles: ["QF"], activo: true })).rejects.toThrow(/al menos un propietario/);
    const [abierta] = await db.select().from(schema.sesionCaja).where(eq(schema.sesionCaja.estado, "ABIERTA"));
    await expect(editarUsuario(db, F.admin, abierta.usuarioId, { nombre: "Cajero Abierto", roles: ["CONTADOR"], activo: true })).rejects.toThrow(/caja sin cerrar/);
    await expect(editarUsuario(db, F.admin, abierta.usuarioId, { nombre: "Cajero Abierto", roles: ["CAJERO"], activo: false })).rejects.toThrow(/caja sin cerrar/);
  });
  it("cambiar la clave la registra en auditoría sin guardarla", async () => {
    const u = await crearUsuario(db, F.admin, { nombre: "Con Clave", login: "conclave", password: "clave-inicial", roles: ["VENDEDOR"] });
    await editarUsuario(db, F.admin, u.id, { nombre: u.nombre, roles: u.roles, activo: true, password: "clave-nueva-1" });
    const [f] = await db.select().from(schema.usuario).where(eq(schema.usuario.id, u.id));
    expect(await bcrypt.compare("clave-nueva-1", f.passwordHash)).toBe(true);
    const [a] = await db.select().from(schema.auditoria).where(and(eq(schema.auditoria.accion, "EDITAR_USUARIO"), eq(schema.auditoria.entidadId, u.id)));
    expect(a.detalle).toMatchObject({ claveCambiada: true });
    expect(JSON.stringify(a.detalle)).not.toContain("clave-nueva-1");
  });
  it("cada módulo oculto tiene prefijo más largo que su módulo y las rutas raras no rompen", () => {
    expect(moduloDeRuta("/caja/eliminaciones")?.roles).toContain("CONTADOR");
    expect(moduloDeRuta("/caja")?.roles).not.toContain("CONTADOR");
    expect(moduloDeRuta("/cajaxx")).toBeNull();
    expect(moduloDeRuta("/")?.href).toBe("/");
    expect(["1", "2147483647"].every(esIdValido)).toBe(true);
    expect(["0", "-1", "abc", "1.5", "2147483648", "99999999999", "", "1;drop"].some(esIdValido)).toBe(false);
  });
});

describe("Eliminar usuarios", () => {
  it("borra al que no tiene operaciones, lo audita y libera su usuario", async () => {
    const u = await crearUsuario(db, F.admin, { nombre: "Para Borrar", login: "borrar", password: "clave-segura", roles: ["CAJERO", "QF"] });
    await eliminarUsuario(db, F.admin, u.id);
    expect(await db.select().from(schema.usuario).where(eq(schema.usuario.id, u.id))).toHaveLength(0);
    const [a] = await db.select().from(schema.auditoria).where(and(eq(schema.auditoria.accion, "ELIMINAR_USUARIO"), eq(schema.auditoria.entidadId, u.id)));
    expect(a.usuarioId).toBe(F.admin.id);
    expect(a.detalle).toMatchObject({ login: "borrar", nombre: "Para Borrar" });
    await expect(crearUsuario(db, F.admin, { nombre: "Otra Vez", login: "borrar", password: "clave-segura", roles: ["QF"] })).resolves.toBeTruthy();
  });
  it("no borra a quien tiene historial, a sí mismo ni a uno inexistente, y no deja rastro", async () => {
    const auditar = async () => (await db.select().from(schema.auditoria).where(eq(schema.auditoria.accion, "ELIMINAR_USUARIO"))).length;
    const antes = await auditar();
    await expect(eliminarUsuario(db, F.admin, F.caja1.id)).rejects.toThrow(/operaciones registradas/);
    expect(await db.select().from(schema.usuario).where(eq(schema.usuario.id, F.caja1.id))).toHaveLength(1);
    await expect(eliminarUsuario(db, F.admin, F.admin.id)).rejects.toThrow(/propio/);
    await expect(eliminarUsuario(db, F.admin, 999999)).rejects.toThrow(/no existe/);
    expect(await auditar()).toBe(antes);
  });
});

describe("Histórico de ventas del panel", () => {
  const anio = Number(hoy().slice(0, 4)); const mes = Number(hoy().slice(5, 7)); const dia = Number(hoy().slice(8, 10));
  it("agrupa por mes, día y hora y cuadra entre niveles", async () => {
    const a = await historicoVentas(db, F.admin, { anio });
    expect(a.nivel).toBe("mes");
    expect(a.barras).toHaveLength(12);
    const m = await historicoVentas(db, F.admin, { anio, mes });
    expect(m.nivel).toBe("dia");
    expect(m.barras).toHaveLength(new Date(Date.UTC(anio, mes, 0)).getUTCDate());
    const d = await historicoVentas(db, F.admin, { anio, mes, dia });
    expect(d.nivel).toBe("hora");
    expect(a.barras[mes - 1].total).toBe(m.total);
    expect(m.barras[dia - 1].total).toBe(d.total);
    expect(d.tickets).toBeGreaterThan(0);
    expect(a.anios).toContain(anio);
  });
  it("el vendedor solo ve lo suyo, el propietario todo, y el turno filtra", async () => {
    const todo = await historicoVentas(db, F.admin, { anio });
    const c1 = await historicoVentas(db, F.caja1, { anio }); const c2 = await historicoVentas(db, F.caja2, { anio });
    expect(c1.propias).toBe(true);
    expect(todo.propias).toBe(false);
    expect(c1.total + c2.total).toBeCloseTo(todo.total, 2);
    const [s] = await db.select({ turno: schema.sesionCaja.turno }).from(schema.venta).innerJoin(schema.sesionCaja, eq(schema.sesionCaja.id, schema.venta.sesionId)).where(eq(schema.venta.estado, "EMITIDA")).limit(1);
    const t = await historicoVentas(db, F.admin, { anio, turno: s.turno as "TARDE" });
    expect(t.tickets).toBeGreaterThan(0);
    expect(t.tickets).toBeLessThanOrEqual(todo.tickets);
    expect((await historicoVentas(db, F.admin, { anio: 2001 })).tickets).toBe(0);
  });
  it("no incluye ventas anuladas y rechaza filtros imposibles", async () => {
    const antes = await historicoVentas(db, F.admin, { anio });
    const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.venta).where(eq(schema.venta.estado, "EMITIDA"));
    expect(antes.tickets).toBe(n);
    await expect(historicoVentas(db, F.admin, { anio, dia: 1 })).rejects.toThrow(/mes/);
    await expect(historicoVentas(db, F.admin, { anio: 2026, mes: 2, dia: 31 })).rejects.toThrow(/no existe/);
    for (const malo of [{ anio: "abc" }, { anio: 1 }, { anio: 2026, mes: 13 }, { anio: 2026, turno: "X" }]) expect(esquemaHistorico.safeParse(malo).success).toBe(false);
    expect(esquemaHistorico.parse({ anio: "2026", mes: "", dia: "", turno: "" })).toEqual({ anio: 2026 });
  });
  it("las alertas de stock llevan el código del producto", async () => {
    await db.update(schema.producto).set({ stockMinimo: 100000 }).where(eq(schema.producto.id, F.vit.id));
    await evaluarAlertas(db);
    const [a] = await db.select().from(schema.alerta).where(eq(schema.alerta.clave, `STOCK:p:${F.vit.id}`));
    expect(a.detalle).toContain(`Cód. ${F.vit.codigo}`);
  });
  it("el reporte de stock crítico devuelve código y nombre", async () => {
    const r = await reporteEspecial(db, F.admin, "stock-critico", {}) as unknown as { filas: { codigo: string; producto: string }[] };
    expect(r.filas.find((f) => f.codigo === F.vit.codigo)?.producto).toBe(F.vit.nombre);
  });
});

describe("Transferencias a otra botica", () => {
  beforeAll(async () => {
    const [l] = await db.insert(schema.lote).values({ productoId: F.vit.id, numero: "TRF-01", vencimiento: sumarDias(hoy(), 500), costoUnitario: 10, cantidad: 60 }).returning();
    await db.insert(schema.kardex).values({ productoId: F.vit.id, loteId: l.id, tipo: "COMPRA", documentoTipo: "INVENTARIO_INICIAL", entrada: 60, costoUnitario: 10, saldoUnidades: 60, costoPromedio: 10, saldoValorizado: 600 });
  });
  const stockVit = async () => (await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id))).reduce((a, l) => a + l.cantidad, 0);
  it("el cajero registra solo cantidades; el stock no se mueve y no ve precios", async () => {
    const antes = await stockVit();
    const lt = await loteVigente(F.vit.id, 3);
    await expect(registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Sucursal Norte", motivo: "Pedido por falta de stock", items: [{ productoId: F.vit.id, unidades: 2 } as never] })).rejects.toThrow(/Elige el lote/);
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Sucursal Norte", motivo: "Pedido por falta de stock", items: [{ productoId: F.vit.id, loteId: lt.id, unidades: 2 }, { productoId: F.vit.id, loteId: lt.id, unidades: 1 }] });
    expect(r.referencia).toMatch(/^TR01-\d{8}$/);
    expect(await stockVit()).toBe(antes);
    const vista = await listarTransferencias(db, F.caja1);
    expect(vista[0].items).toHaveLength(1);
    expect(vista[0].items[0].unidades).toBe(3);
    expect(vista[0]).not.toHaveProperty("totalVenta");
    expect(vista[0].items[0]).not.toHaveProperty("precioUnitario");
    expect(JSON.stringify(vista)).not.toMatch(/precio|costo/i);
    expect(await listarTransferencias(db, F.caja2)).toHaveLength(0);
  });
  it("el propietario aprueba con precio: descuenta del lote elegido, va al kardex, sin comisión y la campaña sigue activa", async () => {
    const [t] = await listarTransferencias(db, F.admin, "PENDIENTE");
    expect(t.items[0].enCampana).toBe(true);
    const antes = await stockVit();
    const comisiones = (await db.select().from(schema.comision)).length;
    const r = await aprobarTransferencia(db, F.admin, t.id, { vendedorId: F.caja2.id, medioPago: "TRANSFERENCIA", precios: [{ detalleId: t.items[0].id, precioUnitario: 15 }], delivery: 5 });
    expect(r.totalVenta).toBe(50);
    expect(await stockVit()).toBe(antes - 3);
    expect((await db.select().from(schema.comision)).length).toBe(comisiones);
    const k = await db.select().from(schema.kardex).where(and(eq(schema.kardex.tipo, "TRANSFERENCIA"), eq(schema.kardex.documentoId, r.ventaId!)));
    expect(k.reduce((s, x) => s + x.salida, 0)).toBe(3);
    const [vencido] = await db.select().from(schema.lote).where(eq(schema.lote.id, F.lotes.vencido.id));
    expect(k.some((x) => x.loteId === vencido.id)).toBe(false);
    const camp = await db.select().from(schema.campana).where(eq(schema.campana.productoId, F.vit.id));
    expect(camp.some((c) => c.estado === "ACTIVA")).toBe(true);
    const [vista] = await listarTransferencias(db, F.admin, "APROBADA");
    expect(vista).toMatchObject({ totalVenta: 50, costoAdicional: 5 });
    await expect(aprobarTransferencia(db, F.admin, t.id, { vendedorId: F.caja2.id, medioPago: "TRANSFERENCIA", precios: [{ detalleId: t.items[0].id, precioUnitario: 15 }] })).rejects.toThrow(/ya fue/);
  });
  it("valida stock, precios, rechazo con comentario y avisa en el panel", async () => {
    await expect(registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Sur", motivo: "Pedido urgente", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id)).id, unidades: 999999 }] })).rejects.toThrow(/tiene/);
    await expect(registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Sur", motivo: "Pedido urgente", items: [{ productoId: 999999, loteId: F.lotes.lejano.id, unidades: 1 }] })).rejects.toThrow(/no existe/);
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Sur", motivo: "Pedido urgente", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 1)).id, unidades: 1 }] });
    await evaluarAlertas(db);
    expect((await alertasDelRol(db, ["ADMIN"])).conteos.find((c) => c.tipo === "TRANSFERENCIA_PENDIENTE")?.total).toBe(1);
    expect((await alertasDelRol(db, ["CAJERO"])).conteos.find((c) => c.tipo === "TRANSFERENCIA_PENDIENTE")).toBeUndefined();
    await expect(aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "TRANSFERENCIA", precios: [{ detalleId: 999999, precioUnitario: 1 }] })).rejects.toThrow(/Falta el precio/);
    const antes = await stockVit();
    await rechazarTransferencia(db, F.admin, r.id, { comentario: "La sucursal ya se abasteció" });
    expect(await stockVit()).toBe(antes);
    await evaluarAlertas(db);
    expect((await alertasDelRol(db, ["ADMIN"])).conteos.find((c) => c.tipo === "TRANSFERENCIA_PENDIENTE")?.total).toBe(0);
    await expect(eliminarUsuario(db, F.admin, F.caja1.id)).rejects.toThrow(/operaciones registradas/);
  });
});

describe("Transferencias con lote elegido", () => {
  it("descuenta solo del lote elegido aunque otro venza antes", async () => {
    const lotes = (await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id))).filter((l) => l.estado === "ACTIVO" && l.vencimiento > hoy() && l.cantidad > 0).sort((a, b) => (a.vencimiento < b.vencimiento ? -1 : 1));
    const ultimo = lotes.at(-1)!;
    const antes = new Map(lotes.map((l) => [l.id, l.cantidad]));
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Lote", motivo: "Pedido con lote fijo", items: [{ productoId: F.vit.id, loteId: ultimo.id, unidades: 1 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    expect(t.items[0]).toMatchObject({ loteId: ultimo.id, lote: ultimo.numero });
    await aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "TRANSFERENCIA", precios: [{ detalleId: t.items[0].id, precioUnitario: 10 }], motivoBajoCosto: "Precio de prueba" });
    const despues = new Map((await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id))).map((l) => [l.id, l.cantidad]));
    for (const l of lotes) expect(despues.get(l.id)).toBe(l.id === ultimo.id ? antes.get(l.id)! - 1 : antes.get(l.id));
  });
  it("rechaza lotes de otro producto, vencidos o con menos unidades", async () => {
    const base = { tipoDestino: "EMPRESA" as const, destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Lote", motivo: "Pedido con lote fijo" };
    await expect(registrarTransferencia(db, F.caja1, { ...base, items: [{ productoId: F.amox.id, loteId: F.lotes.lejano.id, unidades: 1 }] })).rejects.toThrow(/no pertenece/);
    await expect(registrarTransferencia(db, F.caja1, { ...base, items: [{ productoId: F.vit.id, loteId: F.lotes.vencido.id, unidades: 1 }] })).rejects.toThrow(/vencido/);
    const [l] = await db.select().from(schema.lote).where(eq(schema.lote.id, F.lotes.lejano.id));
    await expect(registrarTransferencia(db, F.caja1, { ...base, items: [{ productoId: F.vit.id, loteId: l.id, unidades: l.cantidad + 1 }] })).rejects.toThrow(/tiene/);
  });
});

describe("Transferencia como venta o como traslado", () => {
  const ventas = async () => (await db.select().from(schema.venta)).length;
  it("a otra farmacia: factura a su RUC, venta del vendedor elegido, fuera de caja y sin comisión", async () => {
    const [ses] = await db.select().from(schema.sesionCaja).where(eq(schema.sesionCaja.estado, "ABIERTA"));
    const esperado = await calcularEsperado(db, ses.id);
    const comisiones = (await db.select().from(schema.comision)).length;
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destino: "Farmacia Vecina SAC", destinoTipoDoc: "RUC" as const, destinoDoc: "20555555551", motivo: "Venta por volumen", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 4)).id, unidades: 4 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    await expect(aprobarTransferencia(db, F.admin, r.id, { precios: [{ detalleId: t.items[0].id, precioUnitario: 12 }], medioPago: "TRANSFERENCIA" })).rejects.toThrow(/atribuye/);
    const ap = await aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "TRANSFERENCIA", precios: [{ detalleId: t.items[0].id, precioUnitario: 12 }], motivoBajoCosto: "Precio de prueba" });
    expect(ap.factura).toMatch(/^F001-/);
    const [v] = await db.select().from(schema.venta).where(eq(schema.venta.id, ap.ventaId!));
    expect(v).toMatchObject({ usuarioId: F.caja2.id, canal: "TRANSFERENCIA", tipoComprobante: "FACTURA", sesionId: null, total: 48, cpeEstado: "PENDIENTE" });
    const [cli] = await db.select().from(schema.cliente).where(eq(schema.cliente.id, v.clienteId!));
    expect(cli).toMatchObject({ tipoDoc: "RUC", numero: "20555555551", nombre: "Farmacia Vecina SAC" });
    const det = await db.select().from(schema.ventaDetalle).where(eq(schema.ventaDetalle.ventaId, v.id));
    expect(det.reduce((s, d) => s + d.subtotal, 0)).toBeCloseTo(48, 2);
    expect(det.reduce((s, d) => s + d.unidades, 0)).toBe(4);
    expect((await listarVentas(db, F.caja2, 1)).some((x) => x.id === v.id)).toBe(true);
    expect((await listarVentas(db, F.caja1, 1)).some((x) => x.id === v.id)).toBe(false);
    const h = await historicoVentas(db, F.caja2, { anio: Number(hoy().slice(0, 4)) });
    expect(h.tickets).toBeGreaterThan(0);
    expect(await calcularEsperado(db, ses.id)).toEqual(esperado);
    expect((await db.select().from(schema.comision)).length).toBe(comisiones);
    const [vista] = (await listarTransferencias(db, F.caja1)).filter((x) => x.id === r.id);
    expect(vista).toMatchObject({ factura: ap.factura, vendedor: "Caja 2" });
    expect(vista).not.toHaveProperty("totalVenta");
  });
  it("anular la factura devuelve el stock y anula la transferencia", async () => {
    const [t] = (await listarTransferencias(db, F.admin, "APROBADA")).filter((x) => x.destino === "Farmacia Vecina SAC");
    const antes = (await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id))).reduce((a, l) => a + l.cantidad, 0);
    await anularVenta(db, F.admin, t.ventaId!, { motivo: "La farmacia devolvió todo" });
    expect((await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id))).reduce((a, l) => a + l.cantidad, 0)).toBe(antes + 4);
    expect((await listarTransferencias(db, F.admin)).find((x) => x.id === t.id)?.estado).toBe("ANULADA");
  });
  it("a una sucursal propia: traslado sin venta ni precio, sale a costo", async () => {
    const n = await ventas();
    expect(esquemaTransferencia.safeParse({ tipoDestino: "SUCURSAL", destino: "Sucursal Comas", motivo: "Reposición de local", items: [{ productoId: 1, loteId: 1, unidades: 1 }] }).success).toBe(true);
    expect(esquemaTransferencia.safeParse({ tipoDestino: "SUCURSAL", destino: "Sucursal Comas", motivo: "Reposición de local", items: [{ productoId: 1, unidades: 1 }] }).success).toBe(false);
    expect(esquemaTransferencia.safeParse({ tipoDestino: "EMPRESA", destino: "Farmacia X", motivo: "Venta por volumen", items: [{ productoId: 1, loteId: 1, unidades: 1 }] }).success).toBe(false);
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "SUCURSAL", destino: "Sucursal Comas", motivo: "Reposición de local", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 1)).id, unidades: 1 }] });
    const ap = await aprobarTransferencia(db, F.admin, r.id, {});
    expect(ap).toMatchObject({ ventaId: null, factura: null, totalVenta: null });
    expect(await ventas()).toBe(n);
    const k = await db.select().from(schema.kardex).where(and(eq(schema.kardex.tipo, "TRANSFERENCIA"), eq(schema.kardex.documentoTipo, "TRASLADO")));
    expect(k.reduce((s, x) => s + x.salida, 0)).toBe(1);
  });
  it("las ventas por transferencia no inflan la demanda que sugiere reponer", async () => {
    await evaluarAlertas(db);
    const antes = (await db.select().from(schema.alerta).where(eq(schema.alerta.clave, `STOCK:p:${F.vit.id}`)))[0]?.detalle;
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destino: "Farmacia Vecina SAC", destinoTipoDoc: "RUC" as const, destinoDoc: "20555555551", motivo: "Venta por volumen", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 2)).id, unidades: 2 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    await aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "EFECTIVO", precios: [{ detalleId: t.items[0].id, precioUnitario: 12 }], motivoBajoCosto: "Precio de prueba" });
    await evaluarAlertas(db);
    const despues = (await db.select().from(schema.alerta).where(eq(schema.alerta.clave, `STOCK:p:${F.vit.id}`)))[0]?.detalle;
    expect(despues?.match(/vende ([\d.]+)/)?.[1]).toBe(antes?.match(/vende ([\d.]+)/)?.[1]);
  });
});

describe("Transferencia a persona con DNI y referencias de precio", () => {
  it("con DNI emite boleta a nombre de la persona", async () => {
    expect(esquemaTransferencia.safeParse({ tipoDestino: "EMPRESA", destinoTipoDoc: "DNI", destinoDoc: "1234567", destino: "Juan Pérez", motivo: "Compra por volumen", items: [{ productoId: 1, loteId: 1, unidades: 1 }] }).success).toBe(false);
    expect(esquemaTransferencia.safeParse({ tipoDestino: "EMPRESA", destinoTipoDoc: "RUC", destinoDoc: "12345678", destino: "Juan Pérez", motivo: "Compra por volumen", items: [{ productoId: 1, loteId: 1, unidades: 1 }] }).success).toBe(false);
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "DNI", destinoDoc: "45678912", destino: "Juan Pérez Quispe", motivo: "Compra por volumen", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 1)).id, unidades: 1 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    const ap = await aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja1.id, medioPago: "EFECTIVO", precios: [{ detalleId: t.items[0].id, precioUnitario: 20 }] });
    expect(ap.comprobante).toBe("BOLETA");
    const [v] = await db.select().from(schema.venta).where(eq(schema.venta.id, ap.ventaId!));
    expect(v.tipoComprobante).toBe("BOLETA");
    expect(v.serie).toBe("B001");
    const [c] = await db.select().from(schema.cliente).where(eq(schema.cliente.id, v.clienteId!));
    expect(c).toMatchObject({ tipoDoc: "DNI", numero: "45678912" });
  });
  it("el propietario ve precio de lista y el costo del lote elegido en cada línea; el cajero no", async () => {
    const lotes = (await db.select().from(schema.lote).where(eq(schema.lote.productoId, F.vit.id))).filter((l) => l.estado === "ACTIVO" && l.vencimiento > hoy() && l.cantidad > 0).sort((a, b) => (a.vencimiento < b.vencimiento ? -1 : 1));
    const [primero, ultimo] = [lotes[0], lotes.at(-1)!];
    await db.update(schema.lote).set({ costoUnitario: 11 }).where(eq(schema.lote.id, ultimo.id));
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC", destinoDoc: "20555555551", destino: "Farmacia Vecina SAC", motivo: "Venta por volumen", items: [{ productoId: F.vit.id, loteId: primero.id, unidades: 1 }, { productoId: F.vit.id, loteId: ultimo.id, unidades: 1 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    const a = t.items.find((i) => i.loteId === primero.id)! as { precioActual?: number; costoActual?: number; lote: string | null; registroSanitario: string | null };
    const b = t.items.find((i) => i.loteId === ultimo.id)! as { precioActual?: number; costoActual?: number };
    expect(a.precioActual).toBe(F.pres.pvp);
    expect(a).toMatchObject({ lote: primero.numero, costoActual: primero.costoUnitario });
    expect("registroSanitario" in a).toBe(true);
    expect(b.costoActual).toBe(11);
    const [delCajero] = (await listarTransferencias(db, F.caja1)).filter((x) => x.id === r.id);
    expect(JSON.stringify(delCajero)).not.toMatch(/precio|costo/i);
    await rechazarTransferencia(db, F.admin, r.id, { comentario: "Solo era una prueba" });
  });
});

describe("Filtro de reportes por canal de venta", () => {
  it("separa mostrador y transferencia, suman el total, y solo el propietario puede usarlo", async () => {
    const q = { agrupar: "total", metricas: ["ventas", "tickets"], desde: sumarDias(hoy(), -30), hasta: hoy() };
    const total = await ejecutarReporte(db, ["ADMIN"], q);
    const mostrador = await ejecutarReporte(db, ["ADMIN"], { ...q, filtros: { canal: "MOSTRADOR" } });
    const transf = await ejecutarReporte(db, ["ADMIN"], { ...q, filtros: { canal: "TRANSFERENCIA" } });
    const v = (r: typeof total) => r.filas.reduce((s, f) => s + (f.valores.tickets ?? 0), 0);
    expect(v(transf)).toBeGreaterThan(0);
    expect(v(mostrador) + v(transf)).toBe(v(total));
    await expect(ejecutarReporte(db, ["CONTADOR"], { ...q, filtros: { canal: "TRANSFERENCIA" } })).rejects.toThrow(/solo está disponible para el propietario/);
    await expect(ejecutarReporte(db, ["ADMIN"], { ...q, filtros: { canal: "OTRO" } })).rejects.toThrow(/no válido/);
    await expect(ejecutarReporte(db, ["CONTADOR"], q)).resolves.toBeTruthy();
  });
});

describe("Apertura simple de una sola caja", () => {
  it("abre la caja principal con un monto digitado, sin elegir caja ni contar billetes", async () => {
    // Deja la caja libre sin depender de lo que hicieron las pruebas anteriores.
    await db.update(schema.sesionCaja).set({ estado: "CERRADA", cerradaEn: new Date() }).where(inArray(schema.sesionCaja.estado, ["ABIERTA", "EN_CIERRE"]));
    const s = await abrirCaja(db, F.qf, { turno: "TARDE", monto: 150 });
    expect(s).toMatchObject({ cajaId: F.cajas[0].id, fondoInicial: 150, conteoApertura: null });
    await expect(abrirCaja(db, F.caja1, { turno: "TARDE", monto: 80 })).rejects.toThrow(/abierta por QF/);
    await expect(abrirCaja(db, F.qf, { turno: "TARDE", monto: 80 })).rejects.toThrow(/Ya tienes/);
    for (const malo of [{ turno: "TARDE", monto: -5 }, { turno: "TARDE", monto: "cien" }, { turno: "X", monto: 10 }, { turno: "TARDE" }]) expect(esquemaApertura.safeParse(malo).success).toBe(false);
  });
  it("el efectivo esperado parte del monto de apertura y el cierre ya no pide dejar fondo", async () => {
    const [s] = await db.select().from(schema.sesionCaja).where(and(eq(schema.sesionCaja.usuarioId, F.qf.id), eq(schema.sesionCaja.estado, "ABIERTA")));
    const esp = await calcularEsperado(db, s.id);
    expect(esp.EFECTIVO).toBe(150);
    const r = await cerrarCaja(db, F.qf, { efectivo: 155.5 });
    expect(r).toMatchObject({ diferencia: 5.5, estado: "EN_CIERRE", observaciones: ["Sobrante de S/ 5.50 (tolerancia S/ 5.00)"] });
    const [cerrada] = await db.select().from(schema.sesionCaja).where(eq(schema.sesionCaja.id, s.id));
    expect(cerrada).toMatchObject({ estado: "EN_CIERRE", fondoSiguiente: null, retiro: 155.5, pagosNoConfirmados: [] });
    await expect(abrirCaja(db, F.caja1, { turno: "NOCHE", monto: 0 })).resolves.toMatchObject({ cajaId: F.cajas[0].id, fondoInicial: 0 });
  });
});

describe("Más vendidos del punto de venta", () => {
  it("ordena por tickets de mostrador y solo trae productos con stock vigente", async () => {
    const lista = await masVendidos(db, 12);
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < lista.length; i++) expect(lista[i - 1].tickets).toBeGreaterThanOrEqual(lista[i].tickets);
    for (const p of lista) { expect(p.stockVigente).toBeGreaterThan(0); expect(p.presentaciones.length).toBeGreaterThan(0); }
    const ventasTransfer = await db.select({ id: schema.venta.id }).from(schema.venta).where(eq(schema.venta.canal, "TRANSFERENCIA"));
    if (ventasTransfer.length) {
      const soloTransfer = await db.execute(sql`select d.producto_id from venta_detalle d join venta v on v.id = d.venta_id group by 1 having bool_and(v.canal = 'TRANSFERENCIA')`);
      const ids = new Set(((soloTransfer as unknown as { rows: { producto_id: number }[] }).rows ?? []).map((r) => r.producto_id));
      expect(lista.some((p) => ids.has(p.id))).toBe(false);
    }
  });
});

describe("Venta del administrador en campaña", () => {
  it("cobra el mismo precio que el cajero pero no genera comisión", async () => {
    const item = { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" as const }], tipoComprobante: "BOLETA" as const, pagos: [{ medio: "EFECTIVO" as const, monto: 18 }] };
    const comoAdmin = { ...F.caja1, roles: [...F.caja1.roles, "ADMIN" as Rol] };
    const deAdmin = await crearVenta(db, comoAdmin, item);
    expect(deAdmin.comisionVenta).toBe(0);
    expect(await db.select().from(schema.comision).where(eq(schema.comision.ventaId, deAdmin.id))).toHaveLength(0);
    const deCajero = await crearVenta(db, F.caja1, item);
    expect(deCajero.total).toBe(deAdmin.total);
    expect(deCajero.comisionVenta).toBeGreaterThan(0);
  });
});

describe("Precio de campaña", () => {
  it("cobra el precio de campaña, guarda la diferencia como descuento y comisiona sobre lo cobrado", async () => {
    const [prod] = await db.insert(schema.producto).values({ codigo: "PC-1", nombre: "Colágeno promo", costoPromedio: 5 }).returning();
    const [und, caja] = await db.insert(schema.presentacion).values([
      { productoId: prod.id, nombre: "Unidad", factor: 1, pvp: 10 },
      { productoId: prod.id, nombre: "Caja x10", factor: 10, pvp: 90 },
    ]).returning();
    const [lt] = await db.insert(schema.lote).values({ productoId: prod.id, numero: "PC-L1", vencimiento: sumarDias(hoy(), 300), costoUnitario: 5, cantidad: 50 }).returning();
    await db.insert(schema.kardex).values({ productoId: prod.id, loteId: lt.id, tipo: "INVENTARIO_INICIAL", documentoTipo: "INVENTARIO", entrada: 50, costoUnitario: 5, saldoUnidades: 50, costoPromedio: 5, saldoValorizado: 250, usuarioId: F.admin.id });
    const base = { codigo: "PC-1", nombre: "Colágeno noviembre", porcentaje: 10, inicio: hoy(), fin: sumarDias(hoy(), 10), activarAhora: true };
    await expect(crearCampana(db, F.admin, { ...base, precios: { [und.id]: 10 } })).rejects.toThrow(/menor al de lista/);
    await expect(crearCampana(db, F.admin, { ...base, loteId: lt.id, precios: { [und.id]: 8 } })).rejects.toThrow(/todo el producto/);
    await expect(crearCampana(db, F.admin, { ...base, precios: { [F.pres.id]: 1 } })).rejects.toThrow(/no pertenece/);
    await crearCampana(db, F.admin, { ...base, precios: { [und.id]: 8 } });

    const [enBusqueda] = await buscarProductos(db, "PC-1");
    expect(enBusqueda.presentaciones.map((x) => x.pvpCampana)).toEqual([8, null]);

    const v = await crearVenta(db, F.caja1, { items: [{ presentacionId: und.id, cantidad: 2, descuentoPct: 0, origen: "DIRECTA" }, { presentacionId: caja.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 106 }] });
    expect(v.total).toBe(106); // 2 × 8 (campaña) + 90 (caja sin precio de campaña)
    const [cab] = await db.select().from(schema.venta).where(eq(schema.venta.id, v.id));
    expect(cab.descuento).toBe(4);
    const det = await db.select().from(schema.ventaDetalle).where(and(eq(schema.ventaDetalle.ventaId, v.id), eq(schema.ventaDetalle.presentacionId, und.id)));
    expect(det[0]).toMatchObject({ precioUnitario: 10, descuento: 4, subtotal: 16 });
    // comisión 10% sobre lo cobrado sin IGV: (16 + 90) / 1.18 × 10%
    expect(v.comisionVenta).toBeCloseTo(r2t((16 / 1.18) * 0.1) + r2t((90 / 1.18) * 0.1), 2);
  });
});
const r2t = (n: number) => Math.round(n * 100) / 100;

describe("Accesos rápidos del panel", () => {
  it("sin historial propone secciones de partida que el perfil puede abrir", async () => {
    expect((await accesosFrecuentes(db, F.caja1)).map((a) => a.href)).toEqual(["/vender", "/caja", "/ventas", "/productos"]);
    const almacen = (await accesosFrecuentes(db, F.almacen)).map((a) => a.href);
    expect(almacen).not.toContain("/vender");
    expect(almacen.length).toBeLessThanOrEqual(4);
  });
  it("ordena por uso, cuenta subpáginas en su sección e ignora lo que el perfil no puede abrir", async () => {
    for (let i = 0; i < 5; i++) await registrarUso(db, F.qf, "/kardex");
    for (let i = 0; i < 3; i++) await registrarUso(db, F.qf, "/transferencias");
    await registrarUso(db, F.qf, "/caja/reporte/12");
    await registrarUso(db, F.qf, "/caja");
    expect(await registrarUso(db, F.qf, "/usuarios")).toEqual({ registrado: false });
    expect(await registrarUso(db, F.qf, "/")).toEqual({ registrado: false });
    const a = await accesosFrecuentes(db, F.qf);
    expect(a.map((x) => [x.href, x.visitas])).toEqual([["/kardex", 5], ["/transferencias", 3], ["/caja", 2], ["/vender", 0]]);
    const p = await panel(db, F.qf);
    expect(p.accesos).toHaveLength(4);
  });
});

describe("Meta del día y mensajes motivacionales", () => {
  it("usa la meta fijada por el administrador y la devuelve con cada venta", async () => {
    await db.update(schema.usuario).set({ metaDiaria: 1000 }).where(eq(schema.usuario.id, F.caja1.id));
    const antes = await metaDelDia(db, F.caja1.id);
    expect(antes).toMatchObject({ objetivo: 1000, automatica: false });
    const v = await crearVenta(db, F.caja1, { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 50 }] });
    expect(v.meta.vendido).toBeCloseTo(antes.vendido + v.total, 2);
    expect(v.meta.porcentaje).toBeCloseTo((v.meta.vendido / 1000) * 100, 1);
    expect(v.meta.faltante).toBeCloseTo(1000 - v.meta.vendido, 2);
  });
  it("sin meta fijada y sin historial no inventa una meta", async () => {
    await db.update(schema.usuario).set({ metaDiaria: null }).where(eq(schema.usuario.id, F.almacen.id));
    expect(await metaDelDia(db, F.almacen.id)).toMatchObject({ objetivo: null, porcentaje: null, automatica: false });
  });
  it("calcula la meta automática con el promedio de días anteriores + 10 %", async () => {
    await db.update(schema.usuario).set({ metaDiaria: null }).where(eq(schema.usuario.id, F.caja1.id));
    const ayer = new Date(Date.now() - 86400000);
    const [v] = await db.select().from(schema.venta).where(eq(schema.venta.usuarioId, F.caja1.id)).limit(1);
    await db.update(schema.venta).set({ fecha: ayer }).where(eq(schema.venta.id, v.id));
    const m = await metaDelDia(db, F.caja1.id);
    expect(m.automatica).toBe(true);
    expect(m.objetivo! % 10).toBe(0);
    expect(m.objetivo!).toBeGreaterThanOrEqual(10);
  });
  it("el mensaje cambia según el avance y no repite el anterior", () => {
    const meta = (vendido: number) => ({ objetivo: 100, vendido, porcentaje: vendido, faltante: Math.max(0, 100 - vendido), automatica: false });
    expect(mensajeMotivacional(meta(105), "Ana Pérez", 10)).toMatch(/cumpliste tu meta del día, Ana/);
    const casi = mensajeMotivacional(meta(80), "Ana Pérez", 5);
    expect(["Ya casi", "recta final", "muy cerca", "empujón"].some((t) => casi.includes(t))).toBe(true);
    for (let i = 0; i < 20; i++) { const a = mensajeMotivacional(meta(30), "Ana", 1); expect(mensajeMotivacional(meta(30), "Ana", 1, a)).not.toBe(a); }
    expect(mensajeMotivacional(null, "Ana", 10)).toMatch(/\S/);
  });
});

describe("Alerta de productos en campaña", () => {
  it("avisa a quienes venden, no al administrador", async () => {
    await evaluarAlertas(db);
    const cajero = await alertasDelRol(db, ["CAJERO"]);
    const conteo = cajero.conteos.find((c) => c.tipo === "CAMPANA_ACTIVA");
    expect(conteo?.total).toBeGreaterThan(0);
    const lista = await alertasDelRol(db, ["CAJERO"], { tipo: "CAMPANA_ACTIVA", limite: 50 });
    expect(lista.alertas.every((a) => /Comisiona \d/.test(a.detalle))).toBe(true);
    const admin = await alertasDelRol(db, ["ADMIN"]);
    expect(admin.conteos.some((c) => c.tipo === "CAMPANA_ACTIVA")).toBe(false);
  });
});

describe("Recordatorio de campañas a quien no está vendiendo", () => {
  it("recuerda los productos en campaña tras el tiempo sin vender, solo con la caja abierta", async () => {
    await db.update(schema.sesionCaja).set({ estado: "CERRADA", cerradaEn: new Date() }).where(inArray(schema.sesionCaja.estado, ["ABIERTA", "EN_CIERRE"]));
    expect(await recordatorioCampanas(db, F.caja1)).toMatchObject({ activo: false, motivo: "SIN_CAJA" });
    const s = await abrirCaja(db, F.caja1, { turno: "TARDE", monto: 0 });
    const vigentes = await campanasVigentes(db);
    expect(vigentes.length).toBeGreaterThan(0);
    expect(vigentes.every((c) => c.vigente > 0)).toBe(true);
    const pronto = await recordatorioCampanas(db, F.caja1, new Date(s.abiertaEn.getTime() + 5 * 60000));
    expect(pronto).toMatchObject({ activo: true, umbralMin: 15, minutosSinVender: 5, debeRecordar: false });
    const tarde = await recordatorioCampanas(db, F.caja1, new Date(s.abiertaEn.getTime() + 20 * 60000));
    expect(tarde).toMatchObject({ activo: true, minutosSinVender: 20, debeRecordar: true });
    if (!tarde.activo) throw new Error("debía estar activo");
    expect(tarde.productos.length).toBeGreaterThan(0);
    expect(tarde.productos.length).toBeLessThanOrEqual(5);
    expect(tarde.productos[0].porcentaje).toBeGreaterThan(0);
    // Quien no vende no recibe el recordatorio; y el administrador puede apagarlo con 0 minutos.
    expect(await recordatorioCampanas(db, F.admin)).toMatchObject({ activo: false });
    expect(await recordatorioCampanas(db, F.almacen)).toMatchObject({ activo: false });
    await db.insert(schema.parametro).values({ clave: "recordatorio_campana_min", valor: "0" });
    expect(await recordatorioCampanas(db, F.caja1, new Date(s.abiertaEn.getTime() + 90 * 60000))).toMatchObject({ debeRecordar: false });
    await db.delete(schema.parametro).where(eq(schema.parametro.clave, "recordatorio_campana_min"));
  });
});

describe("Venta bajo costo solo por decisión del administrador", () => {
  it("la transferencia bajo costo exige motivo y queda en la auditoría", async () => {
    const t0 = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Liquidación", motivo: "Recuperar inversión", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 1)).id, unidades: 1 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === t0.id);
    const costo = t.items[0].costoActual!;
    expect(costo).toBeGreaterThan(0.02);
    const base = { vendedorId: F.caja1.id, medioPago: "EFECTIVO" as const, precios: [{ detalleId: t.items[0].id, precioUnitario: 0.01 }] };
    await expect(aprobarTransferencia(db, F.admin, t.id, base)).rejects.toThrow(/debajo del costo/);
    await expect(aprobarTransferencia(db, F.qf, t.id, { ...base, motivoBajoCosto: "Liquidación por vencer" })).rejects.toThrow(/Solo el administrador/);
    const r = await aprobarTransferencia(db, F.admin, t.id, { ...base, motivoBajoCosto: "Liquidación por vencer" });
    expect(r.estado).toBe("APROBADA");
    const [aud] = await db.select().from(schema.auditoria).where(and(eq(schema.auditoria.accion, "APROBAR_TRANSFERENCIA"), eq(schema.auditoria.entidadId, t.id)));
    expect(aud.detalle).toMatchObject({ motivoBajoCosto: "Liquidación por vencer" });
    expect((aud.detalle as { bajoCosto: unknown[] }).bajoCosto).toHaveLength(1);
    // A precio de costo + IGV (o más) no pide nada.
    const t1 = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC" as const, destinoDoc: "20100000011", destino: "Botica Norte", motivo: "Pedido normal", items: [{ productoId: F.vit.id, loteId: (await loteVigente(F.vit.id, 1)).id, unidades: 1 }] });
    const [p1] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === t1.id);
    const minimo = Math.ceil(p1.items[0].costoActual! * 1.18 * 100) / 100;
    await expect(aprobarTransferencia(db, F.admin, t1.id, { ...base, precios: [{ detalleId: p1.items[0].id, precioUnitario: minimo }] })).resolves.toMatchObject({ estado: "APROBADA" });
  });
  it("el vendedor no puede dejar un producto bajo costo con un descuento", async () => {
    await expect(crearVenta(db, F.caja1, { items: [{ presentacionId: F.pres.id, cantidad: 1, descuentoPct: 99, origen: "DIRECTA" }], tipoComprobante: "NOTA_VENTA", pagos: [{ medio: "EFECTIVO", monto: 1 }] }))
      .rejects.toThrow(/Solo el administrador puede vender bajo costo/);
  });
});

describe("Cuota de venta del mes", () => {
  const mes = hoy().slice(0, 7);
  it("guarda la cuota de la botica y de cada vendedor y calcula el avance", async () => {
    const r = await guardarMetasMes(db, F.admin, { mes, botica: 1000, vendedores: [{ usuarioId: F.caja1.id, metaMes: 500, metaDiaria: 80 }, { usuarioId: F.caja2.id, metaMes: null }] });
    const [{ total }] = await filas<{ total: number }>(db, sql`select coalesce(sum(total - delivery),0)::float as total from venta where estado = 'EMITIDA' and to_char(fecha at time zone 'America/Lima', 'YYYY-MM') = ${mes}`);
    expect(r.botica.meta).toBe(1000);
    expect(r.botica.vendido).toBeCloseTo(Number(total), 2);
    expect(r.botica.faltante).toBe(Math.max(0, Math.round((1000 - Number(total)) * 100) / 100));
    const c1 = r.vendedores.find((v) => v.usuarioId === F.caja1.id)!;
    expect(c1).toMatchObject({ meta: 500, metaDiaria: 80 });
    expect(r.vendedores.find((v) => v.usuarioId === F.caja2.id)!.meta).toBeNull();
    expect(r.vendedores.some((v) => v.usuarioId === F.almacen.id)).toBe(false);
    expect(r.sumaVendedores).toBe(500);
    expect((await avanceDelMes(db, null))?.meta).toBe(1000);
    expect((await avanceDelMes(db, F.caja1.id))?.meta).toBe(500);
    expect(await avanceDelMes(db, F.caja2.id)).toBeNull();
    // Guardar de nuevo reemplaza: sin cuota de botica, se borra.
    const r2 = await guardarMetasMes(db, F.admin, { mes, botica: null, vendedores: [{ usuarioId: F.caja1.id, metaMes: 600 }] });
    expect(r2.botica.meta).toBeNull();
    expect((await metasDelMes(db, mes)).vendedores.find((v) => v.usuarioId === F.caja1.id)).toMatchObject({ meta: 600, metaDiaria: 80 });
  });
  it("rechaza metas inválidas y a quien no vende", async () => {
    await expect(guardarMetasMes(db, F.admin, { mes, botica: null, vendedores: [{ usuarioId: F.almacen.id, metaMes: 100 }] })).rejects.toThrow(/Solo se asignan/);
    for (const malo of [{ mes: "2026-13", botica: 10, vendedores: [] }, { mes, botica: 0, vendedores: [] }, { mes, botica: -5, vendedores: [] }]) expect(esquemaMetasMes.safeParse(malo).success).toBe(false);
  });
  it("muestra el cumplimiento mes a mes del año", async () => {
    const anio = Number(mes.slice(0, 4));
    const r = await cumplimientoCuotas(db, F.admin, { anio, usuarioId: F.caja1.id });
    expect(r.meses).toHaveLength(12);
    const actual = r.meses.find((m) => m.mes === mes)!;
    expect(actual.meta).toBe(600);
    expect(["EN_CURSO", "CUMPLIDA"]).toContain(actual.estado);
    expect(r.resumen.mesesConCuota).toBe(1);
    expect(r.opciones.some((o) => o.usuarioId === F.caja2.id)).toBe(true);
    const propio = await cumplimientoCuotas(db, F.caja1, { anio, usuarioId: F.caja1.id });
    expect(propio.opciones.map((o) => o.usuarioId)).toEqual([null, F.caja1.id]);
    await expect(cumplimientoCuotas(db, F.caja1, { anio, usuarioId: F.caja2.id })).rejects.toThrow(/propia cuota/);
    const siguiente = await cumplimientoCuotas(db, F.admin, { anio: anio + 1, usuarioId: null });
    expect(siguiente.meses.every((m) => m.estado === "PENDIENTE")).toBe(true);
  });
});

describe("Autoaprobación de salidas y entradas del administrador", () => {
  const motivoSalida = async () => (await db.select().from(schema.motivo).where(and(eq(schema.motivo.tipo, "SALIDA"), eq(schema.motivo.requiereAprobacion, true))))[0];
  let loteId = 0;
  beforeAll(async () => {
    const [l] = await db.select().from(schema.lote).where(and(eq(schema.lote.estado, "ACTIVO"), sql`${schema.lote.cantidad} >= 10`)).orderBy(schema.lote.id).limit(1);
    loteId = l.id;
  });
  const cantidad = async (id: number) => (await db.select().from(schema.lote).where(eq(schema.lote.id, id)))[0].cantidad;
  it("el administrador registra y aprueba en un paso: el stock se descuenta al instante", async () => {
    const m = await motivoSalida();
    const antes = await cantidad(loteId);
    const r = await registrarMovimiento(db, F.admin, { motivoId: m.id, descripcion: "Baja directa del administrador", evidencia: "Acta 9", items: [{ loteId: loteId, unidades: 1 }], autoaprobar: true });
    expect(r).toMatchObject({ estado: "APROBADA", requiereAprobacion: false, autoaprobado: true });
    expect(await cantidad(loteId)).toBe(antes - 1);
    const [mov] = await db.select().from(schema.movimientoInventario).where(eq(schema.movimientoInventario.id, r.id));
    expect(mov.aprobadoPor).toBe(F.admin.id);
    const [aud] = await db.select().from(schema.auditoria).where(and(eq(schema.auditoria.accion, "AUTOAPROBAR_MOVIMIENTO"), eq(schema.auditoria.entidadId, r.id)));
    expect(aud).toBeTruthy();
  });
  it("el administrador puede autoaprobar o anular desde la bandeja lo que él registró; los demás no", async () => {
    const m = await motivoSalida();
    const antes = await cantidad(loteId);
    const p = await registrarMovimiento(db, F.admin, { motivoId: m.id, descripcion: "Baja pendiente del administrador", evidencia: "Acta 10", items: [{ loteId: loteId, unidades: 1 }] });
    expect(p.estado).toBe("PENDIENTE");
    const [enLista] = (await listarMovimientos(db, F.admin, "PENDIENTE")).filter((x) => x.id === p.id);
    expect(enLista).toMatchObject({ puedoAprobar: false, puedoAutoaprobar: true });
    await decidirMovimiento(db, F.admin, p.id, { decision: "APROBAR" });
    expect(await cantidad(loteId)).toBe(antes - 1);
    const otra = await registrarMovimiento(db, F.admin, { motivoId: m.id, descripcion: "Baja que se anula después", evidencia: "Acta 11", items: [{ loteId: loteId, unidades: 1 }] });
    await decidirMovimiento(db, F.admin, otra.id, { decision: "RECHAZAR", comentario: "Registrada por error" });
    expect(await cantidad(loteId)).toBe(antes - 1);
    // Quien no es administrador sigue sin poder autoaprobar.
    await expect(registrarMovimiento(db, F.qf, { motivoId: m.id, descripcion: "Intento de autoaprobación", evidencia: "Acta 12", items: [{ loteId: loteId, unidades: 1 }], autoaprobar: true })).rejects.toThrow(/Solo el administrador/);
    const q = await registrarMovimiento(db, F.qf, { motivoId: m.id, descripcion: "Baja del químico farmacéutico", evidencia: "Acta 13", items: [{ loteId: loteId, unidades: 1 }] });
    expect((await listarMovimientos(db, F.qf, "PENDIENTE")).find((x) => x.id === q.id)?.puedoAutoaprobar).toBe(false);
    await expect(decidirMovimiento(db, F.qf, q.id, { decision: "APROBAR" })).rejects.toThrow(/RN-09/);
  });
});

describe("Reportes con filtros rápidos y columnas", () => {
  it("cada reporte especial declara sus columnas y filtros, y oculta costos a quien no los ve", async () => {
    for (const id of ["por-vencer", "stock-critico", "salidas-motivo", "cierres-caja"]) {
      const r = await reporteEspecial(db, F.admin, id, {});
      expect(r.columnas.length).toBeGreaterThan(2);
      expect(r.filtros.length).toBeGreaterThan(0);
      for (const fila of r.filas) for (const c of r.columnas) expect(c.codigo in fila).toBe(true);
    }
    const venc = await reporteEspecial(db, F.qf, "por-vencer", { desde: "2000-01-01", hasta: hoy() });
    expect(venc.columnas.some((c) => c.codigo === "costoTotal")).toBe(false);
    expect(venc.filas.every((f) => !("costoTotal" in f) && Number(f.dias) <= 0)).toBe(true);
    const admin = await reporteEspecial(db, F.admin, "por-vencer", { desde: hoy(), hasta: sumarDias(hoy(), 90) });
    expect(admin.columnas.some((c) => c.codigo === "costoTotal")).toBe(true);
    expect(admin.filas.every((f) => Number(f.dias) >= 0 && Number(f.dias) <= 90)).toBe(true);
  });
  it("las ventas se filtran por laboratorio", async () => {
    const [p] = await db.select().from(schema.producto).where(eq(schema.producto.id, F.vit.id));
    const todos = await ejecutarReporte(db, ["ADMIN"], { agrupar: "laboratorio", metricas: ["ventas"], desde: sumarDias(hoy(), -365), hasta: hoy() });
    if (!p.laboratorioId) return;
    const uno = await ejecutarReporte(db, ["ADMIN"], { agrupar: "laboratorio", metricas: ["ventas"], desde: sumarDias(hoy(), -365), hasta: hoy(), filtros: { laboratorioId: String(p.laboratorioId) } });
    expect(uno.filas.length).toBeLessThanOrEqual(1);
    expect(todos.filas.length).toBeGreaterThanOrEqual(uno.filas.length);
  });
});

describe("Cierre con observaciones: aprobación y regularización de pagos", () => {
  it("queda por aprobar, no bloquea el siguiente turno y el administrador completa cada pago no confirmado", async () => {
    await db.update(schema.sesionCaja).set({ estado: "CERRADA", cerradaEn: new Date() }).where(inArray(schema.sesionCaja.estado, ["ABIERTA", "EN_CIERRE"]));
    const lote = async () => (await db.select().from(schema.lote).where(eq(schema.lote.id, F.lotes.loteAmox.id)))[0].cantidad;
    const stock0 = await lote();
    const s = await abrirCaja(db, F.caja2, { turno: "NOCHE", monto: 100 });
    const vender = (cantidad: number, medio: "YAPE" | "PLIN" | "TARJETA", monto: number) =>
      crearVenta(db, F.caja2, { items: [{ presentacionId: F.presAmox.id, cantidad, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "NOTA_VENTA", pagos: [{ medio, monto }] });
    const yape = await vender(1, "YAPE", 6);
    const plin = await vender(2, "PLIN", 12);
    const tarjeta = await vender(1, "TARJETA", 6);
    await movimientoDeCaja(db, F.caja2, { tipo: "INGRESO", concepto: "Otro ingreso", medio: "YAPE", monto: 10 });
    expect(await lote()).toBe(stock0 - 40);

    const noLlegaron = Object.fromEntries((await pagosVirtuales(db, s.id)).map((v) => [v.clave, 0]));
    const r = await cerrarCaja(db, F.caja2, { efectivo: 100, noCuadran: noLlegaron });
    expect(r).toMatchObject({ estado: "EN_CIERRE", requiereValidacion: true, diferencia: -34 });
    expect(r.observaciones).toHaveLength(5);
    expect((await estadoCaja(db, F.caja2)).porAprobar.map((x) => x.id)).toEqual([s.id]);
    // El cierre por aprobar no bloquea la caja: el siguiente turno abre; si cuadra, cierra directo.
    await abrirCaja(db, F.qf, { turno: "NOCHE", monto: 0 });
    expect(await cerrarCaja(db, F.qf, { efectivo: 0 })).toMatchObject({ estado: "CERRADA", requiereValidacion: false });

    const clave = (ref: string) => {
      const v = virt.find((x) => x.referencia === ref);
      if (!v) throw new Error(`sin ${ref}`);
      return v.clave;
    };
    const virt = await pagosVirtuales(db, s.id);
    const ingreso = virt.find((v) => v.origen === "Ingreso")!.clave;
    await expect(regularizarPago(db, F.caja2, s.id, { accion: "CONFIRMAR", clave: clave(`NV01-${yape.numero}`), operacion: "123456" })).rejects.toThrow(/administrador/);
    expect(esquemaRegularizacion.safeParse({ accion: "CONFIRMAR", clave: "V1", operacion: "" }).success).toBe(false);

    // 1. El Yape sí llegó: se confirma con el n.º de operación.
    expect(await regularizarPago(db, F.admin, s.id, { accion: "CONFIRMAR", clave: clave(`NV01-${yape.numero}`), operacion: "OP-778899" })).toMatchObject({ diferencia: -28, pendientes: 3 });
    await expect(regularizarPago(db, F.admin, s.id, { accion: "CONFIRMAR", clave: clave(`NV01-${yape.numero}`), operacion: "OP-778899" })).rejects.toThrow(/ya está/);
    // 2. La "tarjeta" en realidad se pagó en efectivo, pero ese efectivo no estaba en el cajón: el faltante pasa al efectivo.
    expect(await regularizarPago(db, F.admin, s.id, { accion: "CAMBIAR_MEDIO", clave: clave(`NV01-${tarjeta.numero}`), medio: "EFECTIVO", comentario: "El cliente pagó en efectivo" })).toMatchObject({ diferencia: -28, pendientes: 2 });
    // 3. El Plin nunca llegó: se anula la venta y el stock vuelve.
    expect(await regularizarPago(db, F.admin, s.id, { accion: "ANULAR_VENTA", clave: clave(`NV01-${plin.numero}`), comentario: "El cliente no completó el pago" })).toMatchObject({ diferencia: -16, pendientes: 1 });
    expect(await lote()).toBe(stock0 - 20);
    await expect(regularizarPago(db, F.admin, s.id, { accion: "ANULAR_VENTA", clave: ingreso, comentario: "No es una venta" })).rejects.toThrow(/Solo se anulan ventas/);
    // 4. El ingreso fue una venta sin registrar: se cargan los productos y la vendedora; cuadra al monto cobrado.
    const items = [{ presentacionId: F.presAmox.id, cantidad: 2, descuentoPct: 0, origen: "DIRECTA" as const }];
    await expect(regularizarPago(db, F.admin, s.id, { accion: "CONVERTIR_EN_VENTA", clave: ingreso, vendedorId: F.caja2.id, tipoComprobante: "NOTA_VENTA", items: [{ ...items[0], cantidad: 1 }] })).rejects.toThrow(/Agrega los productos/);
    const conv = await regularizarPago(db, F.admin, s.id, { accion: "CONVERTIR_EN_VENTA", clave: ingreso, vendedorId: F.caja2.id, tipoComprobante: "NOTA_VENTA", items, operacion: "OP-1111" });
    expect(conv).toMatchObject({ accion: "CONVERTIDO_EN_VENTA", diferencia: -6, pendientes: 0 });
    expect(await lote()).toBe(stock0 - 40);
    const [nueva] = await db.select().from(schema.venta).where(eq(schema.venta.id, conv.ventaId!));
    expect(nueva).toMatchObject({ usuarioId: F.caja2.id, sesionId: s.id, total: 10, descuento: 2, estado: "EMITIDA" });
    const [mov] = await db.select().from(schema.movimientoCaja).where(eq(schema.movimientoCaja.sesionId, s.id));
    expect(mov.ventaId).toBe(nueva.id);

    const rep = await reporteCierre(db, F.admin, s.id);
    expect(rep.regularizaciones.map((g) => g.accion)).toEqual(["CONFIRMADO", "CAMBIO_MEDIO", "VENTA_ANULADA", "CONVERTIDO_EN_VENTA"]);
    expect(rep.movimientos).toHaveLength(0);
    expect(rep.transacciones.some((t) => t.ventaId === nueva.id && t.usuario === "Caja 2")).toBe(true);
    expect(rep.virtuales.find((v) => v.ventaId === nueva.id)?.regularizacion?.accion).toBe("CONVERTIDO_EN_VENTA");
    expect(rep.arqueo.find((a) => a.medio === "EFECTIVO")).toMatchObject({ esperado: 106, contado: 100, diferencia: -6 });
    expect(rep.observaciones).toEqual(["Faltante de S/ 6.00 (tolerancia S/ 5.00)"]);

    // Aprobación: solo el administrador y con la observación detallada; la del cajero se conserva.
    expect(esquemaValidacion.safeParse({ sesionId: s.id, observacion: "ok" }).success).toBe(false);
    await expect(validarCierre(db, F.caja2, { sesionId: s.id, observacion: "Lo reviso yo mismo" })).rejects.toThrow(/administrador/);
    expect(await validarCierre(db, F.admin, { sesionId: s.id, observacion: "Faltante de S/ 6 descontado al cajero; pagos revisados" })).toMatchObject({ estado: "CERRADA" });
    const [fin] = await db.select().from(schema.sesionCaja).where(eq(schema.sesionCaja.id, s.id));
    expect(fin).toMatchObject({ estado: "CERRADA", validadoPor: F.admin.id, observacionValidacion: "Faltante de S/ 6 descontado al cajero; pagos revisados", diferencia: -6 });
    expect(fin.validadoEn).toBeTruthy();
  });
});

describe("Pagos virtuales que no cuadran al cerrar", () => {
  it("lo no marcado está conforme; solo se marca lo que no cuadra con el monto registrado y va a aprobación", async () => {
    await db.update(schema.sesionCaja).set({ estado: "CERRADA", cerradaEn: new Date() }).where(inArray(schema.sesionCaja.estado, ["ABIERTA", "EN_CIERRE"]));
    const turno = async (noCuadran: (claves: string[]) => Record<string, number>, egresoYape = 0) => {
      const s = await abrirCaja(db, F.caja1, { turno: "TARDE", monto: 50 });
      for (const monto of [12, 6]) await crearVenta(db, F.caja1, { items: [{ presentacionId: F.presAmox.id, cantidad: monto / 6, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "NOTA_VENTA", pagos: [{ medio: "YAPE", monto }] });
      if (egresoYape) await movimientoDeCaja(db, F.caja1, { tipo: "EGRESO", concepto: "Movilidad", medio: "YAPE", monto: egresoYape });
      const claves = (await pagosVirtuales(db, s.id)).map((v) => v.clave);
      return cerrarCaja(db, F.caja1, { efectivo: 50, noCuadran: noCuadran(claves) });
    };
    // Nada marcado: todo conforme (y un egreso pagado por Yape no descuadra). Se cierra sin aprobación.
    expect(await turno(() => ({}), 4)).toMatchObject({ estado: "CERRADA", diferencia: 0, observaciones: [], virtual: { sistema: 14, declarado: 14, noCuadran: 0 } });
    // Marcado pero con el mismo monto: sigue conforme.
    expect(await turno(([a]) => ({ [a]: 12 }))).toMatchObject({ estado: "CERRADA", diferencia: 0 });
    // El primero se registró con S/ 3 de más: dentro de la tolerancia total, pero lo virtual debe cuadrar por transacción.
    const sobra = await turno(([a]) => ({ [a]: 15 }));
    expect(sobra).toMatchObject({ estado: "EN_CIERRE", diferencia: 3 });
    expect(sobra.observaciones).toEqual([expect.stringMatching(/^NV01-\d+ · Yape: se registró S\/ 15\.00 de S\/ 12\.00 \(sobran S\/ 3\.00\)$/)]);
    // El primero no llegó y el segundo llegó incompleto.
    const falta = await turno(([a, b]) => ({ [a]: 0, [b]: 4 }));
    expect(falta).toMatchObject({ estado: "EN_CIERRE", diferencia: -14, virtual: { sistema: 18, declarado: 4, noCuadran: 2 } });
    expect(falta.observaciones).toHaveLength(3);
    expect(falta.observaciones[1]).toMatch(/no llegó \(S\/ 12\.00\)/);
    const rep = await reporteCierre(db, F.admin, falta.sesionId);
    expect(rep.virtuales.map((v) => [v.confirmado, v.recibido])).toEqual([[false, 0], [false, 4]]);
    // Al regularizar: el primero sí llegó (suma 12); del segundo solo suma lo que faltaba (2).
    expect(await regularizarPago(db, F.admin, falta.sesionId, { accion: "CONFIRMAR", clave: rep.virtuales[0].clave, operacion: "OP-1" })).toMatchObject({ diferencia: -2, pendientes: 1 });
    expect(await regularizarPago(db, F.admin, falta.sesionId, { accion: "CONFIRMAR", clave: rep.virtuales[1].clave, operacion: "OP-2" })).toMatchObject({ diferencia: 0, pendientes: 0 });
    expect(await validarCierre(db, F.admin, { sesionId: falta.sesionId, observacion: "Ambos Yape verificados en el estado de cuenta" })).toMatchObject({ estado: "CERRADA" });
    expect(esquemaCierre.safeParse({ efectivo: 10, noCuadran: { V1: -1 } }).success).toBe(false);
  });
});

describe("Emisión manual ante SUNAT", () => {
  it("con SUNAT_MODO=manual (o sin definir) no se envía nada ni quedan comprobantes pendientes", async () => {
    const antes = process.env.SUNAT_MODO;
    try {
      for (const modo of ["manual", ""]) {
        process.env.SUNAT_MODO = modo;
        expect(await enviarCpe("BOLETA")).toBe("NO_APLICA");
        expect(await enviarCpe("FACTURA")).toBe("NO_APLICA");
        expect(estadoInicialCpe()).toBe("NO_APLICA");
      }
      process.env.SUNAT_MODO = "manual";
      await db.update(schema.venta).set({ cpeEstado: "PENDIENTE", fecha: new Date(Date.now() - 3 * 3600 * 1000) }).where(eq(schema.venta.tipoComprobante, "FACTURA"));
      await evaluarAlertas(db);
      expect((await alertasDelRol(db, ["ADMIN"], { tipo: "CPE_PENDIENTE" })).alertas).toHaveLength(0);
    } finally { process.env.SUNAT_MODO = antes; }
  });
});

describe("Regularización del efectivo del cierre", () => {
  it("dinero completado, cargo al cajero, recuento y sobrante; el cargo se paga después", async () => {
    await db.update(schema.sesionCaja).set({ estado: "CERRADA", cerradaEn: new Date() }).where(inArray(schema.sesionCaja.estado, ["ABIERTA", "EN_CIERRE"]));
    const turno = async (efectivoDeclarado: (esperado: number) => number) => {
      const s = await abrirCaja(db, F.caja1, { turno: "NOCHE", monto: 100 });
      await crearVenta(db, F.caja1, { items: [{ presentacionId: F.presAmox.id, cantidad: 5, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "NOTA_VENTA", pagos: [{ medio: "EFECTIVO", monto: 50 }] });
      const esp = await calcularEsperado(db, s.id);
      return cerrarCaja(db, F.caja1, { efectivo: efectivoDeclarado(esp.EFECTIVO) });
    };
    // Faltan S/ 10 por un mal vuelto.
    const c = await turno((e) => e - 10);
    expect(c).toMatchObject({ estado: "EN_CIERRE", diferencia: -10 });
    await expect(regularizarEfectivo(db, F.caja1, c.sesionId, { accion: "REPOSICION", monto: 4, comentario: "Lo repongo yo" })).rejects.toThrow(/administrador/);
    expect(esquemaRegularizacionEfectivo.safeParse({ accion: "CARGO_CAJERO", monto: 5, comentario: "" }).success).toBe(false);
    // El cajero trae S/ 4: la diferencia baja.
    const r1 = await regularizarEfectivo(db, F.admin, c.sesionId, { accion: "REPOSICION", monto: 4, comentario: "El cajero completó S/ 4" });
    expect(r1).toMatchObject({ diferencia: -6, efectivo: { diferencia: -6, porRegularizar: -6 } });
    await expect(regularizarEfectivo(db, F.admin, c.sesionId, { accion: "REPOSICION", monto: 7, comentario: "De más" })).rejects.toThrow(/faltante por regularizar es S\/ 6\.00/);
    await expect(regularizarEfectivo(db, F.admin, c.sesionId, { accion: "SOBRANTE_INGRESO", monto: 1, comentario: "No aplica" })).rejects.toThrow(/sobrante/);
    // Los S/ 6 restantes no se recuperan: cargo al cajero. El efectivo no cambia, pero ya no queda nada por regularizar.
    const r2 = await regularizarEfectivo(db, F.admin, c.sesionId, { accion: "CARGO_CAJERO", monto: 6, comentario: "Vuelto mal dado, lo asume el cajero" });
    expect(r2).toMatchObject({ diferencia: -6, efectivo: { contado: expect.any(Number), diferencia: -6, porRegularizar: 0 } });
    const rep = await reporteCierre(db, F.admin, c.sesionId);
    expect(rep.observaciones).toEqual([]);
    expect(rep.cargos).toEqual([expect.objectContaining({ monto: 6, estado: "PENDIENTE" })]);
    expect(rep.regularizaciones.map((g) => g.accion)).toEqual(["REPOSICION", "CARGO_CAJERO"]);
    // Recuento: en realidad había S/ 2 más; ese sobrante queda como ingreso de la botica.
    const r3 = await regularizarEfectivo(db, F.admin, c.sesionId, { accion: "AJUSTE_CONTEO", efectivoContado: r2.efectivo.contado + 2, comentario: "Recontado con el cajero" });
    expect(r3).toMatchObject({ diferencia: -4, efectivo: { porRegularizar: 2 } });
    expect(await regularizarEfectivo(db, F.admin, c.sesionId, { accion: "SOBRANTE_INGRESO", monto: 2, comentario: "Queda para la botica" })).toMatchObject({ efectivo: { porRegularizar: 0 } });
    // Cargos: el cajero ve los suyos; otro cajero no; solo el administrador marca el pago.
    const mios = await listarCargos(db, F.caja1, "PENDIENTE");
    expect(mios.map((x) => [x.monto, x.cajeroId])).toEqual([[6, F.caja1.id]]);
    expect(await listarCargos(db, F.caja2)).toHaveLength(0);
    await expect(pagarCargo(db, F.caja1, mios[0].id)).rejects.toThrow(/administrador/);
    expect(await pagarCargo(db, F.admin, mios[0].id)).toMatchObject({ estado: "PAGADO" });
    await expect(pagarCargo(db, F.admin, mios[0].id)).rejects.toThrow(/ya está pagado/);
    expect((await listarCargos(db, F.admin, "PAGADO")).some((x) => x.id === mios[0].id)).toBe(true);
    expect(await validarCierre(db, F.admin, { sesionId: c.sesionId, observacion: "Faltante regularizado: S/ 4 repuestos y S/ 6 a cargo del cajero" })).toMatchObject({ estado: "CERRADA" });

    // Sobran S/ 8 (vuelto de menos): se devuelven al cliente y el efectivo cuadra.
    const sob = await turno((e) => e + 8);
    expect(sob).toMatchObject({ estado: "EN_CIERRE", diferencia: 8 });
    await expect(regularizarEfectivo(db, F.admin, sob.sesionId, { accion: "CARGO_CAJERO", monto: 1, comentario: "No aplica" })).rejects.toThrow(/faltante/);
    expect(await regularizarEfectivo(db, F.admin, sob.sesionId, { accion: "SOBRANTE_DEVUELTO", monto: 8, comentario: "Se devolvió el vuelto al cliente" })).toMatchObject({ diferencia: 0, efectivo: { porRegularizar: 0 } });
  });
});

describe("Gráfico de comisiones", () => {
  it("agrupa por mes, día u hora según el periodo, filtra por turno y solo muestra las propias a quien vende", async () => {
    const q = (x: Record<string, unknown>) => esquemaHistoricoComisiones.parse(x);
    const [{ total: esperado }] = await filas<{ total: string }>(db, sql`select coalesce(sum(monto),0) total from comision where usuario_id = ${F.caja1.id} and estado <> 'REVERTIDA' and fecha >= ${hoy().slice(0, 4) + "-01-01"}`);
    const anio = await historicoComisiones(db, F.caja1, q({}));
    expect(anio).toMatchObject({ periodo: "anio", nivel: "mes", propias: true, usuarioId: F.caja1.id });
    expect(anio.barras).toHaveLength(12);
    expect(anio.barras[0]).toMatchObject({ clave: `${hoy().slice(0, 4)}-01`, etiqueta: "Ene" });
    expect(anio.total).toBeCloseTo(Number(esperado), 2);
    expect(anio.total).toBeGreaterThan(0);
    // Quien vende no puede ver a otro vendedor.
    expect((await historicoComisiones(db, F.caja1, q({ usuarioId: String(F.caja2.id) }))).usuarioId).toBe(F.caja1.id);
    const mes = await historicoComisiones(db, F.caja1, q({ periodo: "mes", fecha: hoy() }));
    expect(mes.nivel).toBe("dia");
    expect(mes.barras[0].clave).toBe(`${hoy().slice(0, 7)}-01`);
    expect(mes.total).toBeCloseTo(anio.barras[Number(hoy().slice(5, 7)) - 1].total, 2);
    const semana = await historicoComisiones(db, F.caja1, q({ periodo: "semana", fecha: hoy() }));
    expect(semana.barras).toHaveLength(7);
    expect(semana.barras[0].etiqueta).toMatch(/^Lun /);
    const dia = await historicoComisiones(db, F.caja1, q({ periodo: "dia", fecha: hoy() }));
    expect(dia.nivel).toBe("hora");
    expect(dia.total).toBeCloseTo(mes.barras.find((b) => b.clave === hoy())!.total, 2);
    const largo = await historicoComisiones(db, F.caja1, q({ periodo: "rango", desde: sumarDias(hoy(), -100), hasta: hoy() }));
    expect(largo.nivel).toBe("mes");
    expect((await historicoComisiones(db, F.caja1, q({ periodo: "rango", desde: sumarDias(hoy(), -10), hasta: hoy() }))).barras).toHaveLength(11);
    await expect(historicoComisiones(db, F.caja1, q({ periodo: "rango", desde: hoy(), hasta: sumarDias(hoy(), -1) }))).rejects.toThrow(/anterior/);
    // Por turno: la suma de los turnos es el total.
    let suma = 0;
    for (const turno of ["MAÑANA", "TARDE", "NOCHE", "COMPLETO"]) suma += (await historicoComisiones(db, F.caja1, q({ turno }))).total;
    expect(suma).toBeCloseTo(anio.total, 2);
    // El administrador ve a todos o a un vendedor.
    const admin = await historicoComisiones(db, F.admin, q({}));
    expect(admin.propias).toBe(false);
    expect(admin.total).toBeGreaterThanOrEqual(anio.total);
    expect(admin.vendedores.some((v) => v.id === F.caja1.id)).toBe(true);
    expect((await historicoComisiones(db, F.admin, q({ usuarioId: String(F.caja1.id) }))).total).toBeCloseTo(anio.total, 2);
  });
});

describe("Transferencia asociada al lote y al registro sanitario", () => {
  it("una transferencia antigua sin lote no se puede aprobar; el comprobante lleva lote, vencimiento y registro sanitario", async () => {
    await db.update(schema.producto).set({ registroSanitario: "EN-01234" }).where(eq(schema.producto.id, F.vit.id));
    const lt = await loteVigente(F.vit.id, 2);
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC", destinoDoc: "20555555551", destino: "Farmacia Vecina SAC", motivo: "Venta por volumen", items: [{ productoId: F.vit.id, loteId: lt.id, unidades: 2 }] });
    // Simula una registrada antes del cambio, sin lote.
    await db.update(schema.transferenciaDetalle).set({ loteId: null }).where(eq(schema.transferenciaDetalle.transferenciaId, r.id));
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    await expect(aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "EFECTIVO", precios: [{ detalleId: t.items[0].id, precioUnitario: 20 }] })).rejects.toThrow(/sin lote/);
    await db.update(schema.transferenciaDetalle).set({ loteId: lt.id }).where(eq(schema.transferenciaDetalle.transferenciaId, r.id));
    const ap = await aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "EFECTIVO", precios: [{ detalleId: t.items[0].id, precioUnitario: 20 }] });
    const k = await db.select().from(schema.kardex).where(and(eq(schema.kardex.tipo, "TRANSFERENCIA"), eq(schema.kardex.documentoId, ap.ventaId!)));
    expect(k.every((x) => x.loteId === lt.id)).toBe(true);
    const comp = await detalleVenta(db, ap.ventaId!, F.caja1);
    expect(comp.items).toEqual([expect.objectContaining({ lote: lt.numero, vencimiento: lt.vencimiento, registroSanitario: "EN-01234", cantidad: 2 })]);
  });
});

describe("Delivery que paga el cliente en una transferencia", () => {
  it("se cobra en el comprobante, no cuenta como venta de productos y no cambia la ganancia", async () => {
    const lt = await loteVigente(F.vit.id, 2);
    const r = await registrarTransferencia(db, F.caja1, { tipoDestino: "EMPRESA", destinoTipoDoc: "RUC", destinoDoc: "20555555551", destino: "Farmacia Vecina SAC", motivo: "Venta con envío", items: [{ productoId: F.vit.id, loteId: lt.id, unidades: 2 }] });
    const [t] = (await listarTransferencias(db, F.admin, "PENDIENTE")).filter((x) => x.id === r.id);
    const ventasAntes = (await panel(db, F.admin)).ventas.dia.total;
    const ap = await aprobarTransferencia(db, F.admin, r.id, { vendedorId: F.caja2.id, medioPago: "YAPE", delivery: 11.8, precios: [{ detalleId: t.items[0].id, precioUnitario: 20 }] });
    expect(ap).toMatchObject({ totalVenta: 51.8, delivery: 11.8 });
    const [v] = await db.select().from(schema.venta).where(eq(schema.venta.id, ap.ventaId!));
    expect(v).toMatchObject({ total: 51.8, delivery: 11.8, subtotal: 43.9, igv: 7.9 });
    const pagos = await db.select().from(schema.ventaPago).where(eq(schema.ventaPago.ventaId, v.id));
    expect(pagos).toEqual([expect.objectContaining({ medio: "YAPE", monto: 51.8 })]);
    // La ganancia es la de los productos: 40 / 1.18 − costo de la mercadería.
    expect(v.total / 1.18 - v.costoTotal).toBeCloseTo(40 / 1.18 - lt.costoUnitario * 2, 1);
    // En el panel solo suman los productos.
    expect((await panel(db, F.admin)).ventas.dia.total).toBeCloseTo(ventasAntes + 40, 2);
    const comp = await detalleVenta(db, v.id, F.caja1);
    expect(comp.venta.delivery).toBe(11.8);
    expect(comp.items.reduce((s, i) => s + Number(i.subtotal), 0)).toBeCloseTo(40, 2);
    const [vista] = (await listarTransferencias(db, F.admin, "APROBADA")).filter((x) => x.id === r.id);
    expect(vista).toMatchObject({ totalVenta: 51.8, costoAdicional: 11.8 });
  });
});
