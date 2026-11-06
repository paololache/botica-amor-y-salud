import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { abrirCaja, cerrarCaja, calcularEsperado, validarCierre } from "@/lib/services/caja";
import { crearVenta, anularVenta } from "@/lib/services/ventas";
import { crearCampana, alternarCampana } from "@/lib/services/campanas";
import { consolidarHasta, misComisiones, cerrarMes, detalleVendedor, resumenMes } from "@/lib/services/comisiones";
import { registrarRecepcion, anularCompra, costearCompra, corregirCostoCompra, datosCorreccion, esquemaCorreccion, esquemaRecepcion, listarCompras } from "@/lib/services/compras";
import { registrarMovimiento, decidirMovimiento } from "@/lib/services/salidas";
import { evaluarAlertas, alertasDelRol } from "@/lib/services/alertas";
import { ejecutarReporte, crearMetrica, reporteEspecial } from "@/lib/services/reportes";
import { buscarProductos, crearProducto, editarProducto, esquemaProducto, fichaProducto, listarStock } from "@/lib/services/productos";
import { crearLaboratorio, eliminarLaboratorio, listarLaboratorios, renombrarLaboratorio, unificarLaboratorios } from "@/lib/services/laboratorios";
import bcrypt from "bcryptjs";
import { enmascarar, MODULOS, moduloDeRuta, puede, tieneRol, verCostos, type Rol } from "@/lib/permisos";
import { firmarSesion, leerSesion } from "@/lib/auth";
import { crearUsuario, editarUsuario, eliminarUsuario, esquemaNuevoUsuario } from "@/lib/services/usuarios";
import { esquemaHistorico, historicoVentas, panel } from "@/lib/services/panel";
import { evaluar, validarFormula } from "@/lib/formula";
import { claveLaboratorio, hoy, esIdValido, limpiarNumero, precioSugerido, r4, sumarDias } from "@/lib/util";
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

describe("Cierre de caja", () => {
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
    await abrirCaja(db, F.caja2, { cajaId: F.cajas[1].id, turno: "TARDE", conteo: conteo(150) });
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
    expect(cajero.alertas).toHaveLength(0);
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
    const r = await reporteEspecial(db, F.admin, "stock-critico", {}) as { filas: { codigo: string; producto: string }[] };
    expect(r.filas.find((f) => f.codigo === F.vit.codigo)?.producto).toBe(F.vit.nombre);
  });
});
