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

/** Módulos del portal por perfil. `oculto`: pantalla interna que no va en el menú pero tiene su propio acceso. */
export const MODULOS: { href: string; texto: string; roles: Rol[]; oculto?: boolean }[] = [
  { href: "/", texto: "Panel", roles: TODOS },
  { href: "/vender", texto: "Vender", roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR"] },
  { href: "/caja", texto: "Caja", roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR"] },
  { href: "/caja/eliminaciones", texto: "Eliminaciones de caja", roles: ["ADMIN", "CONTADOR"], oculto: true },
  { href: "/caja/reporte", texto: "Reporte de cierre", roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "CONTADOR"], oculto: true },
  { href: "/ventas", texto: "Ventas", roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "CONTADOR"] },
  { href: "/productos", texto: "Productos", roles: TODOS },
  { href: "/compras", texto: "Compras", roles: ["ADMIN", "INVENTARIADOR"] },
  { href: "/movimientos", texto: "Salidas y entradas", roles: ["ADMIN", "QF", "INVENTARIADOR"] },
  { href: "/transferencias", texto: "Transferencias", roles: ["ADMIN", "QF", "CAJERO", "INVENTARIADOR"] },
  { href: "/laboratorios", texto: "Laboratorios", roles: ["ADMIN"] },
  { href: "/kardex", texto: "Kardex", roles: ["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"] },
  { href: "/campanas", texto: "Campañas", roles: ["ADMIN"] },
  { href: "/complementos", texto: "Complementos", roles: ["ADMIN", "QF"] },
  { href: "/comisiones", texto: "Comisiones", roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "CONTADOR"] },
  { href: "/reportes", texto: "Reportes", roles: ["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"] },
  { href: "/metas", texto: "Metas de venta", roles: ["ADMIN"] },
  { href: "/usuarios", texto: "Usuarios", roles: ["ADMIN"] },
];

/** El módulo de una ruta es el de prefijo más largo; las rutas sin módulo no se restringen aquí. */
export function moduloDeRuta(ruta: string) {
  return MODULOS.filter((m) => m.href === "/" ? ruta === "/" : ruta === m.href || ruta.startsWith(m.href + "/")).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export const PERMISOS = {
  panel: TODOS,
  caja: ["ADMIN", "CAJERO", "VENDEDOR", "QF"],
  "caja.auditoria": ["ADMIN", "CONTADOR"],
  ventas: ["ADMIN", "CAJERO", "VENDEDOR", "QF"],
  "ventas.ver": ["ADMIN", "CAJERO", "VENDEDOR", "QF", "CONTADOR"],
  "ventas.anular": ["ADMIN"],
  "productos.ver": TODOS,
  "productos.gestionar": ["ADMIN"],
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
  "usuarios.gestionar": ["ADMIN"],
  "metas.gestionar": ["ADMIN"],
  "transferencias.registrar": ["ADMIN", "QF", "CAJERO", "INVENTARIADOR"],
  "transferencias.aprobar": ["ADMIN"],
} satisfies Record<string, Rol[]>;

export type Permiso = keyof typeof PERMISOS;

/** Un usuario tiene la unión de sus perfiles: basta con que uno lo permita. */
export function tieneRol(roles: readonly Rol[], ...permitidos: Rol[]): boolean {
  return roles.some((r) => permitidos.includes(r));
}

export function puede(roles: readonly Rol[], permiso: Permiso): boolean {
  return tieneRol(roles, ...(PERMISOS[permiso] as Rol[]));
}

/** Solo el Propietario / Administrador ve costos, márgenes y valor del inventario (RN-13). */
export function verCostos(roles: readonly Rol[]): boolean {
  return roles.includes("ADMIN");
}

const SENSIBLES = new Set([
  "costoPromedio", "costoUnitario", "costoTotal", "costoPresentacion", "totalCosto", "saldoValorizado",
  "porcentajeUtilidad", "margen", "margenPct", "costoVentas", "pvpSugerido", "valorInventario", "costoAnterior",
]);

/** Elimina en el servidor todo campo de costo para quien no tiene el permiso «Ver costos». */
export function enmascarar<T>(data: T, roles: readonly Rol[]): T {
  if (verCostos(roles)) return data;
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
