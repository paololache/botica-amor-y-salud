import {
  pgTable, pgEnum, serial, integer, text, boolean, numeric, timestamp, date, jsonb, uniqueIndex, index,
} from "drizzle-orm/pg-core";

const money = (n: string) => numeric(n, { precision: 12, scale: 2, mode: "number" });
const cost = (n: string) => numeric(n, { precision: 14, scale: 4, mode: "number" });
const ts = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });

export const rolEnum = pgEnum("rol", ["ADMIN", "QF", "CAJERO", "VENDEDOR", "INVENTARIADOR", "CONTADOR"]);
export const condicionEnum = pgEnum("condicion_venta", ["LIBRE", "RECETA", "RECETA_RETENIDA"]);
export const medioEnum = pgEnum("medio_pago", ["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"]);
export const comprobanteEnum = pgEnum("tipo_comprobante", ["BOLETA", "FACTURA", "NOTA_VENTA"]);

export const usuario = pgTable("usuario", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  rol: rolEnum("rol").notNull(),
  activo: boolean("activo").notNull().default(true),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

export const categoria = pgTable("categoria", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
});

export const producto = pgTable("producto", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  principioActivo: text("principio_activo"),
  concentracion: text("concentracion"),
  formaFarmaceutica: text("forma_farmaceutica"),
  registroSanitario: text("registro_sanitario"),
  registroVence: date("registro_vence", { mode: "string" }),
  laboratorio: text("laboratorio"),
  categoriaId: integer("categoria_id").references(() => categoria.id),
  condicionVenta: condicionEnum("condicion_venta").notNull().default("LIBRE"),
  stockMinimo: integer("stock_minimo").notNull().default(0),
  costoPromedio: cost("costo_promedio").notNull().default(0),
  porcentajeUtilidad: numeric("porcentaje_utilidad", { precision: 6, scale: 2, mode: "number" }).notNull().default(30),
  ubicacion: text("ubicacion"),
  activo: boolean("activo").notNull().default(true),
}, (t) => [index("producto_nombre_idx").on(t.nombre)]);

export const presentacion = pgTable("presentacion", {
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  nombre: text("nombre").notNull(),
  factor: integer("factor").notNull(),
  pvp: money("pvp").notNull(),
  codigo: text("codigo").unique(),
  activo: boolean("activo").notNull().default(true),
}, (t) => [index("presentacion_producto_idx").on(t.productoId)]);

export const lote = pgTable("lote", {
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  numero: text("numero").notNull(),
  vencimiento: date("vencimiento", { mode: "string" }).notNull(),
  costoUnitario: cost("costo_unitario").notNull().default(0),
  cantidad: integer("cantidad").notNull().default(0),
  estado: text("estado").notNull().default("ACTIVO"), // ACTIVO | VENCIDO | BLOQUEADO
}, (t) => [uniqueIndex("lote_producto_numero_uq").on(t.productoId, t.numero), index("lote_venc_idx").on(t.vencimiento)]);

export const caja = pgTable("caja", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
});

export const sesionCaja = pgTable("sesion_caja", {
  id: serial("id").primaryKey(),
  cajaId: integer("caja_id").notNull().references(() => caja.id),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  turno: text("turno").notNull(),
  abiertaEn: ts("abierta_en").notNull().defaultNow(),
  cerradaEn: ts("cerrada_en"),
  fondoInicial: money("fondo_inicial").notNull(),
  conteoApertura: jsonb("conteo_apertura").$type<Record<string, number>>(),
  observacionApertura: text("observacion_apertura"),
  conteoCierre: jsonb("conteo_cierre").$type<Record<string, number>>(),
  contado: jsonb("contado").$type<Record<string, number>>(),
  esperado: jsonb("esperado").$type<Record<string, number>>(),
  diferencia: money("diferencia"),
  fondoSiguiente: money("fondo_siguiente"),
  retiro: money("retiro"),
  observacion: text("observacion"),
  validadoPor: integer("validado_por").references(() => usuario.id),
  estado: text("estado").notNull().default("ABIERTA"), // ABIERTA | CERRADA
}, (t) => [index("sesion_estado_idx").on(t.estado)]);

