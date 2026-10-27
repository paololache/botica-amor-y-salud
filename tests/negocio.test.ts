import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { abrirCaja, cerrarCaja, calcularEsperado, validarCierre } from "@/lib/services/caja";
import { crearVenta, anularVenta } from "@/lib/services/ventas";
import { crearCampana, alternarCampana } from "@/lib/services/campanas";
import { consolidarHasta, misComisiones, cerrarMes } from "@/lib/services/comisiones";
import { registrarRecepcion, costearCompra } from "@/lib/services/compras";
import { registrarMovimiento, decidirMovimiento } from "@/lib/services/salidas";
import { evaluarAlertas, alertasDelRol } from "@/lib/services/alertas";
import { ejecutarReporte, crearMetrica } from "@/lib/services/reportes";
import { enmascarar } from "@/lib/permisos";
import { evaluar, validarFormula } from "@/lib/formula";
import { hoy, sumarDias } from "@/lib/util";
import { base, preparar } from "./fixture";

let db: Db;
let F: Awaited<ReturnType<typeof base>>;
const conteo = (soles: number) => ({ "10": Math.floor(soles / 10), "1": soles % 10 });

beforeAll(async () => {
  db = await preparar();
  F = await base(db);
  await abrirCaja(db, F.caja1, { cajaId: F.cajas[0].id, turno: "MAÑANA", conteo: conteo(150) });
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
    expect(enmascarar(dato, "CAJERO")).toEqual({ nombre: "X", pvp: 5, lotes: [{ cantidad: 1 }] });
    expect(enmascarar(dato, "QF")).not.toHaveProperty("costoPromedio");
    expect(enmascarar(dato, "ADMIN")).toEqual(dato);
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
  it("exige receta y bloquea stock insuficiente", async () => {
    await expect(crearVenta(db, F.caja1, { items: [{ presentacionId: F.presAmox.id, cantidad: 1, descuentoPct: 0, origen: "DIRECTA" }], tipoComprobante: "BOLETA", pagos: [{ medio: "EFECTIVO", monto: 6 }] })).rejects.toThrow(/receta/);
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

describe("Cierre ciego de caja", () => {
  it("calcula el esperado y pide validación si la diferencia supera el umbral", async () => {
    const esp = await calcularEsperado(db, (await db.select().from(schema.sesionCaja))[0].id);
    expect(esp.EFECTIVO).toBe(150 + 54 * 2);
    expect(esp.YAPE).toBe(18);
    const r = await cerrarCaja(db, F.caja1, { conteo: conteo(esp.EFECTIVO - 20), virtuales: { YAPE: 18, PLIN: 0, TARJETA: 0, TRANSFERENCIA: 0 }, fondoSiguiente: 150 });
    expect(r.diferencia).toBe(-20);
    expect(r.estado).toBe("EN_CIERRE");
    await expect(validarCierre(db, F.caja1, { sesionId: r.sesionId, observacion: "faltante" })).rejects.toThrow();
    const ok = await validarCierre(db, F.admin, { sesionId: r.sesionId, observacion: "Revisado con el cajero" });
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
    await expect(cerrarMes(db, F.admin, hoy().slice(0, 7))).rejects.toThrow(/último día/);
  });
});

describe("Alertas y reportes", () => {
  it("genera alertas por vencimiento y las filtra por rol", async () => {
    await evaluarAlertas(db);
    const qf = await alertasDelRol(db, "QF");
    expect(qf.conteos.find((c) => c.tipo === "POR_VENCER")?.total).toBeGreaterThan(0);
    const cajero = await alertasDelRol(db, "CAJERO");
    expect(cajero.alertas).toHaveLength(0);
  });
  it("las métricas con costo solo las ve el administrador (RN-20)", async () => {
    const m = await crearMetrica(db, F.admin, { nombre: "Margen prueba", formula: "(ventas / 1.18 - costo_ventas) / (ventas / 1.18) * 100", unidad: "PORCENTAJE", roles: ["QF"], enPanel: false });
    expect(m.sensible).toBe(true);
    await expect(ejecutarReporte(db, "QF", { agrupar: "categoria", metricas: [m.codigo] })).rejects.toThrow(/no está disponible/);
    const r = await ejecutarReporte(db, "ADMIN", { agrupar: "categoria", metricas: ["ventas", m.codigo] });
    expect(r.filas.length).toBeGreaterThan(0);
  });
});
