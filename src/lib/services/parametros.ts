import { schema, type Db } from "@/db";

export const PARAMETROS_DEFECTO = {
  umbral_diferencia_caja: "5.00",
  umbral_aprobacion_salida: "50.00",
  cobertura_minima_dias: "7",
  dias_reposicion: "3",
  dias_stock_seguridad: "2",
  variacion_costo_pct: "10",
  aviso_campana_dias: "3",
  boleta_dni_desde: "700",
  descuento_max_pct: "5",
} as const;

export type ClaveParametro = keyof typeof PARAMETROS_DEFECTO;

export async function parametros(db: Db): Promise<Record<ClaveParametro, number>> {
  const rows = await db.select().from(schema.parametro);
  const out = Object.fromEntries(Object.entries(PARAMETROS_DEFECTO).map(([k, v]) => [k, Number(v)])) as Record<ClaveParametro, number>;
  for (const r of rows) if (r.clave in out) out[r.clave as ClaveParametro] = Number(r.valor);
  return out;
}