export const movimientoCaja = pgTable("movimiento_caja", {
  id: serial("id").primaryKey(),
  sesionId: integer("sesion_id").notNull().references(() => sesionCaja.id),
  tipo: text("tipo").notNull(), // INGRESO | EGRESO
  concepto: text("concepto").notNull(),
  medio: medioEnum("medio").notNull().default("EFECTIVO"),
  monto: money("monto").notNull(),
  comprobante: text("comprobante"),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  fecha: ts("fecha").notNull().defaultNow(),
});

export const cliente = pgTable("cliente", {
  id: serial("id").primaryKey(),
  tipoDoc: text("tipo_doc").notNull(), // DNI | RUC
  numero: text("numero").notNull().unique(),
  nombre: text("nombre").notNull(),
});

export const correlativo = pgTable("correlativo", {
  serie: text("serie").primaryKey(),
  ultimo: integer("ultimo").notNull().default(0),
});

export const venta = pgTable("venta", {
  id: serial("id").primaryKey(),
  sesionId: integer("sesion_id").notNull().references(() => sesionCaja.id),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  clienteId: integer("cliente_id").references(() => cliente.id),
  tipoComprobante: comprobanteEnum("tipo_comprobante").notNull(),
  serie: text("serie").notNull(),
  numero: integer("numero").notNull(),
  fecha: ts("fecha").notNull().defaultNow(),
  subtotal: money("subtotal").notNull(),
  igv: money("igv").notNull(),
  descuento: money("descuento").notNull().default(0),
  total: money("total").notNull(),
  costoTotal: money("costo_total").notNull().default(0),
  receta: jsonb("receta").$type<{ medico: string; cmp: string; numero: string } | null>(),
  estado: text("estado").notNull().default("EMITIDA"), // EMITIDA | ANULADA
  cpeEstado: text("cpe_estado").notNull().default("PENDIENTE"), // PENDIENTE | ACEPTADO | RECHAZADO | NO_APLICA
  anuladaPor: integer("anulada_por").references(() => usuario.id),
  anuladaEn: ts("anulada_en"),
}, (t) => [uniqueIndex("venta_serie_numero_uq").on(t.serie, t.numero), index("venta_fecha_idx").on(t.fecha), index("venta_sesion_idx").on(t.sesionId)]);

export const ventaDetalle = pgTable("venta_detalle", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id").notNull().references(() => venta.id),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  presentacionId: integer("presentacion_id").notNull().references(() => presentacion.id),
  loteId: integer("lote_id").notNull().references(() => lote.id),
  cantidad: numeric("cantidad", { precision: 12, scale: 3, mode: "number" }).notNull(),
  unidades: integer("unidades").notNull(),
  precioUnitario: money("precio_unitario").notNull(),
  descuento: money("descuento").notNull().default(0),
  subtotal: money("subtotal").notNull(),
  costoUnitario: cost("costo_unitario").notNull(),
  origen: text("origen").notNull().default("DIRECTA"), // DIRECTA | SUGERENCIA
}, (t) => [index("vd_venta_idx").on(t.ventaId), index("vd_producto_idx").on(t.productoId)]);

export const ventaPago = pgTable("venta_pago", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id").notNull().references(() => venta.id),
  medio: medioEnum("medio").notNull(),
  monto: money("monto").notNull(),
}, (t) => [index("vp_venta_idx").on(t.ventaId)]);

export const proveedor = pgTable("proveedor", {
  id: serial("id").primaryKey(),
  ruc: text("ruc").notNull().unique(),
  razonSocial: text("razon_social").notNull(),
});

export const compra = pgTable("compra", {
  id: serial("id").primaryKey(),
  proveedorId: integer("proveedor_id").notNull().references(() => proveedor.id),
  tipoComprobante: text("tipo_comprobante").notNull(),
  serie: text("serie").notNull(),
  numero: text("numero").notNull(),
  fechaEmision: date("fecha_emision", { mode: "string" }).notNull(),
  estado: text("estado").notNull().default("PENDIENTE_COSTO"), // PENDIENTE_COSTO | CONFIRMADA | ANULADA
  registradoPor: integer("registrado_por").notNull().references(() => usuario.id),
  costeadoPor: integer("costeado_por").references(() => usuario.id),
  registradoEn: ts("registrado_en").notNull().defaultNow(),
  costeadoEn: ts("costeado_en"),
  total: money("total"),
}, (t) => [uniqueIndex("compra_doc_uq").on(t.proveedorId, t.tipoComprobante, t.serie, t.numero)]);

