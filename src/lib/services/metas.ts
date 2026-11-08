import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { Sesion } from "../auth";
import { tieneRol } from "../permisos";
import { filas } from "../sqlrows";
import { ErrorNegocio, hoy as hoyLima, inicioDiaLima, r2, sumarDias } from "../util";

export type MetaDia = { objetivo: number | null; vendido: number; porcentaje: number | null; faltante: number | null; automatica: boolean };

/** Meta automática: promedio de lo vendido en mostrador por día trabajado (últimos 30 días) + 10 %, redondeado a S/ 10. */
async function metaAutomatica(db: Db, usuarioId: number, hoy: string) {
  const [r] = await filas<{ promedio: string | null }>(db, sql`
    select avg(t) as promedio from (
      select date_trunc('day', fecha at time zone 'America/Lima') as dia, sum(total) as t
      from venta where usuario_id = ${usuarioId} and estado = 'EMITIDA' and canal = 'MOSTRADOR'
        and fecha >= ${inicioDiaLima(sumarDias(hoy, -30)).toISOString()} and fecha < ${inicioDiaLima(hoy).toISOString()}
      group by 1) d`);
  const promedio = Number(r?.promedio ?? 0);
  return promedio > 0 ? Math.max(10, Math.ceil((promedio * 1.1) / 10) * 10) : null;
}

/** Avance del día de un usuario frente a su meta (la fijada por el administrador o la automática). */
export async function metaDelDia(db: Db, usuarioId: number): Promise<MetaDia> {
  const hoy = hoyLima();
  const [u] = await db.select({ meta: schema.usuario.metaDiaria }).from(schema.usuario).where(eq(schema.usuario.id, usuarioId));
  const [v] = await filas<{ total: string | null }>(db, sql`
    select sum(total) as total from venta where usuario_id = ${usuarioId} and estado = 'EMITIDA' and canal = 'MOSTRADOR' and fecha >= ${inicioDiaLima(hoy).toISOString()}`);
  const vendido = r2(Number(v?.total ?? 0));
  const fija = u?.meta != null && u.meta > 0 ? u.meta : null;
  const objetivo = fija ?? (await metaAutomatica(db, usuarioId, hoy));
  return {
    objetivo, vendido, automatica: fija === null && objetivo !== null,
    porcentaje: objetivo ? Math.round((vendido / objetivo) * 1000) / 10 : null,
    faltante: objetivo ? r2(Math.max(0, objetivo - vendido)) : null,
  };
}

// ───────────────────────── Cuota del mes ─────────────────────────

const ROLES_VENDEDOR = ["CAJERO", "VENDEDOR", "QF"] as const;
const dos = (n: number) => String(n).padStart(2, "0");
const reMes = /^\d{4}-(0[1-9]|1[0-2])$/;

export type AvanceMes = {
  mes: string; meta: number | null; vendido: number; porcentaje: number | null; faltante: number | null;
  diasMes: number; diasTranscurridos: number; diasRestantes: number; porDia: number | null; proyeccion: number | null;
};

function rangoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const siguiente = m === 12 ? `${a + 1}-01` : `${a}-${dos(m + 1)}`;
  return { inicio: inicioDiaLima(`${mes}-01`), fin: inicioDiaLima(`${siguiente}-01`), diasMes: new Date(Date.UTC(a, m, 0)).getUTCDate() };
}

/** Avance de una cuota: lo vendido, cuánto falta, cuánto hay que vender por día para llegar y la proyección al ritmo actual. */
function avance(mes: string, meta: number | null, vendido: number): AvanceMes {
  const { diasMes } = rangoMes(mes);
  const hoy = hoyLima(); const mesHoy = hoy.slice(0, 7);
  const diasTranscurridos = mes < mesHoy ? diasMes : mes > mesHoy ? 0 : Number(hoy.slice(8, 10));
  const diasRestantes = mes < mesHoy ? 0 : mes > mesHoy ? diasMes : diasMes - diasTranscurridos + 1; // incluye hoy
  const faltante = meta ? r2(Math.max(0, meta - vendido)) : null;
  return {
    mes, meta, vendido: r2(vendido), diasMes, diasTranscurridos, diasRestantes,
    porcentaje: meta ? Math.round((vendido / meta) * 1000) / 10 : null, faltante,
    porDia: faltante !== null && diasRestantes > 0 ? r2(faltante / diasRestantes) : null,
    proyeccion: mes === mesHoy && diasTranscurridos > 0 ? r2((vendido / diasTranscurridos) * diasMes) : null,
  };
}

