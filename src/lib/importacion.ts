import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { claveLaboratorio, hoy as hoyLima, r2, r4 } from "./util";
import { asegurarCatalogo } from "./services/servicios";
import { normalizarPatologias } from "./services/productos";
import { sugerirPatologias } from "./terapeutica";

/** Columnas del Excel de productos del cliente (la fila de encabezados se ubica sola). */
const COLUMNAS = {
  codigo: ["codigo", "código"], categoria: ["categoria", "categoría"], laboratorio: ["laboratorio"], nombre: ["nombre"],
  precioCaja: ["precio caja"], pvp: ["pvp1", "pvp", "precio unidad"], costo: ["precio costo unitario", "costo"], precioBlister: ["precio blister", "precio blíster"],
  stock: ["stock"], stockMinimo: ["stock min", "stock mínimo", "stock minimo"], lote: ["lote"], vencimiento: ["f. vencimiento", "vencimiento"], principioActivo: ["prin a.", "principio activo", "p. activo"],
  patologias: ["patologia", "patología", "para que sirve", "para qué sirve", "accion terapeutica", "acción terapéutica"], ubicacion: ["ubic", "ubicacion", "ubicación"],
} as const;
type Campo = keyof typeof COLUMNAS;

/** Categorías equivalentes del Excel unificadas en un solo nombre. */
const CATEGORIAS: Record<string, string> = {
  "P. FARMACEUTICO": "Productos farmacéuticos", "P. SANITARIO": "Productos sanitarios", "PRODUCTO SANITARIO": "Productos sanitarios",
  "P. GALENICO": "Productos galénicos", GALENICOS: "Productos galénicos",
  BEBES: "Bebés", "CUIDADO DE BEBES": "Bebés", "CUIDADO PERSONAL BEBE": "Bebés",
  "COLONIAS CATALOGO": "Colonias y perfumes", "COLONIAS Y PERFUMES": "Colonias y perfumes",
  VITAMINAS: "Vitaminas y suplementos", "SUPLEMENTO VITAMINICO": "Vitaminas y suplementos", MULTIVITAMINICO: "Vitaminas y suplementos", "SUPLEMENTO DIETETICO": "Vitaminas y suplementos",
  INALADORES: "Inhaladores", "DISPOSITIVOS MEDICOS": "Dispositivos médicos", HEPATOGASTRICO: "Hepatogástrico", COSMETICO: "Cosmético", LOCION: "Loción",
  "SUERO ELECTROLITOS": "Suero y electrolitos", "HIGIENE PERSONAL": "Higiene personal",
};
const oracion = (t: string) => { const s = t.trim().toLowerCase().replace(/\s+/g, " "); return s ? s[0].toUpperCase() + s.slice(1) : s; };
export const nombreCategoria = (t: string | null) => (t?.trim() ? CATEGORIAS[t.trim().toUpperCase()] ?? oracion(t) : null);

/** Filas que en el Excel son servicios (aplicación de inyectables), no productos con stock. */
const esServicio = (nombre: string, lote: string | null, stock: number) =>
  /^(APLICACION|SERVICIO DE|INYECTABLES\d*$)/i.test(nombre.trim()) || (stock >= 1_000_000 && /SIN LOTE/i.test(lote ?? ""));