export const compraDetalle = pgTable("compra_detalle", {
  id: serial("id").primaryKey(),
  compraId: integer("compra_id").notNull().references(() => compra.id),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  presentacionId: integer("presentacion_id").notNull().references(() => presentacion.id),
  cantidad: integer("cantidad").notNull(),
  unidades: integer("unidades").notNull(),
  numeroLote: text("numero_lote").notNull(),
  vencimiento: date("vencimiento", { mode: "string" }).notNull(),
  costoPresentacion: cost("costo_presentacion"),
  loteId: integer("lote_id").references(() => lote.id),
});

export const motivo = pgTable("motivo", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  tipo: text("tipo").notNull(), // SALIDA | ENTRADA
  requiereAprobacion: boolean("requiere_aprobacion").notNull().default(true),
  rolAprobador: rolEnum("rol_aprobador").notNull().default("ADMIN"),
  requiereEvidencia: boolean("requiere_evidencia").notNull().default(false),
  activo: boolean("activo").notNull().default(true),
});

export const movimientoInventario = pgTable("movimiento_inventario", {
  id: serial("id").primaryKey(),
  motivoId: integer("motivo_id").notNull().references(() => motivo.id),
  descripcion: text("descripcion").notNull(),
  evidencia: text("evidencia"),
  estado: text("estado").notNull(), // PENDIENTE | APROBADA | RECHAZADA
  totalCosto: cost("total_costo").notNull().default(0),
  registradoPor: integer("registrado_por").notNull().references(() => usuario.id),
  aprobadoPor: integer("aprobado_por").references(() => usuario.id),
  comentario: text("comentario"),
  fecha: ts("fecha").notNull().defaultNow(),
  decididoEn: ts("decidido_en"),
});

export const movDetalle = pgTable("mov_detalle", {
  id: serial("id").primaryKey(),
  movimientoId: integer("movimiento_id").notNull().references(() => movimientoInventario.id),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  loteId: integer("lote_id").notNull().references(() => lote.id),
  unidades: integer("unidades").notNull(),
  costoUnitario: cost("costo_unitario").notNull(),
});

export const kardex = pgTable("kardex", {
  id: serial("id").primaryKey(),
  fecha: ts("fecha").notNull().defaultNow(),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  loteId: integer("lote_id").references(() => lote.id),
  tipo: text("tipo").notNull(), // VENTA | ANULACION_VENTA | COMPRA | SALIDA | ENTRADA | INVENTARIO_INICIAL
  motivo: text("motivo"),
  documentoTipo: text("documento_tipo").notNull(),
  documentoId: integer("documento_id"),
  documentoRef: text("documento_ref"),
  entrada: integer("entrada").notNull().default(0),
  salida: integer("salida").notNull().default(0),
  costoUnitario: cost("costo_unitario").notNull(),
  saldoUnidades: integer("saldo_unidades").notNull(),
  costoPromedio: cost("costo_promedio").notNull(),
  saldoValorizado: money("saldo_valorizado").notNull(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
}, (t) => [index("kardex_producto_fecha_idx").on(t.productoId, t.fecha)]);

export const campana = pgTable("campana", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  loteId: integer("lote_id").references(() => lote.id),
  porcentaje: numeric("porcentaje", { precision: 5, scale: 2, mode: "number" }).notNull(),
  inicio: date("inicio", { mode: "string" }).notNull(),
  fin: date("fin", { mode: "string" }).notNull(),
  estado: text("estado").notNull(), // PROGRAMADA | ACTIVA | PAUSADA | FINALIZADA
  observacion: text("observacion"),
  creadoPor: integer("creado_por").notNull().references(() => usuario.id),
  creadoEn: ts("creado_en").notNull().defaultNow(),
  actualizadoPor: integer("actualizado_por").references(() => usuario.id),
  actualizadoEn: ts("actualizado_en"),
}, (t) => [index("campana_producto_idx").on(t.productoId)]);

export const complemento = pgTable("complemento", {
  id: serial("id").primaryKey(),
  origenTipo: text("origen_tipo").notNull(), // PRODUCTO | PRINCIPIO_ACTIVO | CATEGORIA
  origenValor: text("origen_valor").notNull(),
  productoId: integer("producto_id").notNull().references(() => producto.id),
  mensaje: text("mensaje"),
  prioridad: integer("prioridad").notNull().default(1),
});