/** Lo vendido en el mes: la botica cuenta todas las ventas emitidas; cada vendedor, sus ventas de mostrador (igual que la meta del día). */
async function vendidoDelMes(db: Db, mes: string) {
  const { inicio, fin } = rangoMes(mes);
  const rows = await filas<{ usuario_id: number; mostrador: string | null; total: string | null }>(db, sql`
    select usuario_id, sum(total) filter (where canal = 'MOSTRADOR') as mostrador, sum(total) as total
    from venta where estado = 'EMITIDA' and fecha >= ${inicio.toISOString()} and fecha < ${fin.toISOString()} group by usuario_id`);
  return {
    botica: r2(rows.reduce((a, r) => a + Number(r.total ?? 0), 0)),
    porUsuario: new Map(rows.map((r) => [Number(r.usuario_id), Number(r.mostrador ?? 0)])),
  };
}

async function metasGuardadas(db: Db, mes: string) {
  const rows = await db.select().from(schema.metaMensual).where(eq(schema.metaMensual.mes, mes));
  return { botica: rows.find((r) => r.usuarioId === null)?.monto ?? null, porUsuario: new Map(rows.filter((r) => r.usuarioId !== null).map((r) => [r.usuarioId!, r.monto])) };
}

async function vendedores(db: Db) {
  const us = await db.select({ id: schema.usuario.id, nombre: schema.usuario.nombre, roles: schema.usuario.roles, metaDiaria: schema.usuario.metaDiaria })
    .from(schema.usuario).where(eq(schema.usuario.activo, true)).orderBy(schema.usuario.nombre);
  return us.filter((u) => u.roles.some((r) => (ROLES_VENDEDOR as readonly string[]).includes(r)));
}

/** Pantalla de Metas: cuota general y por vendedor del mes, con su avance. */
export async function metasDelMes(db: Db, mes: string) {
  if (!reMes.test(mes)) throw new ErrorNegocio("MES", "Elige un mes válido.");
  const [metas, vendido, lista] = await Promise.all([metasGuardadas(db, mes), vendidoDelMes(db, mes), vendedores(db)]);
  const sumaVendedores = r2([...metas.porUsuario.values()].reduce((a, m) => a + m, 0));
  return {
    mes, sumaVendedores,
    botica: avance(mes, metas.botica, vendido.botica),
    vendedores: lista.map((u) => ({ usuarioId: u.id, nombre: u.nombre, roles: u.roles, metaDiaria: u.metaDiaria, ...avance(mes, metas.porUsuario.get(u.id) ?? null, vendido.porUsuario.get(u.id) ?? 0) })),
  };
}

const montoMeta = z.number().positive("debe ser mayor a 0").max(10000000).nullable();
export const esquemaMetasMes = z.object({
  mes: z.string().regex(reMes, "Elige un mes válido."),
  botica: montoMeta,
  vendedores: z.array(z.object({ usuarioId: z.number().int(), metaMes: montoMeta, metaDiaria: montoMeta.optional() })).max(200),
});

