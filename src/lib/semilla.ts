/**
 * Datos de prueba reproducibles (semilla fija) para el MVP.
 *   SEED_PRODUCTOS  productos sintéticos además de los 96 base (por defecto 300; 2000 para carga; 20000 para búsqueda)
 *   SEED_DIAS       días de ventas históricas (por defecto 60; 180 para carga)
 *   SEED_VENTAS_DIA ventas por día aproximadas (por defecto 120)
 *   SEED_RESET=1    borra todo antes de sembrar
 */
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { hoy as hoyLima, sumarDias, r2, r4 } from "./util";
import { evaluarAlertas } from "./services/alertas";

const N_SINT = Number(process.env.SEED_PRODUCTOS ?? 300);
const DIAS = Number(process.env.SEED_DIAS ?? 60);
const VENTAS_DIA = Number(process.env.SEED_VENTAS_DIA ?? 120);
const PASSWORD = process.env.SEED_PASSWORD ?? "botica2026";

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(20261026);
const ent = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elegir = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const CATEGORIAS = ["Medicamentos", "Vitaminas y minerales", "Suplementos y probióticos", "Cuidado personal", "Dermocosmética", "Bebés", "Primeros auxilios"];
const LABS = ["Genfar", "Portugal", "Medifarma", "Farmindustria", "Hersil", "Induquímica", "AC Farma", "Teva", "Bayer", "Roemmers", "Abbott", "Sanofi"];

type Base = { nombre: string; pa?: string; conc?: string; cat: number; precio: number; tipo: "TAB" | "UNI"; cond?: "RECETA" | "RECETA_RETENIDA"; pop: number };
const B = (nombre: string, cat: number, precio: number, tipo: "TAB" | "UNI", pop: number, pa?: string, conc?: string, cond?: "RECETA" | "RECETA_RETENIDA"): Base => ({ nombre, cat, precio, tipo, pop, pa, conc, cond });
const BASE: Base[] = [
  B("Paracetamol 500 mg", 0, 0.25, "TAB", 10, "Paracetamol", "500 mg"), B("Paracetamol 1 g", 0, 0.5, "TAB", 4, "Paracetamol", "1 g"),
  B("Ibuprofeno 400 mg", 0, 0.4, "TAB", 9, "Ibuprofeno", "400 mg"), B("Ibuprofeno 600 mg", 0, 0.6, "TAB", 4, "Ibuprofeno", "600 mg"),
  B("Naproxeno 550 mg", 0, 0.8, "TAB", 5, "Naproxeno", "550 mg"), B("Diclofenaco 50 mg", 0, 0.3, "TAB", 6, "Diclofenaco", "50 mg"),
  B("Amoxicilina 500 mg", 0, 0.6, "TAB", 8, "Amoxicilina", "500 mg", "RECETA"), B("Amoxicilina + Ácido clavulánico 875 mg", 0, 2.8, "TAB", 4, "Amoxicilina", "875 mg", "RECETA"),
  B("Azitromicina 500 mg", 0, 3.5, "TAB", 5, "Azitromicina", "500 mg", "RECETA"), B("Ciprofloxacino 500 mg", 0, 0.9, "TAB", 4, "Ciprofloxacino", "500 mg", "RECETA"),
  B("Cefalexina 500 mg", 0, 0.9, "TAB", 4, "Cefalexina", "500 mg", "RECETA"), B("Metronidazol 500 mg", 0, 0.5, "TAB", 3, "Metronidazol", "500 mg", "RECETA"),
  B("Loratadina 10 mg", 0, 0.3, "TAB", 6, "Loratadina", "10 mg"), B("Cetirizina 10 mg", 0, 0.35, "TAB", 5, "Cetirizina", "10 mg"),
  B("Clorfenamina 4 mg", 0, 0.2, "TAB", 5, "Clorfenamina", "4 mg"), B("Omeprazol 20 mg", 0, 0.3, "TAB", 8, "Omeprazol", "20 mg"),
  B("Pantoprazol 40 mg", 0, 1.2, "TAB", 3, "Pantoprazol", "40 mg"), B("Metformina 850 mg", 0, 0.3, "TAB", 6, "Metformina", "850 mg", "RECETA"),
  B("Losartán 50 mg", 0, 0.4, "TAB", 6, "Losartán", "50 mg", "RECETA"), B("Enalapril 10 mg", 0, 0.25, "TAB", 4, "Enalapril", "10 mg", "RECETA"),
  B("Atorvastatina 20 mg", 0, 0.9, "TAB", 4, "Atorvastatina", "20 mg", "RECETA"), B("Amlodipino 5 mg", 0, 0.3, "TAB", 4, "Amlodipino", "5 mg", "RECETA"),
  B("Dexametasona 4 mg", 0, 0.5, "TAB", 3, "Dexametasona", "4 mg", "RECETA"), B("Prednisona 20 mg", 0, 0.6, "TAB", 2, "Prednisona", "20 mg", "RECETA"),
  B("Clonazepam 2 mg", 0, 1.1, "TAB", 1, "Clonazepam", "2 mg", "RECETA_RETENIDA"), B("Hioscina 10 mg", 0, 0.7, "TAB", 4, "Hioscina", "10 mg"),
  B("Loperamida 2 mg", 0, 0.5, "TAB", 3, "Loperamida", "2 mg"), B("Antigripal tabletas", 0, 0.8, "TAB", 7, "Paracetamol", "500 mg"),
  B("Ambroxol jarabe 120 ml", 0, 9.5, "UNI", 5, "Ambroxol", "30 mg/5 ml"), B("Jarabe para la tos 120 ml", 0, 12, "UNI", 4, "Dextrometorfano", "15 mg/5 ml"),
  B("Salbutamol inhalador 100 mcg", 0, 18, "UNI", 3, "Salbutamol", "100 mcg", "RECETA"), B("Sales de rehidratación oral", 0, 2.5, "UNI", 5, "Sales de rehidratación"),
  B("Suero oral 1 L", 0, 6.5, "UNI", 5, "Sales de rehidratación"), B("Gotas oftálmicas lubricantes 15 ml", 0, 16, "UNI", 2, "Hipromelosa"),
  B("Vitamina C 1 g · tubo x10", 1, 18, "UNI", 6, "Ácido ascórbico", "1 g"), B("Zinc + Vitamina C · frasco", 1, 21, "UNI", 4, "Zinc"),
  B("Complejo B · frasco", 1, 16.5, "UNI", 4, "Complejo B"), B("Multivitamínico adulto x30", 1, 35, "UNI", 3, "Multivitamínico"),
  B("Calcio + Vitamina D x60", 1, 32, "UNI", 3, "Calcio"), B("Hierro + Ácido fólico x30", 1, 19, "UNI", 3, "Hierro"),
  B("Magnesio x60", 1, 28, "UNI", 2, "Magnesio"), B("Vitamina D3 2000 UI x60", 1, 30, "UNI", 2, "Colecalciferol"),
  B("Omega 3 x60", 2, 42, "UNI", 2, "Omega 3"), B("Probiótico · sobres x10", 2, 24, "UNI", 4, "Probiótico"),
  B("Colágeno hidrolizado 300 g", 2, 65, "UNI", 2, "Colágeno"), B("Fibra natural 200 g", 2, 26, "UNI", 2, "Psyllium"),
  B("Protector solar FPS 50", 4, 45, "UNI", 3), B("Crema antimicótica 20 g", 4, 14, "UNI", 3, "Clotrimazol", "1%"),
  B("Gel antiacné 30 g", 4, 32, "UNI", 2, "Peróxido de benzoilo"), B("Crema hidratante 200 ml", 4, 28, "UNI", 2),
  B("Shampoo anticaspa 200 ml", 3, 22, "UNI", 3), B("Pasta dental 90 g", 3, 6.5, "UNI", 5), B("Cepillo dental", 3, 5, "UNI", 4),
  B("Jabón antibacterial", 3, 4.5, "UNI", 4), B("Toallas higiénicas x10", 3, 6, "UNI", 4), B("Preservativos x3", 3, 9, "UNI", 3),
  B("Pañales talla M x30", 5, 42, "UNI", 3), B("Pañales talla G x30", 5, 45, "UNI", 3), B("Toallitas húmedas x80", 5, 9.5, "UNI", 4),
  B("Crema antipañalitis 60 g", 5, 15, "UNI", 3, "Óxido de zinc"), B("Paracetamol gotas pediátricas", 5, 8, "UNI", 3, "Paracetamol", "100 mg/ml"),
  B("Alcohol 70° 250 ml", 6, 5.5, "UNI", 5), B("Agua oxigenada 120 ml", 6, 3, "UNI", 3), B("Gasa estéril x10", 6, 4, "UNI", 3),
  B("Esparadrapo 2.5 cm", 6, 4.5, "UNI", 3), B("Curitas x20", 6, 5, "UNI", 4), B("Venda elástica 10 cm", 6, 7, "UNI", 2),
  B("Termómetro digital", 6, 18, "UNI", 1), B("Algodón 100 g", 6, 4, "UNI", 3), B("Mascarillas x10", 6, 5, "UNI", 3),
];
while (BASE.length < 96) {
  const n = BASE.length;
  BASE.push(B(`${elegir(["Tabletas", "Cápsulas", "Grageas"])} genéricas ${n}`, 0, r2(0.2 + rnd() * 1.5), "TAB", 1 + Math.floor(rnd() * 3), `Genérico ${n}`));
}