/** Unidades por caja deducidas del nombre («X 100 TAB», «X 33 SOBRES»); null si el nombre no lo dice. */
export function unidadesDelNombre(nombre: string): number | null {
  const m = nombre.toUpperCase().match(/\bX\s*(\d{1,4})\s*(TAB(?:LETAS?)?|TABS|CAP(?:SULAS?)?|CAPS|SOBRES?|COMP(?:RIMIDOS?)?|GRAGEAS?|UND|UNID(?:ADES)?|AMP(?:OLLAS?)?|OVULOS?|SUPOSITORIOS?)\b/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 1 ? n : null;
}

const num = (x: string | null | undefined) => { const n = Number(String(x ?? "").replace(",", ".").trim()); return Number.isFinite(n) ? n : 0; };
const texto = (x: string | null | undefined) => (x ?? "").replace(/\s+/g, " ").trim();
const fechaValida = (x: string | null | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(texto(x)) ? texto(x) : null;

export type LoteImport = { numero: string; vencimiento: string; cantidad: number; costo: number };
export type ProductoImport = {
  codigo: string; nombre: string; categoria: string | null; laboratorio: string; principioActivo: string | null; patologias: string | null; ubicacion: string | null;
  pvp: number; costo: number; stockMinimo: number; activo: boolean; lotes: LoteImport[];
  caja: { factor: number; pvp: number } | null;
};
export type Observacion = { codigo: string; nombre: string; tipo: string; detalle: string };
export type ServicioExcel = { nombre: string; precio: number };

/** Convierte las filas del Excel en productos (uno por código, con sus lotes) y anota lo que hay que revisar. */
export function interpretarFilas(filas: (string | null)[][], hoy = hoyLima()) {
  const iEnc = filas.findIndex((f) => f.some((c) => /^c[oó]digo$/i.test(texto(c))));
  if (iEnc < 0) throw new Error("No encuentro la fila de encabezados (con la columna «Codigo»).");
  const enc = filas[iEnc].map((c) => texto(c).toLowerCase());
  const pos = Object.fromEntries((Object.keys(COLUMNAS) as Campo[]).map((k) => [k, enc.findIndex((h) => (COLUMNAS[k] as readonly string[]).includes(h))])) as Record<Campo, number>;
  for (const k of ["codigo", "nombre", "pvp", "stock"] as Campo[]) if (pos[k] < 0) throw new Error(`Falta la columna «${COLUMNAS[k][0]}» en el Excel.`);
  const v = (f: (string | null)[], k: Campo) => (pos[k] >= 0 ? f[pos[k]] ?? null : null);

  const porCodigo = new Map<string, ProductoImport & { blister: number; precioCaja: number }>();
  const servicios: ServicioExcel[] = [];
  const obs: Observacion[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    const codigo = texto(v(f, "codigo")); const nombre = texto(v(f, "nombre"));
    if (!codigo && !nombre) continue;
    const stock = Math.trunc(num(v(f, "stock")));
    if (esServicio(nombre, v(f, "lote"), stock)) { servicios.push({ nombre, precio: r2(num(v(f, "pvp"))) }); continue; }
    if (!codigo || !nombre) { obs.push({ codigo, nombre, tipo: "FILA_INCOMPLETA", detalle: "Sin código o sin nombre: no se cargó." }); continue; }
    const loteTxt = texto(v(f, "lote"));
    const venc = fechaValida(v(f, "vencimiento"));
    const p = porCodigo.get(codigo) ?? {
      codigo, nombre, categoria: nombreCategoria(v(f, "categoria")), laboratorio: texto(v(f, "laboratorio")) || "OTROS", principioActivo: texto(v(f, "principioActivo")) || null,
      // La patología del Excel si viene; si no, la sugerida por el principio activo o el nombre.
      patologias: normalizarPatologias(texto(v(f, "patologias")).replace(/\s+-\s+/g, ", ")) ?? sugerirPatologias(texto(v(f, "principioActivo")), nombre), ubicacion: texto(v(f, "ubicacion")) || null,
      pvp: r2(num(v(f, "pvp"))), costo: 0, stockMinimo: Math.max(0, Math.trunc(num(v(f, "stockMinimo")))), activo: true, lotes: [], caja: null,
      blister: r2(num(v(f, "precioBlister"))), precioCaja: r2(num(v(f, "precioCaja"))),
    };
    if (porCodigo.has(codigo) && p.nombre !== nombre) obs.push({ codigo, nombre, tipo: "NOMBRE_DISTINTO", detalle: `El mismo código figura también como «${p.nombre}»; se usó el primero.` });
    p.stockMinimo = Math.max(p.stockMinimo, Math.trunc(num(v(f, "stockMinimo"))));
    if (stock > 0) {
      const numero = !loteTxt || /SIN LOTE/i.test(loteTxt) ? "SIN LOTE" : loteTxt.toUpperCase();
      const vencimiento = venc ?? "2099-12-31";
      if (!venc) obs.push({ codigo, nombre, tipo: "SIN_VENCIMIENTO", detalle: `Lote ${numero} sin fecha de vencimiento: se cargó con 31/12/2099, corrígelo.` });
      else if (venc <= hoy) obs.push({ codigo, nombre, tipo: "VENCIDO", detalle: `Lote ${numero} vencido el ${venc} (${stock} und.): queda bloqueado para la venta; dale de baja.` });
      const ya = p.lotes.find((l) => l.numero === numero);
      if (ya) { ya.costo = r4((ya.costo * ya.cantidad + num(v(f, "costo")) * stock) / (ya.cantidad + stock)); ya.cantidad += stock; }
      else p.lotes.push({ numero, vencimiento, cantidad: stock, costo: r4(num(v(f, "costo"))) });
    }
    porCodigo.set(codigo, p);
  }

  const productos: ProductoImport[] = [];
  const nombres = new Map<string, string[]>();
  for (const { blister, precioCaja, ...p } of porCodigo.values()) {
    const unidades = p.lotes.reduce((s, l) => s + l.cantidad, 0);
    p.costo = unidades ? r4(p.lotes.reduce((s, l) => s + l.costo * l.cantidad, 0) / unidades) : 0;
    if (!p.costo) obs.push({ codigo: p.codigo, nombre: p.nombre, tipo: "SIN_COSTO", detalle: "Sin costo unitario: el margen no se podrá calcular." });
    if (!(p.pvp > 0)) { p.activo = false; obs.push({ codigo: p.codigo, nombre: p.nombre, tipo: "SIN_PRECIO", detalle: "Sin precio por unidad (PVP1): se cargó inactivo. Ponle precio en Productos para poder venderlo." }); }
    else if (p.costo > p.pvp / 1.18) obs.push({ codigo: p.codigo, nombre: p.nombre, tipo: "BAJO_COSTO", detalle: `El precio S/ ${p.pvp.toFixed(2)} no cubre el costo S/ ${p.costo.toFixed(2)} más IGV.` });
    if (precioCaja > 0) {
      const factor = unidadesDelNombre(p.nombre);
      // Se acepta solo si cuadra: la unidad dentro de la caja no puede salir más cara que suelta.
      if (factor && p.pvp > 0 && precioCaja / factor <= p.pvp + 0.005) p.caja = { factor, pvp: precioCaja };
      else obs.push({ codigo: p.codigo, nombre: p.nombre, tipo: "CAJA_POR_COMPLETAR", detalle: `Precio por caja S/ ${precioCaja.toFixed(2)}: indica cuántas unidades trae en Productos.` });
    }
    if (blister > 0) obs.push({ codigo: p.codigo, nombre: p.nombre, tipo: "BLISTER_POR_COMPLETAR", detalle: `Precio por blíster S/ ${blister.toFixed(2)}: indica cuántas unidades trae en Productos.` });
    productos.push(p);
    const k = p.nombre.toUpperCase();
    nombres.set(k, [...(nombres.get(k) ?? []), p.codigo]);
  }
  for (const [n, cods] of nombres) if (cods.length > 1) obs.push({ codigo: cods.join(" / "), nombre: n, tipo: "MISMO_NOMBRE", detalle: "El mismo nombre con códigos distintos: se cargaron por separado; si es el mismo producto, unifícalos." });
  return { productos, servicios, observaciones: obs };
}

export type Plan = ReturnType<typeof interpretarFilas>;

/** Tablas con datos de operación o de prueba. Se conservan usuarios, parámetros, métricas, motivos, cajas, servicios y reportes guardados. */
const TABLAS_OPERACION = [
  "atencion_servicio", "regularizacion_cierre", "meta_mensual", "uso_modulo", "transferencia_detalle", "transferencia", "auditoria", "alerta",
  "liquidacion_mensual", "comision_diaria", "comision", "complemento", "campana", "kardex", "mov_detalle", "movimiento_inventario",
  "compra_detalle", "compra", "proveedor", "venta_pago", "venta_detalle", "venta_servicio", "venta", "correlativo", "cliente", "movimiento_caja", "sesion_caja",
  "lote", "presentacion", "producto", "laboratorio", "categoria",
];

/**
 * Carga el catálogo. Con `reemplazar` deja la base limpia antes (para empezar a operar con datos reales).
 * Todo va en una sola transacción: si algo falla no queda nada a medias. El stock entra como inventario inicial en el kardex.
 */
export async function aplicarImportacion(db: Db, plan: Plan, opciones: { reemplazar: boolean; usuarioId: number | null }) {
  const hoy = hoyLima();
  return db.transaction(async (tx) => {
    if (opciones.reemplazar) await tx.execute(sql.raw(`truncate table ${TABLAS_OPERACION.join(", ")} restart identity`));
    const { producto, presentacion, lote, kardex, laboratorio, categoria, servicio, auditoria } = schema;

    const cats = new Map((await tx.select().from(categoria)).map((c) => [c.nombre, c.id]));
    for (const n of new Set(plan.productos.map((p) => p.categoria).filter((c): c is string => !!c))) {
      if (!cats.has(n)) { const [c] = await tx.insert(categoria).values({ nombre: n }).returning(); cats.set(n, c.id); }
    }
    const labs = new Map((await tx.select().from(laboratorio)).map((l) => [l.clave, l.id]));
    for (const n of new Set(plan.productos.map((p) => p.laboratorio))) {
      const clave = claveLaboratorio(n);
      if (!labs.has(clave)) { const [l] = await tx.insert(laboratorio).values({ nombre: n.toUpperCase() === "OTROS" ? "Otros" : n, clave }).returning(); labs.set(clave, l.id); }
    }

    const existentes = new Map((await tx.select({ id: producto.id, codigo: producto.codigo }).from(producto)).map((p) => [p.codigo, p.id]));
    const conStock = new Set((await tx.select({ id: lote.productoId }).from(lote)).map((l) => l.id));
    let creados = 0, actualizados = 0, lotes = 0, unidades = 0, sinStockCargado = 0;
    for (const p of plan.productos) {
      const datos = {
        codigo: p.codigo, nombre: p.nombre, principioActivo: p.principioActivo, ...(p.patologias ? { patologias: p.patologias } : {}), ...(p.ubicacion ? { ubicacion: p.ubicacion } : {}), laboratorioId: labs.get(claveLaboratorio(p.laboratorio))!,
        categoriaId: p.categoria ? cats.get(p.categoria)! : null, stockMinimo: p.stockMinimo, costoPromedio: p.costo, activo: p.activo,
        porcentajeUtilidad: p.costo > 0 && p.pvp > 0 ? Math.max(0, Math.min(999, r2(((p.pvp / 1.18 - p.costo) / p.costo) * 100))) : 30,
      };
      let id = existentes.get(p.codigo);
      if (id) {
        await tx.update(producto).set(datos).where(eq(producto.id, id));
        await tx.update(presentacion).set({ pvp: p.pvp }).where(sql`${presentacion.productoId} = ${id} and ${presentacion.factor} = 1`);
        actualizados++;
      } else {
        [{ id }] = await tx.insert(producto).values(datos).returning({ id: producto.id });
        await tx.insert(presentacion).values([
          { productoId: id, nombre: "Unidad", factor: 1, pvp: p.pvp },
          ...(p.caja ? [{ productoId: id, nombre: `Caja x${p.caja.factor}`, factor: p.caja.factor, pvp: p.caja.pvp }] : []),
        ]);
        creados++;
      }
      // El stock solo entra a productos sin inventario previo: lo demás se ajusta con Salidas y entradas para no romper el kardex.
      if (p.lotes.length && conStock.has(id!)) { sinStockCargado++; continue; }
      let saldo = 0;
      for (const l of p.lotes) {
        const [nl] = await tx.insert(lote).values({ productoId: id!, numero: l.numero, vencimiento: l.vencimiento, costoUnitario: l.costo, cantidad: l.cantidad, estado: l.vencimiento <= hoy ? "VENCIDO" : "ACTIVO" }).returning({ id: lote.id });
        saldo += l.cantidad;
        await tx.insert(kardex).values({ productoId: id!, loteId: nl.id, tipo: "INVENTARIO_INICIAL", documentoTipo: "INVENTARIO_INICIAL", documentoRef: "Importación del Excel", entrada: l.cantidad, costoUnitario: l.costo, saldoUnidades: saldo, costoPromedio: p.costo, saldoValorizado: r2(saldo * p.costo), usuarioId: opciones.usuarioId });
        lotes++; unidades += l.cantidad;
      }
    }

    // Precios de los servicios de inyectables que venían en el Excel.
    await asegurarCatalogo(tx);
    const precio = (re: RegExp) => plan.servicios.find((s) => re.test(s.nombre))?.precio;
    const interno = precio(/APLICACION INYECTABLE INTERNO/i), externo = precio(/PRODUCTO EXTERNO/i), evInterno = precio(/EV INTERNO/i), iv = precio(/INTRAVENOSO/i);
    if (interno !== undefined || externo !== undefined) {
      for (const c of ["INY-IM", "INY-SC", "INY-ID"]) await tx.update(servicio).set({ ...(interno !== undefined ? { precio: interno } : {}), ...(externo !== undefined ? { precioExterno: externo } : {}) }).where(eq(servicio.codigo, c));
    }
    if (evInterno !== undefined || iv !== undefined) await tx.update(servicio).set({ ...(evInterno !== undefined ? { precio: evInterno } : {}), ...(iv !== undefined ? { precioExterno: iv } : {}) }).where(eq(servicio.codigo, "INY-IV"));

    const resumen = { reemplazo: opciones.reemplazar, creados, actualizados, lotes, unidades, sinStockCargado, observaciones: plan.observaciones.length };
    await tx.insert(auditoria).values({ usuarioId: opciones.usuarioId, accion: "IMPORTAR_PRODUCTOS", entidad: "producto", entidadId: null, detalle: resumen });
    return resumen;
  });
}