export const comision = pgTable("comision", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id").notNull().references(() => venta.id),
  ventaDetalleId: integer("venta_detalle_id").references(() => ventaDetalle.id),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  campanaId: integer("campana_id").references(() => campana.id),
  porcentaje: numeric("porcentaje", { precision: 5, scale: 2, mode: "number" }).notNull(),
  base: money("base").notNull(),
  monto: money("monto").notNull(),
  origen: text("origen").notNull(), // DIRECTA | SUGERENCIA | AJUSTE
  estado: text("estado").notNull().default("DEVENGADA"), // DEVENGADA | REVERTIDA | CONSOLIDADA | LIQUIDADA | PAGADA
  fecha: date("fecha", { mode: "string" }).notNull(),
  comisionDiariaId: integer("comision_diaria_id"),
}, (t) => [index("comision_usuario_fecha_idx").on(t.usuarioId, t.fecha), index("comision_venta_idx").on(t.ventaId)]);

export const comisionDiaria = pgTable("comision_diaria", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  fecha: date("fecha", { mode: "string" }).notNull(),
  lineas: integer("lineas").notNull(),
  total: money("total").notNull(),
  liquidacionId: integer("liquidacion_id"),
}, (t) => [uniqueIndex("comision_diaria_uq").on(t.usuarioId, t.fecha)]);

export const liquidacionMensual = pgTable("liquidacion_mensual", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => usuario.id),
  mes: text("mes").notNull(), // YYYY-MM
  total: money("total").notNull(),
  aprobadoPor: integer("aprobado_por").notNull().references(() => usuario.id),
  aprobadoEn: ts("aprobado_en").notNull().defaultNow(),
  pagadoEn: ts("pagado_en"),
  estado: text("estado").notNull().default("APROBADA"), // APROBADA | PAGADA
}, (t) => [uniqueIndex("liquidacion_uq").on(t.usuarioId, t.mes)]);

export const alerta = pgTable("alerta", {
  id: serial("id").primaryKey(),
  clave: text("clave").notNull(),
  tipo: text("tipo").notNull(),
  severidad: text("severidad").notNull(), // CRITICA | ALTA | INFO
  titulo: text("titulo").notNull(),
  detalle: text("detalle").notNull(),
  referenciaTipo: text("referencia_tipo"),
  referenciaId: integer("referencia_id"),
  valor: numeric("valor", { precision: 14, scale: 2, mode: "number" }),
  estado: text("estado").notNull().default("ABIERTA"), // ABIERTA | ATENDIDA | CERRADA
  creadaEn: ts("creada_en").notNull().defaultNow(),
  actualizadaEn: ts("actualizada_en").notNull().defaultNow(),
  atendidaPor: integer("atendida_por").references(() => usuario.id),
  atendidaEn: ts("atendida_en"),
  accion: text("accion"),
  pospuestaHasta: ts("pospuesta_hasta"),
}, (t) => [index("alerta_estado_idx").on(t.estado), index("alerta_clave_idx").on(t.clave)]);

export const parametro = pgTable("parametro", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
  descripcion: text("descripcion"),
});

export const metrica = pgTable("metrica", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  formula: text("formula").notNull(),
  unidad: text("unidad").notNull(), // SOLES | UNIDADES | PORCENTAJE | NUMERO
  roles: text("roles").array().notNull(),
  enPanel: boolean("en_panel").notNull().default(false),
  creadoPor: integer("creado_por").references(() => usuario.id),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

export const reporteGuardado = pgTable("reporte_guardado", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  config: jsonb("config").$type<{ agrupar: string; metricas: string[]; desde?: string; hasta?: string; filtros?: Record<string, string> }>().notNull(),
  propietarioId: integer("propietario_id").notNull().references(() => usuario.id),
  rolesCompartidos: text("roles_compartidos").array().notNull().default([]),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

export const auditoria = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuario.id),
  accion: text("accion").notNull(),
  entidad: text("entidad").notNull(),
  entidadId: integer("entidad_id"),
  detalle: jsonb("detalle"),
  fecha: ts("fecha").notNull().defaultNow(),
});
