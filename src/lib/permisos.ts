export const ROLES = ["ADMIN", "QF", "CAJERO", "VENDEDOR", "INVENTARIADOR", "CONTADOR"] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_NOMBRE: Record<Rol, string> = {
  ADMIN: "Propietario / Administrador",
  QF: "Químico Farmacéutico",
  CAJERO: "Cajero",
  VENDEDOR: "Vendedor",
  INVENTARIADOR: "Inventariador",
  CONTADOR: "Contador",
};

const TODOS: Rol[] = [...ROLES];

export const PERMISOS = {
  panel: TODOS,
  caja: ["ADMIN", "CAJERO", "VENDEDOR", "QF"],
  ventas: ["ADMIN", "CAJERO", "VENDEDOR", "QF"],
  "ventas.ver": ["ADMIN", "CAJERO", "VENDEDOR", "QF", "CONTADOR"],
  "ventas.anular": ["ADMIN"],
  "productos.ver": TODOS,
  "compras.recibir": ["ADMIN", "INVENTARIADOR"],
  "compras.costear": ["ADMIN"],
  "salidas.registrar": ["ADMIN", "INVENTARIADOR", "QF"],
  "salidas.aprobar": ["ADMIN", "QF"],
  kardex: ["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"],
  campanas: ["ADMIN"],
  complementos: ["ADMIN", "QF"],
  "comisiones.propias": ["ADMIN", "QF", "CAJERO", "VENDEDOR"],
  "comisiones.admin": ["ADMIN"],
  "comisiones.reporte": ["ADMIN", "CONTADOR"],
  alertas: ["ADMIN", "QF", "INVENTARIADOR"],
  reportes: ["ADMIN", "QF", "CONTADOR", "INVENTARIADOR"],
  "metricas.crear": ["ADMIN"],
} satisfies Record<string, Rol[]>;

export type Permiso = keyof typeof PERMISOS;

export function puede(rol: Rol, permiso: Permiso): boolean {
  return (PERMISOS[permiso] as Rol[]).includes(rol);
}

/** Solo el Propietario / Administrador ve costos, márgenes y valor del inventario (RN-13). */
export function verCostos(rol: Rol): boolean {
  return rol === "ADMIN";
}

const SENSIBLES = new Set([
  "costoPromedio", "costoUnitario", "costoTotal", "costoPresentacion", "totalCosto", "saldoValorizado",
  "porcentajeUtilidad", "margen", "margenPct", "costoVentas", "pvpSugerido", "valorInventario", "costoAnterior",
]);

/** Elimina en el servidor todo campo de costo para quien no tiene el permiso «Ver costos». */
export function enmascarar<T>(data: T, rol: Rol): T {
  if (verCostos(rol)) return data;
  const limpiar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(limpiar);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) if (!SENSIBLES.has(k)) out[k] = limpiar(val);
      return out;
    }
    return v;
  };
  return limpiar(data) as T;
}
