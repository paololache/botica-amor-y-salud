import bcrypt from "bcryptjs";
import { getDb, schema, type Db } from "@/db";
import type { Sesion } from "@/lib/auth";
import { hoy, sumarDias } from "@/lib/util";

export async function preparar() {
  const db = await getDb();
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db as never, { migrationsFolder: "drizzle" });
  return db;
}

export async function base(db: Db) {
  const h = await bcrypt.hash("x", 4);
  const [admin, qf, caja1, caja2, almacen] = await db.insert(schema.usuario).values([
    { nombre: "Admin", login: "admin", passwordHash: h, rol: "ADMIN" },
    { nombre: "QF", login: "qf", passwordHash: h, rol: "QF" },
    { nombre: "Caja 1", login: "caja1", passwordHash: h, rol: "CAJERO" },
    { nombre: "Caja 2", login: "caja2", passwordHash: h, rol: "CAJERO" },
    { nombre: "Almacén", login: "almacen", passwordHash: h, rol: "INVENTARIADOR" },
  ]).returning();
  const s = (u: typeof admin): Sesion => ({ id: u.id, nombre: u.nombre, login: u.login, rol: u.rol });
  const [cat] = await db.insert(schema.categoria).values({ nombre: "Vitaminas" }).returning();
  const [c1] = await db.insert(schema.caja).values({ nombre: "CAJA 01" }).returning();
  const [c2] = await db.insert(schema.caja).values({ nombre: "CAJA 02" }).returning();
  const [vit] = await db.insert(schema.producto).values({ codigo: "111", nombre: "Vitamina C 1 g", categoriaId: cat.id, costoPromedio: 10, porcentajeUtilidad: 40 }).returning();
  const [pres] = await db.insert(schema.presentacion).values({ productoId: vit.id, nombre: "Unidad", factor: 1, pvp: 18 }).returning();
  const [amox] = await db.insert(schema.producto).values({ codigo: "222", nombre: "Amoxicilina 500 mg", principioActivo: "Amoxicilina", condicionVenta: "RECETA", costoPromedio: 0.4 }).returning();
  const [presAmox] = await db.insert(schema.presentacion).values({ productoId: amox.id, nombre: "Blíster x10", factor: 10, pvp: 6 }).returning();
  const hoyL = hoy();
  const [vencido, proximo, lejano] = await db.insert(schema.lote).values([
    { productoId: vit.id, numero: "VENCIDO", vencimiento: sumarDias(hoyL, -1), costoUnitario: 10, cantidad: 5 },
    { productoId: vit.id, numero: "PROXIMO", vencimiento: sumarDias(hoyL, 40), costoUnitario: 10, cantidad: 3 },
    { productoId: vit.id, numero: "LEJANO", vencimiento: sumarDias(hoyL, 400), costoUnitario: 10, cantidad: 10 },
  ]).returning();
  const [loteAmox] = await db.insert(schema.lote).values({ productoId: amox.id, numero: "AM1", vencimiento: sumarDias(hoyL, 300), costoUnitario: 0.4, cantidad: 100 }).returning();
  await db.insert(schema.kardex).values([vencido, proximo, lejano].map((l) => ({ productoId: vit.id, loteId: l.id, tipo: "INVENTARIO_INICIAL", documentoTipo: "INVENTARIO_INICIAL", entrada: l.cantidad, costoUnitario: 10, saldoUnidades: 18, costoPromedio: 10, saldoValorizado: 180 })));
  await db.insert(schema.motivo).values([
    { codigo: "VENCIMIENTO", nombre: "Vencimiento", tipo: "SALIDA", rolAprobador: "QF", requiereEvidencia: true },
    { codigo: "CONSUMO_INTERNO", nombre: "Consumo interno", tipo: "SALIDA", rolAprobador: "ADMIN", requiereAprobacion: false },
  ]);
  return { admin: s(admin), qf: s(qf), caja1: s(caja1), caja2: s(caja2), almacen: s(almacen), vit, pres, amox, presAmox, lotes: { vencido, proximo, lejano, loteAmox }, cajas: [c1, c2] };
}
