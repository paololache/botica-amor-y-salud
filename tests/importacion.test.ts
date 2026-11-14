import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { aplicarImportacion, interpretarFilas, nombreCategoria, unidadesDelNombre } from "@/lib/importacion";
import { filas as consultar } from "@/lib/sqlrows";
import { hoy, sumarDias } from "@/lib/util";

const ENC = ["Codigo", "Categoria", "Laboratorio", "Nombre", "Precio Caja", "PVP1", "Precio Costo Unitario", "Precio Blister", "Stock", "Stock min", "Lote", "F. Vencimiento", "Prin A."];
const lejos = sumarDias(hoy(), 700);
const EXCEL: (string | null)[][] = [
  ["BOTICA AMOR Y SALUD\nFecha: 09.11.26"],
  ENC,
  ["000000000013", "P. FARMACEUTICO", "PORTUGAL", "ABRIMED 35MG/5ML X 120 ML", "0", "18", "7.5", "0", "3", "1", "L1", lejos, "HEREDA HELIX"],
  ["000000001443", "P. FARMACEUTICO", "PORTUGAL", "CETIRIZINA 10 MG", "0", "0.5", "0.1", "3", "100", "20", "C1", lejos, "CETIRIZINA"],
  ["000000001443", "P. FARMACEUTICO", "PORTUGAL", "CETIRIZINA 10 MG", "0", "0.5", "0.2", "3", "50", "20", "C2", sumarDias(hoy(), 900), "CETIRIZINA"],
  ["000000003399", "MEDICINA", "Laboratorios Portugal S.A.", "FUROSEMIDA 40 MG X 100 TAB", "15", "0.2", "0.05", "0", "200", "10", "F1", lejos, null],
  ["000000004444", "P. SANITARIO", "OTROS", "GEL DE BAÑO", "0", "5", "6", "0", "2", "1", "G1", sumarDias(hoy(), -10), null],
  ["000000005555", "P. GALENICO", "OTROS", "MELATONINA", "26.5", "0", "0.28", "0", "5", "1", "M1", lejos, null],
  ["000000013378", "MEDICINA", "OTROS", "APLICACION DE INYECTABLES PRODUCTO EXTERNO", "2", "3", null, "0", "100000000", "1", "P. SIN LOTE", null, null],
  ["000000008204", "MEDICINA", "OTROS", "APLICACION INYECTABLE INTERNO", "1", "10", null, "0", "100000000", "1", "P. SIN LOTE", null, null],
  ["000000013241", "MEDICINA", "OTROS", "SERVICIO DE INYECTABLE INTRAVENOSO", "7", "30", null, "0", "100000000", "1", "P. SIN LOTE", null, null],
];

let db: Db;
beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
});