export async function sembrar(db: Db, opciones: { reset?: boolean } = {}): Promise<string> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.usuario);
  if (n > 0) {
    if (!opciones.reset) return "La base ya tiene datos. Usa SEED_RESET=1 para reiniciarla.";
    await db.execute(sql`truncate table auditoria, reporte_guardado, metrica, parametro, alerta, liquidacion_mensual, comision_diaria, comision, complemento, campana, kardex, mov_detalle, movimiento_inventario, motivo, compra_detalle, compra, proveedor, venta_pago, venta_detalle, venta, correlativo, cliente, movimiento_caja, sesion_caja, caja, lote, presentacion, producto, categoria, usuario restart identity cascade`);
  }
  const t0 = Date.now();
  const hoy = hoyLima();
  const inicio = sumarDias(hoy, -DIAS);
  const hash = await bcrypt.hash(PASSWORD, 10);

  const usuarios = await db.insert(schema.usuario).values([
    { nombre: "Rosa Huamán", login: "admin", passwordHash: hash, rol: "ADMIN" },
    { nombre: "Q.F. Lucía Paredes", login: "qf", passwordHash: hash, rol: "QF" },
    { nombre: "Miguel Rojas", login: "caja1", passwordHash: hash, rol: "CAJERO" },
    { nombre: "Carla Mendoza", login: "caja2", passwordHash: hash, rol: "CAJERO" },
    { nombre: "Jorge Salas", login: "caja3", passwordHash: hash, rol: "CAJERO" },
    { nombre: "Ana Torres", login: "caja4", passwordHash: hash, rol: "VENDEDOR" },
    { nombre: "Pedro Ccori", login: "almacen", passwordHash: hash, rol: "INVENTARIADOR" },
    { nombre: "Luis Vega", login: "contador", passwordHash: hash, rol: "CONTADOR" },
  ]).returning();
  const U = Object.fromEntries(usuarios.map((u) => [u.login, u]));
  const vendedores = [U.caja1, U.caja2, U.caja3, U.caja4];
  const cats = await db.insert(schema.categoria).values(CATEGORIAS.map((nombre) => ({ nombre }))).returning();
  const cajas = await db.insert(schema.caja).values(Array.from({ length: Number(process.env.SEED_CAJAS ?? 2) }, (_, i) => ({ nombre: `CAJA ${String(i + 1).padStart(2, "0")}` }))).returning();

  // ---------- Productos ----------
  type P = { id: number; base: Base; pres: { id: number; factor: number; pvp: number }[]; costoU: number; util: number; lotes: { id: number; numero: string; venc: string; cant: number; costo: number }[]; cp: number; stock: number };
  const defs: (Base & { codigo: string; lab: string; util: number })[] = [];
  BASE.forEach((b, i) => defs.push({ ...b, codigo: `7750${String(215000000 + i * 37).padStart(9, "0")}`, lab: elegir(LABS), util: ent(25, 45) }));
  for (let i = 0; i < N_SINT; i++) {
    const cat = rnd() < 0.6 ? 0 : ent(1, 6);
    const tipo = cat === 0 && rnd() < 0.8 ? "TAB" : "UNI";
    defs.push({ nombre: `${elegir(["Producto", "Fórmula", "Línea", "Presentación"])} ${CATEGORIAS[cat].split(" ")[0].toLowerCase()} ${i + 1}`, cat, precio: tipo === "TAB" ? r2(0.2 + rnd() * 2) : r2(3 + rnd() * 60), tipo, pop: rnd() < 0.15 ? 0 : 1 + Math.floor(rnd() * 2), pa: cat === 0 ? `Principio ${i % 400}` : undefined, codigo: `7790${String(300000000 + i * 13).padStart(9, "0")}`, lab: elegir(LABS), util: ent(25, 45) });
  }
  const prods: P[] = [];
  for (let i = 0; i < defs.length; i += 500) {
    const chunk = defs.slice(i, i + 500);
    const rows = await db.insert(schema.producto).values(chunk.map((d) => ({
      codigo: d.codigo, nombre: d.nombre, principioActivo: d.pa ?? null, concentracion: d.conc ?? null, laboratorio: d.lab, categoriaId: cats[d.cat].id,
      condicionVenta: (d.cond ?? "LIBRE") as "LIBRE" | "RECETA" | "RECETA_RETENIDA", stockMinimo: d.tipo === "TAB" ? 50 : 3, porcentajeUtilidad: d.util, ubicacion: `A${ent(1, 8)}-F${ent(1, 5)}`,
    }))).returning({ id: schema.producto.id });
    const presVals: (typeof schema.presentacion.$inferInsert)[] = [];
    rows.forEach((r, k) => {
      const d = chunk[k];
      if (d.tipo === "TAB") presVals.push({ productoId: r.id, nombre: "Unidad", factor: 1, pvp: d.precio }, { productoId: r.id, nombre: "Blíster x10", factor: 10, pvp: r2(Math.ceil(d.precio * 10 * 0.95 * 10) / 10) }, { productoId: r.id, nombre: "Caja x100", factor: 100, pvp: r2(Math.ceil(d.precio * 100 * 0.85)) });
      else presVals.push({ productoId: r.id, nombre: "Unidad", factor: 1, pvp: d.precio });
    });
    const pres = await db.insert(schema.presentacion).values(presVals).returning();
    rows.forEach((r, k) => {
      const d = chunk[k];
      prods.push({ id: r.id, base: d, pres: pres.filter((x) => x.productoId === r.id).map((x) => ({ id: x.id, factor: x.factor, pvp: x.pvp })), costoU: r4(d.precio / 1.18 / (1 + d.util / 100)), util: d.util, lotes: [], cp: 0, stock: 0 });
    });
  }

  // ---------- Lotes iniciales (inventario inicial) ----------
  const kardexRows: (typeof schema.kardex.$inferInsert)[] = [];
  const tsInicio = new Date(Date.parse(inicio + "T13:00:00Z"));
  const loteVals: { p: P; numero: string; venc: string; cant: number; costo: number }[] = [];
  for (const p of prods) {
    const diaria = p.base.pop * (p.base.tipo === "TAB" ? 6 : 0.6);
    const nl = 3;
    for (let k = 0; k < nl; k++) {
      const vencOffset = k === 0 ? (rnd() < 0.08 ? ent(-25, -1) : rnd() < 0.25 ? ent(5, 90) : ent(91, 260)) : k === 1 ? ent(200, 450) : ent(420, 720);
      const cant = Math.max(p.base.tipo === "TAB" ? 100 : 4, Math.round(diaria * DIAS * (0.25 + rnd() * 0.45)));
      loteVals.push({ p, numero: `${p.base.nombre.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "X")}${ent(1000, 9999)}${k}`, venc: sumarDias(hoy, vencOffset), cant, costo: r4(p.costoU * (0.95 + rnd() * 0.1)) });
    }
  }
  for (let i = 0; i < loteVals.length; i += 1000) {
    const chunk = loteVals.slice(i, i + 1000);
    const rows = await db.insert(schema.lote).values(chunk.map((l) => ({ productoId: l.p.id, numero: l.numero, vencimiento: l.venc, costoUnitario: l.costo, cantidad: l.cant }))).returning({ id: schema.lote.id });
    rows.forEach((r, k) => {
      const l = chunk[k];
      const p = l.p;
      p.cp = p.stock + l.cant > 0 ? (p.stock * p.cp + l.cant * l.costo) / (p.stock + l.cant) : l.costo;
      p.stock += l.cant;
      p.lotes.push({ id: r.id, numero: l.numero, venc: l.venc, cant: l.cant, costo: l.costo });
      kardexRows.push({ fecha: tsInicio, productoId: p.id, loteId: r.id, tipo: "INVENTARIO_INICIAL", documentoTipo: "INVENTARIO_INICIAL", documentoRef: "MIGRACIÓN", entrada: l.cant, costoUnitario: l.costo, saldoUnidades: p.stock, costoPromedio: r4(p.cp), saldoValorizado: r2(p.stock * p.cp), usuarioId: U.admin.id });
    });
  }

  // ---------- Catálogos ----------
  await db.insert(schema.motivo).values([
    { codigo: "VENCIMIENTO", nombre: "Vencimiento", tipo: "SALIDA", rolAprobador: "QF", requiereEvidencia: true },
    { codigo: "DETERIORO", nombre: "Deterioro / rotura", tipo: "SALIDA", rolAprobador: "QF", requiereEvidencia: true },
    { codigo: "ROBO", nombre: "Robo / pérdida", tipo: "SALIDA", rolAprobador: "ADMIN", requiereEvidencia: true },
    { codigo: "CONSUMO_INTERNO", nombre: "Consumo interno", tipo: "SALIDA", rolAprobador: "ADMIN", requiereAprobacion: false },
    { codigo: "MUESTRA_DONACION", nombre: "Muestra médica / donación", tipo: "SALIDA", rolAprobador: "ADMIN", requiereEvidencia: true },
    { codigo: "DEVOLUCION_PROVEEDOR", nombre: "Devolución a proveedor", tipo: "SALIDA", rolAprobador: "ADMIN", requiereEvidencia: true },
    { codigo: "RETIRO_DIGEMID", nombre: "Retiro por alerta DIGEMID", tipo: "SALIDA", rolAprobador: "QF", requiereEvidencia: true },
    { codigo: "AJUSTE_FALTANTE", nombre: "Ajuste por inventario (faltante)", tipo: "SALIDA", rolAprobador: "ADMIN", requiereEvidencia: true },
    { codigo: "AJUSTE_SOBRANTE", nombre: "Ajuste por inventario (sobrante)", tipo: "ENTRADA", rolAprobador: "ADMIN" },
    { codigo: "BONIFICACION", nombre: "Bonificación del proveedor", tipo: "ENTRADA", rolAprobador: "ADMIN" },
    { codigo: "DEVOLUCION_CLIENTE", nombre: "Devolución de cliente", tipo: "ENTRADA", rolAprobador: "ADMIN" },
  ]);
  await db.insert(schema.metrica).values([
    { codigo: "ticket_promedio", nombre: "Ticket promedio", formula: "ventas / tickets", unidad: "SOLES", roles: ["ADMIN", "QF", "CONTADOR"], enPanel: true, creadoPor: U.admin.id },
    { codigo: "tasa_complemento", nombre: "Tasa de complemento", formula: "tickets_complemento / tickets * 100", unidad: "PORCENTAJE", roles: ["ADMIN", "QF"], enPanel: true, creadoPor: U.admin.id },
    { codigo: "ventas_sin_igv", nombre: "Ventas sin IGV", formula: "ventas / 1.18", unidad: "SOLES", roles: ["ADMIN", "CONTADOR"], creadoPor: U.admin.id },
    { codigo: "margen_pct", nombre: "Margen bruto %", formula: "(ventas / 1.18 - costo_ventas) / (ventas / 1.18) * 100", unidad: "PORCENTAJE", roles: ["ADMIN"], enPanel: true, creadoPor: U.admin.id },
    { codigo: "unidades_por_ticket", nombre: "Unidades por ticket", formula: "unidades / tickets", unidad: "NUMERO", roles: ["ADMIN", "QF"], creadoPor: U.admin.id },
  ]);
  const porNombre = (s: string) => prods.find((p) => p.base.nombre.startsWith(s))!;
  const prob = porNombre("Probiótico"), vitc = porNombre("Vitamina C"), zinc = porNombre("Zinc"), toall = porNombre("Toallitas"), suero = porNombre("Suero oral"), compB = porNombre("Complejo B");
  await db.insert(schema.complemento).values([
    ...["Amoxicilina", "Azitromicina", "Ciprofloxacino", "Cefalexina", "Metronidazol"].map((pa) => ({ origenTipo: "PRINCIPIO_ACTIVO", origenValor: pa, productoId: prob.id, mensaje: "Sugerido con antibióticos", prioridad: 1 })),
    ...["Clorfenamina", "Paracetamol", "Ambroxol", "Dextrometorfano"].flatMap((pa) => [
      { origenTipo: "PRINCIPIO_ACTIVO", origenValor: pa, productoId: vitc.id, mensaje: "Sugerido con antigripales", prioridad: 2 },
      { origenTipo: "PRINCIPIO_ACTIVO", origenValor: pa, productoId: zinc.id, mensaje: "Refuerza las defensas", prioridad: 3 },
    ]),
    { origenTipo: "PRINCIPIO_ACTIVO", origenValor: "Loperamida", productoId: suero.id, mensaje: "Hidratación", prioridad: 1 },
    { origenTipo: "CATEGORIA", origenValor: String(cats[5].id), productoId: toall.id, mensaje: "Categoría bebés", prioridad: 2 },
    { origenTipo: "PRINCIPIO_ACTIVO", origenValor: "Metformina", productoId: compB.id, mensaje: "Complemento vitamínico", prioridad: 4 },
  ]);

  // ---------- Campañas: 10 activas, 5 programadas, 5 finalizadas ----------
  const candidatas = prods.filter((p) => [1, 2, 4].includes(p.base.cat)).slice(0, 20);
  while (candidatas.length < 20) candidatas.push(prods[candidatas.length + 100] ?? prods[candidatas.length]);
  const campVals = candidatas.map((p, i) => {
    const pct = r2(3 + (i % 5));
    if (i < 10) return { nombre: `${p.base.nombre.split(" ·")[0]} · promoción`, productoId: p.id, porcentaje: pct, inicio: sumarDias(hoy, -ent(10, 40)), fin: sumarDias(hoy, i < 2 ? 2 : ent(15, 60)), estado: "ACTIVA" };
    if (i < 15) return { nombre: `${p.base.nombre.split(" ·")[0]} · próxima`, productoId: p.id, porcentaje: pct, inicio: sumarDias(hoy, ent(3, 20)), fin: sumarDias(hoy, ent(30, 60)), estado: "PROGRAMADA" };
    return { nombre: `${p.base.nombre.split(" ·")[0]} · temporada pasada`, productoId: p.id, porcentaje: pct, inicio: sumarDias(hoy, -ent(80, 120)), fin: sumarDias(hoy, -ent(45, 70)), estado: "FINALIZADA" };
  });
  const camps = await db.insert(schema.campana).values(campVals.map((c) => ({ ...c, creadoPor: U.admin.id }))).returning();

  // ---------- Simulación de ventas día por día ----------
  const pesos = prods.map((p) => p.base.pop);
  const totalPeso = pesos.reduce((a, b) => a + b, 0);
  const elegirProducto = () => { let x = rnd() * totalPeso; for (let i = 0; i < prods.length; i++) { x -= pesos[i]; if (x <= 0) return prods[i]; } return prods[0]; };
  const ventaVals: (typeof schema.venta.$inferInsert)[] = [];
  type DetTmp = { ventaIdx: number; v: typeof schema.ventaDetalle.$inferInsert; camp?: { id: number; pct: number }; usuarioId: number; fecha: string; lote: { id: number } };
  const detTmp: DetTmp[] = [];
  const pagoTmp: { ventaIdx: number; medio: "EFECTIVO" | "YAPE" | "PLIN" | "TARJETA"; monto: number }[] = [];
  const sesiones: (typeof schema.sesionCaja.$inferInsert & { _idx: number })[] = [];
  const numeros: Record<string, number> = { B001: 0, F001: 0, NV01: 0 };
  const proveedores = await db.insert(schema.proveedor).values([
    { ruc: "20100000011", razonSocial: "Distribuidora Farmacéutica del Norte S.A.C." }, { ruc: "20100000022", razonSocial: "Droguería Lima Centro S.A." },
    { ruc: "20100000033", razonSocial: "Química Suiza Distribución S.A." }, { ruc: "20100000044", razonSocial: "Corporación Salud Total S.A.C." },
  ]).returning();
  const compraTmp: { fecha: string; prov: number; items: { p: P; cant: number; numero: string; venc: string; costo: number }[] }[] = [];
  let ventasCreadas = 0;

  const horaLima = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "2-digit", hour12: false }).format(new Date())) % 24;
  const enHora = (fecha: string, h: number, min = 0) => new Date(Date.parse(fecha + "T00:00:00Z") + ((h + 5) * 60 + min) * 60000);
  for (let dia = 0; dia <= DIAS; dia++) {
    const fecha = sumarDias(inicio, dia);
    const esHoy = fecha === hoy;
    if (esHoy && horaLima < 9) break;
    const turnos = esHoy
      ? [{ cajero: vendedores[0], turno: "MAÑANA", h0: 8, h1: Math.min(15, horaLima), caja: cajas[0] }]
      : [{ cajero: vendedores[dia % 2], turno: "MAÑANA", h0: 8, h1: 15, caja: cajas[0] }, { cajero: vendedores[2 + (dia % 2)], turno: "TARDE", h0: 15, h1: 22, caja: cajas[0] }];
    const finDeMes = Number(fecha.slice(8)) >= 25 ? 1.25 : 1;
    const nVentas = Math.round(VENTAS_DIA * finDeMes * (0.8 + rnd() * 0.4));
    for (const t of turnos) {
      const sIdx = sesiones.length;
      sesiones.push({ _idx: sIdx, cajaId: t.caja.id, usuarioId: t.cajero.id, turno: t.turno, abiertaEn: enHora(fecha, t.h0), cerradaEn: esHoy ? null : enHora(fecha, t.h1, -2), fondoInicial: 150, conteoApertura: { "100": 1, "20": 2, "10": 1 }, estado: esHoy ? "ABIERTA" : "CERRADA", fondoSiguiente: esHoy ? null : 150 });
      const nTurno = Math.round((nVentas / 2) * (t.h1 - t.h0) / 7);
      const minutos = Array.from({ length: nTurno }, () => ent(0, Math.max(10, (t.h1 - t.h0) * 60 - 5))).sort((x, y) => x - y);
      for (let k = 0; k < nTurno; k++) {
        const min = minutos[k];
        const ts = enHora(fecha, t.h0, min);
        if (ts.getTime() > Date.now()) continue;
        const items: { p: P; pres: P["pres"][number]; cant: number; origen: string }[] = [];
        const nItems = rnd() < 0.6 ? 1 : rnd() < 0.8 ? 2 : 3;
        for (let j = 0; j < nItems; j++) {
          const p = elegirProducto();
          if (items.some((x) => x.p.id === p.id)) continue;
          const pres = p.base.tipo === "TAB" ? (rnd() < 0.55 ? p.pres[0] : rnd() < 0.9 ? p.pres[1] : p.pres[2]) : p.pres[0];
          const cant = pres.factor === 1 && p.base.tipo === "TAB" ? ent(2, 12) : 1;
          items.push({ p, pres, cant, origen: "DIRECTA" });
        }
        if (rnd() < 0.18) { const c = elegir([prob, vitc, zinc]); if (!items.some((x) => x.p.id === c.id)) items.push({ p: c, pres: c.pres[0], cant: 1, origen: "SUGERENCIA" }); }
        const vIdx = ventaVals.length;
        let total = 0, costo = 0; const dets: DetTmp[] = [];
        for (const it of items) {
          let unidades = it.cant * it.pres.factor;
          const vig = it.p.lotes.filter((l) => l.cant > 0 && l.venc > fecha).sort((a, b) => a.venc.localeCompare(b.venc));
          const disp = vig.reduce((s, l) => s + l.cant, 0);
          if (disp < unidades) continue;
          const subtotalLinea = r2(it.pres.pvp * it.cant);
          let resto = subtotalLinea; const totalU = unidades;
          for (const l of vig) {
            if (unidades <= 0) break;
            const toma = Math.min(l.cant, unidades);
            l.cant -= toma; unidades -= toma; it.p.stock -= toma;
            const parte = unidades === 0 ? r2(resto) : r2(subtotalLinea * toma / totalU); resto = r2(resto - parte);
            costo += it.p.cp * toma;
            const camp = camps.find((c) => c.productoId === it.p.id && c.inicio <= fecha && c.fin >= fecha && c.estado !== "PROGRAMADA");
            const d: DetTmp = { ventaIdx: vIdx, lote: l, usuarioId: t.cajero.id, fecha, camp: camp ? { id: camp.id, pct: camp.porcentaje } : undefined, v: { ventaId: 0, productoId: it.p.id, presentacionId: it.pres.id, loteId: l.id, cantidad: toma / it.pres.factor, unidades: toma, precioUnitario: it.pres.pvp, subtotal: parte, costoUnitario: r4(it.p.cp), origen: it.origen } };
            dets.push(d);
            kardexRows.push({ fecha: ts, productoId: it.p.id, loteId: l.id, tipo: "VENTA", documentoTipo: "BOLETA", documentoId: null, documentoRef: "", salida: toma, costoUnitario: r4(it.p.cp), saldoUnidades: it.p.stock, costoPromedio: r4(it.p.cp), saldoValorizado: r2(it.p.stock * it.p.cp), usuarioId: t.cajero.id });
            (kardexRows[kardexRows.length - 1] as { _lote?: object })._lote = l;
          }
          total += subtotalLinea;
        }
        if (!dets.length) continue;
        total = r2(total);
        const tipo = total > 60 && rnd() < 0.08 ? "FACTURA" : rnd() < 0.05 ? "NOTA_VENTA" : "BOLETA";
        const serie = tipo === "FACTURA" ? "F001" : tipo === "NOTA_VENTA" ? "NV01" : "B001";
        numeros[serie]++;
        const kStart = kardexRows.length - dets.length;
        for (let z = kStart; z < kardexRows.length; z++) { kardexRows[z].documentoTipo = tipo; kardexRows[z].documentoRef = `${serie}-${String(numeros[serie]).padStart(6, "0")}`; }
        const sub = r2(total / 1.18);
        ventaVals.push({ sesionId: sIdx, usuarioId: t.cajero.id, tipoComprobante: tipo, serie, numero: numeros[serie], fecha: ts, subtotal: sub, igv: r2(total - sub), total, costoTotal: r2(costo), cpeEstado: tipo === "NOTA_VENTA" ? "NO_APLICA" : "ACEPTADO", receta: dets.some((d) => prods.find((p) => p.id === d.v.productoId)!.base.cond) ? { medico: "Dr. Carlos Ríos", cmp: "045123", numero: `R-${ent(1000, 9999)}` } : null });
        detTmp.push(...dets);
        const medio = rnd() < 0.55 ? "EFECTIVO" : rnd() < 0.7 ? "YAPE" : rnd() < 0.85 ? "PLIN" : "TARJETA";
        pagoTmp.push({ ventaIdx: vIdx, medio, monto: total });
        ventasCreadas++;
      }
    }
    // Reposición: cada 7 días se compra lo que está por agotarse (deja algunos productos sin reponer para que existan alertas)
    if (!esHoy && dia % 7 === 6 && dia < DIAS - 3) {
      const bajos = prods.filter((p) => p.base.pop >= 3 && p.lotes.filter((l) => l.venc > fecha).reduce((s, l) => s + l.cant, 0) < p.base.pop * (p.base.tipo === "TAB" ? 6 : 0.6) * 10 && rnd() < 0.8).slice(0, 25);
      if (bajos.length) {
        const items = bajos.map((p) => ({ p, cant: Math.round(p.base.pop * (p.base.tipo === "TAB" ? 6 : 0.6) * ent(20, 35)) + 1, numero: `C${fecha.replace(/-/g, "").slice(2)}${p.id}`, venc: sumarDias(fecha, ent(300, 700)), costo: r4(p.costoU * (0.97 + rnd() * 0.08)) }));
        compraTmp.push({ fecha, prov: proveedores[dia % 4].id, items });
        const ts = enHora(fecha, 22, 30);
        for (const it of items) {
          const p = it.p;
          p.cp = (p.stock * p.cp + it.cant * it.costo) / (p.stock + it.cant); p.stock += it.cant;
          const l = { id: -1, numero: it.numero, venc: it.venc, cant: it.cant, costo: it.costo };
          p.lotes.push(l);
          kardexRows.push({ fecha: ts, productoId: p.id, loteId: null, tipo: "COMPRA", documentoTipo: "FACTURA", documentoRef: `F0${dia % 9 + 1}-${1000 + compraTmp.length}`, entrada: it.cant, costoUnitario: it.costo, saldoUnidades: p.stock, costoPromedio: r4(p.cp), saldoValorizado: r2(p.stock * p.cp), usuarioId: U.admin.id });
          (kardexRows[kardexRows.length - 1] as { _lote?: object })._lote = l;
        }
      }
    }
  }

  // Lotes creados por compras simuladas
  const nuevosLotes = prods.flatMap((p) => p.lotes.filter((l) => l.id === -1).map((l) => ({ p, l })));
  for (let i = 0; i < nuevosLotes.length; i += 1000) {
    const chunk = nuevosLotes.slice(i, i + 1000);
    const rows = await db.insert(schema.lote).values(chunk.map(({ p, l }) => ({ productoId: p.id, numero: l.numero, vencimiento: l.venc, costoUnitario: l.costo, cantidad: 0 }))).returning({ id: schema.lote.id });
    rows.forEach((r, k) => { chunk[k].l.id = r.id; });
  }
  for (const k of kardexRows) { const l = (k as { _lote?: { id: number } })._lote; if (l) { k.loteId = l.id; delete (k as { _lote?: object })._lote; } }

  // Compras confirmadas
  for (const c of compraTmp) {
    const [cp] = await db.insert(schema.compra).values({ proveedorId: c.prov, tipoComprobante: "FACTURA", serie: `F0${(c.prov % 9) + 1}`, numero: String(1000 + compraTmp.indexOf(c)), fechaEmision: c.fecha, estado: "CONFIRMADA", registradoPor: U.almacen.id, costeadoPor: U.admin.id, costeadoEn: new Date(Date.parse(c.fecha + "T23:40:00Z")), total: r2(c.items.reduce((s, i) => s + i.cant * i.costo, 0)) }).returning();
    await db.insert(schema.compraDetalle).values(c.items.map((it) => ({ compraId: cp.id, productoId: it.p.id, presentacionId: it.p.pres[0].id, cantidad: it.cant, unidades: it.cant, numeroLote: it.numero, vencimiento: it.venc, costoPresentacion: it.costo, loteId: it.p.lotes.find((l) => l.numero === it.numero)!.id })));
  }

  // Sesiones de caja con arqueo
  const sesRows = await db.insert(schema.sesionCaja).values(sesiones.map(({ _idx, ...s }) => s)).returning({ id: schema.sesionCaja.id });
  const ventaPorSesion = new Map<number, number[]>();
  ventaVals.forEach((v, i) => { const s = v.sesionId as number; v.sesionId = sesRows[s].id; if (!ventaPorSesion.has(s)) ventaPorSesion.set(s, []); ventaPorSesion.get(s)!.push(i); });
  for (let i = 0; i < ventaVals.length; i += 1000) {
    const chunk = ventaVals.slice(i, i + 1000);
    const rows = await db.insert(schema.venta).values(chunk).returning({ id: schema.venta.id });
    rows.forEach((r, k) => { (chunk[k] as { _id?: number })._id = r.id; });
  }
  const idVenta = (idx: number) => (ventaVals[idx] as { _id?: number })._id!;
  const detIds: number[] = [];
  for (let i = 0; i < detTmp.length; i += 1000) {
    const chunk = detTmp.slice(i, i + 1000);
    const rows = await db.insert(schema.ventaDetalle).values(chunk.map((d) => ({ ...d.v, loteId: d.lote.id, ventaId: idVenta(d.ventaIdx) }))).returning({ id: schema.ventaDetalle.id });
    detIds.push(...rows.map((r) => r.id));
  }
  for (let i = 0; i < pagoTmp.length; i += 1000) await db.insert(schema.ventaPago).values(pagoTmp.slice(i, i + 1000).map((p) => ({ ventaId: idVenta(p.ventaIdx), medio: p.medio, monto: p.monto })));
  // kardex: completar documentoId de ventas por referencia
  const refAId = new Map(ventaVals.map((v, i) => [`${v.serie}-${String(v.numero).padStart(6, "0")}`, idVenta(i)]));
  for (const k of kardexRows) if (k.tipo === "VENTA") k.documentoId = refAId.get(k.documentoRef ?? "") ?? null;
  kardexRows.sort((a, b) => (a.fecha as Date).getTime() - (b.fecha as Date).getTime());
  for (let i = 0; i < kardexRows.length; i += 2000) await db.insert(schema.kardex).values(kardexRows.slice(i, i + 2000));

  // Arqueos: esperado por medio, con algunas diferencias
  for (const [sIdx, idxs] of ventaPorSesion) {
    if (sesiones[sIdx].estado === "ABIERTA") continue;
    const esperado: Record<string, number> = { EFECTIVO: 150, YAPE: 0, PLIN: 0, TARJETA: 0, TRANSFERENCIA: 0 };
    for (const i of idxs) { const p = pagoTmp.find((x) => x.ventaIdx === i); if (p) esperado[p.medio] = r2(esperado[p.medio] + p.monto); }
    const dif = rnd() < 0.06 ? -r2(5 + rnd() * 15) : rnd() < 0.2 ? r2((rnd() - 0.5) * 2) : 0;
    const contado = { ...esperado, EFECTIVO: r2(esperado.EFECTIVO + dif) };
    await db.update(schema.sesionCaja).set({ esperado, contado, diferencia: dif, retiro: r2(contado.EFECTIVO - 150), validadoPor: Math.abs(dif) > 5 ? U.admin.id : null, observacion: Math.abs(dif) > 5 ? "Vuelto mal entregado" : null }).where(sql`id = ${sesRows[sIdx].id}`);
  }

  // Comisiones: devengadas por línea; días anteriores consolidados; meses anteriores liquidados y pagados
  const mesActual = hoy.slice(0, 7);
  const comVals: (typeof schema.comision.$inferInsert)[] = [];
  detTmp.forEach((d, i) => {
    if (!d.camp) return;
    const base = r2((d.v.subtotal as number) / 1.18);
    comVals.push({ ventaId: idVenta(d.ventaIdx), ventaDetalleId: detIds[i], usuarioId: d.usuarioId, campanaId: d.camp.id, porcentaje: d.camp.pct, base, monto: r2(base * d.camp.pct / 100), origen: d.v.origen as string, estado: "DEVENGADA", fecha: d.fecha });
  });
  const diarias = new Map<string, { usuarioId: number; fecha: string; total: number; n: number }>();
  for (const c of comVals) {
    if (c.fecha === hoy) continue;
    const k = `${c.usuarioId}|${c.fecha}`;
    const x = diarias.get(k) ?? { usuarioId: c.usuarioId, fecha: c.fecha, total: 0, n: 0 };
    x.total = r2(x.total + (c.monto as number)); x.n++; diarias.set(k, x);
  }
  const liqs = new Map<string, number>();
  const meses = new Map<string, number>();
  for (const d of diarias.values()) if (d.fecha.slice(0, 7) < mesActual) meses.set(`${d.usuarioId}|${d.fecha.slice(0, 7)}`, r2((meses.get(`${d.usuarioId}|${d.fecha.slice(0, 7)}`) ?? 0) + d.total));
  for (const [k, total] of meses) {
    const [usuarioId, mes] = k.split("|");
    const [l] = await db.insert(schema.liquidacionMensual).values({ usuarioId: Number(usuarioId), mes, total, aprobadoPor: U.admin.id, estado: "PAGADA", pagadoEn: new Date() }).returning({ id: schema.liquidacionMensual.id });
    liqs.set(k, l.id);
  }
  const diariaIds = new Map<string, number>();
  const dv = [...diarias.values()];
  for (let i = 0; i < dv.length; i += 1000) {
    const chunk = dv.slice(i, i + 1000);
    const rows = await db.insert(schema.comisionDiaria).values(chunk.map((d) => ({ usuarioId: d.usuarioId, fecha: d.fecha, lineas: d.n, total: d.total, liquidacionId: liqs.get(`${d.usuarioId}|${d.fecha.slice(0, 7)}`) ?? null }))).returning({ id: schema.comisionDiaria.id });
    rows.forEach((r, k) => diariaIds.set(`${chunk[k].usuarioId}|${chunk[k].fecha}`, r.id));
  }
  for (const c of comVals) {
    if (c.fecha === hoy) continue;
    c.comisionDiariaId = diariaIds.get(`${c.usuarioId}|${c.fecha}`);
    c.estado = (c.fecha as string).slice(0, 7) < mesActual ? "PAGADA" : "CONSOLIDADA";
  }
  for (let i = 0; i < comVals.length; i += 1000) await db.insert(schema.comision).values(comVals.slice(i, i + 1000));

  // Correlativos y pendientes para probar flujos
  await db.insert(schema.correlativo).values(Object.entries(numeros).map(([serie, ultimo]) => ({ serie, ultimo })));
  const pendientes = prods.filter((p) => p.base.pop >= 4).slice(0, 3);
  for (let i = 0; i < 2; i++) {
    const [c] = await db.insert(schema.compra).values({ proveedorId: proveedores[i].id, tipoComprobante: "FACTURA", serie: "F001", numero: String(9000 + i), fechaEmision: sumarDias(hoy, -i), estado: "PENDIENTE_COSTO", registradoPor: U.almacen.id }).returning();
    await db.insert(schema.compraDetalle).values(pendientes.map((p) => ({ compraId: c.id, productoId: p.id, presentacionId: p.pres[p.pres.length - 1].id, cantidad: 2, unidades: 2 * p.pres[p.pres.length - 1].factor, numeroLote: `PEND${i}${p.id}`, vencimiento: sumarDias(hoy, 500) })));
  }
  // Actualizar stock real de lotes y costo promedio
  const lotesFinal = prods.flatMap((p) => p.lotes);
  for (let i = 0; i < lotesFinal.length; i += 500) {
    const chunk = lotesFinal.slice(i, i + 500);
    await db.execute(sql`update lote set cantidad = v.cant from (values ${sql.join(chunk.map((l) => sql`(${l.id}::int, ${l.cant}::int)`), sql`, `)}) as v(id, cant) where lote.id = v.id`);
  }
  for (let i = 0; i < prods.length; i += 500) {
    const chunk = prods.slice(i, i + 500);
    await db.execute(sql`update producto set costo_promedio = v.cp from (values ${sql.join(chunk.map((p) => sql`(${p.id}::int, ${r4(p.cp)}::numeric)`), sql`, `)}) as v(id, cp) where producto.id = v.id`);
  }
  if (process.env.SEED_PRUEBA_CONCURRENCIA === "1") {
    // Producto aislado con un único lote de 10 unidades para la prueba de concurrencia de stock
    const [pc] = await db.insert(schema.producto).values({ codigo: "PRUEBA-CONCURRENCIA", nombre: "Producto de prueba de concurrencia", categoriaId: cats[0].id, costoPromedio: 1 }).returning();
    await db.insert(schema.presentacion).values({ productoId: pc.id, nombre: "Unidad", factor: 1, pvp: 2 });
    const [lc] = await db.insert(schema.lote).values({ productoId: pc.id, numero: "CONC1", vencimiento: sumarDias(hoy, 365), costoUnitario: 1, cantidad: 10 }).returning();
    await db.insert(schema.kardex).values({ productoId: pc.id, loteId: lc.id, tipo: "INVENTARIO_INICIAL", documentoTipo: "INVENTARIO_INICIAL", entrada: 10, costoUnitario: 1, saldoUnidades: 10, costoPromedio: 1, saldoValorizado: 10 });
  }
  const res = await evaluarAlertas(db);
  return `Listo en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${prods.length} productos, ${lotesFinal.length} lotes, ${ventasCreadas} ventas, ${kardexRows.length} líneas de kardex, ${comVals.length} comisiones, ${camps.length} campañas, ${res.evaluadas} alertas. Usuarios: admin, qf, caja1..caja4, almacen, contador · clave: ${PASSWORD}`;
}