/** Guarda las cuotas del mes (vacío = sin cuota) y, de paso, la meta diaria de cada vendedor. */
export async function guardarMetasMes(db: Db, user: Sesion, input: z.infer<typeof esquemaMetasMes>) {
  const validos = new Set((await vendedores(db)).map((u) => u.id));
  const ajenos = input.vendedores.filter((v) => !validos.has(v.usuarioId));
  if (ajenos.length) throw new ErrorNegocio("NO_VENDEDOR", "Solo se asignan metas a usuarios activos que venden (cajero, vendedor o QF).");
  await db.transaction(async (tx) => {
    await tx.delete(schema.metaMensual).where(eq(schema.metaMensual.mes, input.mes));
    const filasMeta = [
      ...(input.botica ? [{ mes: input.mes, usuarioId: null, monto: r2(input.botica), actualizadoPor: user.id }] : []),
      ...input.vendedores.filter((v) => v.metaMes).map((v) => ({ mes: input.mes, usuarioId: v.usuarioId, monto: r2(v.metaMes!), actualizadoPor: user.id })),
    ];
    if (filasMeta.length) await tx.insert(schema.metaMensual).values(filasMeta);
    for (const v of input.vendedores) {
      if (v.metaDiaria !== undefined) await tx.update(schema.usuario).set({ metaDiaria: v.metaDiaria === null ? null : r2(v.metaDiaria) }).where(eq(schema.usuario.id, v.usuarioId));
    }
    await tx.insert(schema.auditoria).values({ usuarioId: user.id, accion: "METAS_MES", entidad: "meta_mensual", entidadId: null, detalle: { mes: input.mes, botica: input.botica, vendedores: input.vendedores } });
  });
  return metasDelMes(db, input.mes);
}

/** Avance del mes en curso para el panel: el vendedor ve su cuota; el administrador, la de la botica. */
export async function avanceDelMes(db: Db, usuarioId: number | null): Promise<AvanceMes | null> {
  const mes = hoyLima().slice(0, 7);
  const [metas, vendido] = await Promise.all([metasGuardadas(db, mes), vendidoDelMes(db, mes)]);
  const meta = usuarioId === null ? metas.botica : metas.porUsuario.get(usuarioId) ?? null;
  if (!meta) return null;
  return avance(mes, meta, usuarioId === null ? vendido.botica : vendido.porUsuario.get(usuarioId) ?? 0);
}

/** Reporte de cumplimiento de cuota mes a mes de un año, para la botica o un vendedor. */
export async function cumplimientoCuotas(db: Db, user: Sesion, q: { anio: number; usuarioId: number | null }) {
  const gestiona = tieneRol(user.roles, "ADMIN", "CONTADOR");
  if (!gestiona && q.usuarioId !== null && q.usuarioId !== user.id) throw new ErrorNegocio("SIN_PERMISO", "Solo puedes ver tu propia cuota.", 403);
  const lista = await vendedores(db);
  const opciones = [{ usuarioId: null as number | null, nombre: "Botica (cuota general)" }, ...lista.filter((u) => gestiona || u.id === user.id).map((u) => ({ usuarioId: u.id as number | null, nombre: u.nombre }))];
  const mesHoy = hoyLima().slice(0, 7);
  const meses = await Promise.all(Array.from({ length: 12 }, (_, i) => `${q.anio}-${dos(i + 1)}`).map(async (mes) => {
    const [metas, vendido] = await Promise.all([metasGuardadas(db, mes), vendidoDelMes(db, mes)]);
    const meta = q.usuarioId === null ? metas.botica : metas.porUsuario.get(q.usuarioId) ?? null;
    const a = avance(mes, meta, q.usuarioId === null ? vendido.botica : vendido.porUsuario.get(q.usuarioId) ?? 0);
    const estado = mes > mesHoy ? "PENDIENTE" : !meta ? "SIN_CUOTA" : (a.porcentaje ?? 0) >= 100 ? "CUMPLIDA" : mes === mesHoy ? "EN_CURSO" : "NO_CUMPLIDA";
    return { ...a, diferencia: meta ? r2(a.vendido - meta) : null, estado };
  }));
  const conCuota = meses.filter((m) => m.meta && m.mes <= mesHoy);
  const metaAnual = r2(conCuota.reduce((s, m) => s + (m.meta ?? 0), 0));
  const vendidoAnual = r2(conCuota.reduce((s, m) => s + m.vendido, 0));
  return {
    anio: q.anio, usuarioId: q.usuarioId, opciones, meses,
    resumen: {
      mesesConCuota: conCuota.length, cumplidos: conCuota.filter((m) => m.estado === "CUMPLIDA").length,
      meta: metaAnual, vendido: vendidoAnual, porcentaje: metaAnual ? Math.round((vendidoAnual / metaAnual) * 1000) / 10 : null,
    },
  };
}