describe("Importación del Excel de productos", () => {
  it("interpreta: un producto por código con sus lotes, separa servicios y anota lo que hay que revisar", () => {
    expect(unidadesDelNombre("FUROSEMIDA 40 MG X 100 TAB")).toBe(100);
    expect(unidadesDelNombre("MAGNESOL X 33 SOBRES X 2 G")).toBe(33);
    expect(unidadesDelNombre("ABRIMED 35MG/5ML X 120 ML")).toBeNull();
    expect(nombreCategoria("GALENICOS")).toBe("Productos galénicos");
    expect(nombreCategoria("CUIDADO PERSONAL")).toBe("Cuidado personal");
    const plan = interpretarFilas(EXCEL);
    expect(plan.productos).toHaveLength(5);
    expect(plan.servicios.map((s) => s.precio)).toEqual([3, 10, 30]);
    const cet = plan.productos.find((p) => p.codigo === "000000001443")!;
    expect(cet.lotes.map((l) => [l.numero, l.cantidad])).toEqual([["C1", 100], ["C2", 50]]);
    expect(cet.costo).toBeCloseTo((100 * 0.1 + 50 * 0.2) / 150, 4);
    expect(plan.productos.find((p) => p.codigo === "000000003399")!.caja).toEqual({ factor: 100, pvp: 15 });
    expect(plan.productos.find((p) => p.codigo === "000000005555")!.activo).toBe(false);
    expect(cet.patologias).toBe("antihistamínico, alergia, rinitis, urticaria");
    const conColumna = interpretarFilas([ENC.concat("Patologia"), [...EXCEL[2], "ANALGESICO - ANTIPIRETICO"]].map((f) => f as (string | null)[]));
    expect(conColumna.productos[0].patologias).toBe("analgesico, antipiretico");
    const tipos = plan.observaciones.map((o) => `${o.codigo}:${o.tipo}`);
    expect(tipos).toEqual(expect.arrayContaining(["000000001443:BLISTER_POR_COMPLETAR", "000000004444:VENCIDO", "000000004444:BAJO_COSTO", "000000005555:SIN_PRECIO", "000000005555:CAJA_POR_COMPLETAR"]));
    expect(() => interpretarFilas([["Algo"], ["sin encabezados"]])).toThrow(/encabezados/);
  });

  it("reemplaza los datos de prueba y carga el stock como inventario inicial; el kardex cuadra con los lotes", async () => {
    // Datos «de prueba» previos que deben desaparecer; los usuarios se conservan.
    const [u] = await db.insert(schema.usuario).values({ nombre: "Admin", login: "admin", passwordHash: "x", roles: ["ADMIN"] }).returning();
    const [lab] = await db.insert(schema.laboratorio).values({ nombre: "Demo", clave: "demo" }).returning();
    await db.insert(schema.producto).values({ codigo: "DEMO1", nombre: "Producto demo", laboratorioId: lab.id });
    const r = await aplicarImportacion(db, interpretarFilas(EXCEL), { reemplazar: true, usuarioId: u.id });
    expect(r).toMatchObject({ creados: 5, actualizados: 0, lotes: 6, unidades: 360 });
    expect(await db.select().from(schema.producto).where(eq(schema.producto.codigo, "DEMO1"))).toHaveLength(0);
    expect(await db.select().from(schema.usuario)).toHaveLength(1);
    const [c] = await consultar<{ lotes: string; kardex: string }>(db, sql`select (select sum(cantidad) from lote) lotes, (select sum(entrada - salida) from kardex) kardex`);
    expect(Number(c.lotes)).toBe(360);
    expect(Number(c.kardex)).toBe(360);
    const [gel] = await db.select().from(schema.lote).where(eq(schema.lote.numero, "G1"));
    expect(gel.estado).toBe("VENCIDO");
    const [furo] = await db.select().from(schema.producto).where(eq(schema.producto.codigo, "000000003399"));
    expect((await db.select().from(schema.presentacion).where(eq(schema.presentacion.productoId, furo.id))).map((p) => [p.nombre, p.factor, p.pvp])).toEqual([["Unidad", 1, 0.2], ["Caja x100", 100, 15]]);
    const labs = await db.select().from(schema.laboratorio);
    expect(labs.filter((l) => l.clave === "portugal")).toHaveLength(1); // «PORTUGAL» y «Laboratorios Portugal S.A.» son el mismo
    const im = (await db.select().from(schema.servicio).where(eq(schema.servicio.codigo, "INY-IM")))[0];
    expect(im).toMatchObject({ precio: 10, precioExterno: 3 });
    expect((await db.select().from(schema.servicio).where(eq(schema.servicio.codigo, "INY-IV")))[0]).toMatchObject({ precioExterno: 30 });
    // Sin reemplazar, un segundo pase actualiza datos y precio pero no duplica stock.
    const otra = EXCEL.map((f, i) => (i === 3 ? [...f.slice(0, 5), "0.6", ...f.slice(6)] : f));
    const r2 = await aplicarImportacion(db, interpretarFilas(otra), { reemplazar: false, usuarioId: u.id });
    expect(r2).toMatchObject({ creados: 0, actualizados: 5, lotes: 0, sinStockCargado: 5 });
    const [cet] = await db.select().from(schema.producto).where(eq(schema.producto.codigo, "000000001443"));
    expect((await db.select().from(schema.presentacion).where(eq(schema.presentacion.productoId, cet.id)))[0].pvp).toBe(0.6);
    expect(Number((await consultar<{ s: string }>(db, sql`select sum(cantidad) s from lote`))[0].s)).toBe(360);
  });
});
