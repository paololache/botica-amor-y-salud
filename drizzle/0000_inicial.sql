CREATE TYPE "public"."tipo_comprobante" AS ENUM('BOLETA', 'FACTURA', 'NOTA_VENTA');--> statement-breakpoint
CREATE TYPE "public"."condicion_venta" AS ENUM('LIBRE', 'RECETA', 'RECETA_RETENIDA');--> statement-breakpoint
CREATE TYPE "public"."medio_pago" AS ENUM('EFECTIVO', 'YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('ADMIN', 'QF', 'CAJERO', 'VENDEDOR', 'INVENTARIADOR', 'CONTADOR');--> statement-breakpoint
CREATE TABLE "alerta" (
	"id" serial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"tipo" text NOT NULL,
	"severidad" text NOT NULL,
	"titulo" text NOT NULL,
	"detalle" text NOT NULL,
	"referencia_tipo" text,
	"referencia_id" integer,
	"valor" numeric(14, 2),
	"estado" text DEFAULT 'ABIERTA' NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"atendida_por" integer,
	"atendida_en" timestamp with time zone,
	"accion" text,
	"pospuesta_hasta" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" integer,
	"detalle" jsonb,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caja" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "caja_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "campana" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"producto_id" integer NOT NULL,
	"lote_id" integer,
	"porcentaje" numeric(5, 2) NOT NULL,
	"inicio" date NOT NULL,
	"fin" date NOT NULL,
	"estado" text NOT NULL,
	"observacion" text,
	"creado_por" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" integer,
	"actualizado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "categoria_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo_doc" text NOT NULL,
	"numero" text NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "cliente_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
CREATE TABLE "comision" (
	"id" serial PRIMARY KEY NOT NULL,
	"venta_id" integer NOT NULL,
	"venta_detalle_id" integer,
	"usuario_id" integer NOT NULL,
	"campana_id" integer,
	"porcentaje" numeric(5, 2) NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"origen" text NOT NULL,
	"estado" text DEFAULT 'DEVENGADA' NOT NULL,
	"fecha" date NOT NULL,
	"comision_diaria_id" integer
);
--> statement-breakpoint
CREATE TABLE "comision_diaria" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"lineas" integer NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"liquidacion_id" integer
);
--> statement-breakpoint
CREATE TABLE "complemento" (
	"id" serial PRIMARY KEY NOT NULL,
	"origen_tipo" text NOT NULL,
	"origen_valor" text NOT NULL,
	"producto_id" integer NOT NULL,
	"mensaje" text,
	"prioridad" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compra" (
	"id" serial PRIMARY KEY NOT NULL,
	"proveedor_id" integer NOT NULL,
	"tipo_comprobante" text NOT NULL,
	"serie" text NOT NULL,
	"numero" text NOT NULL,
	"fecha_emision" date NOT NULL,
	"estado" text DEFAULT 'PENDIENTE_COSTO' NOT NULL,
	"registrado_por" integer NOT NULL,
	"costeado_por" integer,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"costeado_en" timestamp with time zone,
	"total" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "compra_detalle" (
	"id" serial PRIMARY KEY NOT NULL,
	"compra_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"presentacion_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"unidades" integer NOT NULL,
	"numero_lote" text NOT NULL,
	"vencimiento" date NOT NULL,
	"costo_presentacion" numeric(14, 4),
	"lote_id" integer
);
--> statement-breakpoint
CREATE TABLE "correlativo" (
	"serie" text PRIMARY KEY NOT NULL,
	"ultimo" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kardex" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"producto_id" integer NOT NULL,
	"lote_id" integer,
	"tipo" text NOT NULL,
	"motivo" text,
	"documento_tipo" text NOT NULL,
	"documento_id" integer,
	"documento_ref" text,
	"entrada" integer DEFAULT 0 NOT NULL,
	"salida" integer DEFAULT 0 NOT NULL,
	"costo_unitario" numeric(14, 4) NOT NULL,
	"saldo_unidades" integer NOT NULL,
	"costo_promedio" numeric(14, 4) NOT NULL,
	"saldo_valorizado" numeric(12, 2) NOT NULL,
	"usuario_id" integer
);
--> statement-breakpoint
CREATE TABLE "liquidacion_mensual" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"mes" text NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"aprobado_por" integer NOT NULL,
	"aprobado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"pagado_en" timestamp with time zone,
	"estado" text DEFAULT 'APROBADA' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lote" (
	"id" serial PRIMARY KEY NOT NULL,
	"producto_id" integer NOT NULL,
	"numero" text NOT NULL,
	"vencimiento" date NOT NULL,
	"costo_unitario" numeric(14, 4) DEFAULT 0 NOT NULL,
	"cantidad" integer DEFAULT 0 NOT NULL,
	"estado" text DEFAULT 'ACTIVO' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrica" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"formula" text NOT NULL,
	"unidad" text NOT NULL,
	"roles" text[] NOT NULL,
	"en_panel" boolean DEFAULT false NOT NULL,
	"creado_por" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrica_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "motivo" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"requiere_aprobacion" boolean DEFAULT true NOT NULL,
	"rol_aprobador" "rol" DEFAULT 'ADMIN' NOT NULL,
	"requiere_evidencia" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "motivo_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "mov_detalle" (
	"id" serial PRIMARY KEY NOT NULL,
	"movimiento_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"lote_id" integer NOT NULL,
	"unidades" integer NOT NULL,
	"costo_unitario" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimiento_caja" (
	"id" serial PRIMARY KEY NOT NULL,
	"sesion_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"concepto" text NOT NULL,
	"medio" "medio_pago" DEFAULT 'EFECTIVO' NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"comprobante" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimiento_inventario" (
	"id" serial PRIMARY KEY NOT NULL,
	"motivo_id" integer NOT NULL,
	"descripcion" text NOT NULL,
	"evidencia" text,
	"estado" text NOT NULL,
	"total_costo" numeric(14, 4) DEFAULT 0 NOT NULL,
	"registrado_por" integer NOT NULL,
	"aprobado_por" integer,
	"comentario" text,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parametro" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"descripcion" text
);
--> statement-breakpoint
CREATE TABLE "presentacion" (
	"id" serial PRIMARY KEY NOT NULL,
	"producto_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"factor" integer NOT NULL,
	"pvp" numeric(12, 2) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "producto" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"principio_activo" text,
	"concentracion" text,
	"laboratorio" text,
	"categoria_id" integer,
	"condicion_venta" "condicion_venta" DEFAULT 'LIBRE' NOT NULL,
	"stock_minimo" integer DEFAULT 0 NOT NULL,
	"costo_promedio" numeric(14, 4) DEFAULT 0 NOT NULL,
	"porcentaje_utilidad" numeric(6, 2) DEFAULT 30 NOT NULL,
	"ubicacion" text,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "producto_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "proveedor" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruc" text NOT NULL,
	"razon_social" text NOT NULL,
	CONSTRAINT "proveedor_ruc_unique" UNIQUE("ruc")
);
--> statement-breakpoint
CREATE TABLE "reporte_guardado" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"config" jsonb NOT NULL,
	"propietario_id" integer NOT NULL,
	"roles_compartidos" text[] DEFAULT '{}' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesion_caja" (
	"id" serial PRIMARY KEY NOT NULL,
	"caja_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"turno" text NOT NULL,
	"abierta_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrada_en" timestamp with time zone,
	"fondo_inicial" numeric(12, 2) NOT NULL,
	"conteo_apertura" jsonb,
	"observacion_apertura" text,
	"conteo_cierre" jsonb,
	"contado" jsonb,
	"esperado" jsonb,
	"diferencia" numeric(12, 2),
	"fondo_siguiente" numeric(12, 2),
	"retiro" numeric(12, 2),
	"observacion" text,
	"validado_por" integer,
	"estado" text DEFAULT 'ABIERTA' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"rol" "rol" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "venta" (
	"id" serial PRIMARY KEY NOT NULL,
	"sesion_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"cliente_id" integer,
	"tipo_comprobante" "tipo_comprobante" NOT NULL,
	"serie" text NOT NULL,
	"numero" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"igv" numeric(12, 2) NOT NULL,
	"descuento" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"costo_total" numeric(12, 2) DEFAULT 0 NOT NULL,
	"receta" jsonb,
	"estado" text DEFAULT 'EMITIDA' NOT NULL,
	"cpe_estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"anulada_por" integer,
	"anulada_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "venta_detalle" (
	"id" serial PRIMARY KEY NOT NULL,
	"venta_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"presentacion_id" integer NOT NULL,
	"lote_id" integer NOT NULL,
	"cantidad" numeric(12, 3) NOT NULL,
	"unidades" integer NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"descuento" numeric(12, 2) DEFAULT 0 NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"costo_unitario" numeric(14, 4) NOT NULL,
	"origen" text DEFAULT 'DIRECTA' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venta_pago" (
	"id" serial PRIMARY KEY NOT NULL,
	"venta_id" integer NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"monto" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_atendida_por_usuario_id_fk" FOREIGN KEY ("atendida_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campana" ADD CONSTRAINT "campana_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campana" ADD CONSTRAINT "campana_lote_id_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campana" ADD CONSTRAINT "campana_creado_por_usuario_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campana" ADD CONSTRAINT "campana_actualizado_por_usuario_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision" ADD CONSTRAINT "comision_venta_id_venta_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision" ADD CONSTRAINT "comision_venta_detalle_id_venta_detalle_id_fk" FOREIGN KEY ("venta_detalle_id") REFERENCES "public"."venta_detalle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision" ADD CONSTRAINT "comision_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision" ADD CONSTRAINT "comision_campana_id_campana_id_fk" FOREIGN KEY ("campana_id") REFERENCES "public"."campana"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision_diaria" ADD CONSTRAINT "comision_diaria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complemento" ADD CONSTRAINT "complemento_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra" ADD CONSTRAINT "compra_proveedor_id_proveedor_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra" ADD CONSTRAINT "compra_registrado_por_usuario_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra" ADD CONSTRAINT "compra_costeado_por_usuario_id_fk" FOREIGN KEY ("costeado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_detalle" ADD CONSTRAINT "compra_detalle_compra_id_compra_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_detalle" ADD CONSTRAINT "compra_detalle_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_detalle" ADD CONSTRAINT "compra_detalle_presentacion_id_presentacion_id_fk" FOREIGN KEY ("presentacion_id") REFERENCES "public"."presentacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_detalle" ADD CONSTRAINT "compra_detalle_lote_id_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kardex" ADD CONSTRAINT "kardex_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kardex" ADD CONSTRAINT "kardex_lote_id_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kardex" ADD CONSTRAINT "kardex_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidacion_mensual" ADD CONSTRAINT "liquidacion_mensual_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidacion_mensual" ADD CONSTRAINT "liquidacion_mensual_aprobado_por_usuario_id_fk" FOREIGN KEY ("aprobado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote" ADD CONSTRAINT "lote_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrica" ADD CONSTRAINT "metrica_creado_por_usuario_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mov_detalle" ADD CONSTRAINT "mov_detalle_movimiento_id_movimiento_inventario_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimiento_inventario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mov_detalle" ADD CONSTRAINT "mov_detalle_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mov_detalle" ADD CONSTRAINT "mov_detalle_lote_id_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_caja" ADD CONSTRAINT "movimiento_caja_sesion_id_sesion_caja_id_fk" FOREIGN KEY ("sesion_id") REFERENCES "public"."sesion_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_caja" ADD CONSTRAINT "movimiento_caja_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_motivo_id_motivo_id_fk" FOREIGN KEY ("motivo_id") REFERENCES "public"."motivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_registrado_por_usuario_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_aprobado_por_usuario_id_fk" FOREIGN KEY ("aprobado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentacion" ADD CONSTRAINT "presentacion_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto" ADD CONSTRAINT "producto_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporte_guardado" ADD CONSTRAINT "reporte_guardado_propietario_id_usuario_id_fk" FOREIGN KEY ("propietario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion_caja" ADD CONSTRAINT "sesion_caja_caja_id_caja_id_fk" FOREIGN KEY ("caja_id") REFERENCES "public"."caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion_caja" ADD CONSTRAINT "sesion_caja_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion_caja" ADD CONSTRAINT "sesion_caja_validado_por_usuario_id_fk" FOREIGN KEY ("validado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta" ADD CONSTRAINT "venta_sesion_id_sesion_caja_id_fk" FOREIGN KEY ("sesion_id") REFERENCES "public"."sesion_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta" ADD CONSTRAINT "venta_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta" ADD CONSTRAINT "venta_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta" ADD CONSTRAINT "venta_anulada_por_usuario_id_fk" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_venta_id_venta_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_presentacion_id_presentacion_id_fk" FOREIGN KEY ("presentacion_id") REFERENCES "public"."presentacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_lote_id_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_pago" ADD CONSTRAINT "venta_pago_venta_id_venta_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerta_estado_idx" ON "alerta" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "alerta_clave_idx" ON "alerta" USING btree ("clave");--> statement-breakpoint
CREATE INDEX "campana_producto_idx" ON "campana" USING btree ("producto_id");--> statement-breakpoint
CREATE INDEX "comision_usuario_fecha_idx" ON "comision" USING btree ("usuario_id","fecha");--> statement-breakpoint
CREATE INDEX "comision_venta_idx" ON "comision" USING btree ("venta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comision_diaria_uq" ON "comision_diaria" USING btree ("usuario_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "compra_doc_uq" ON "compra" USING btree ("proveedor_id","tipo_comprobante","serie","numero");--> statement-breakpoint
CREATE INDEX "kardex_producto_fecha_idx" ON "kardex" USING btree ("producto_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "liquidacion_uq" ON "liquidacion_mensual" USING btree ("usuario_id","mes");--> statement-breakpoint
CREATE UNIQUE INDEX "lote_producto_numero_uq" ON "lote" USING btree ("producto_id","numero");--> statement-breakpoint
CREATE INDEX "lote_venc_idx" ON "lote" USING btree ("vencimiento");--> statement-breakpoint
CREATE INDEX "presentacion_producto_idx" ON "presentacion" USING btree ("producto_id");--> statement-breakpoint
CREATE INDEX "producto_nombre_idx" ON "producto" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "sesion_estado_idx" ON "sesion_caja" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "venta_serie_numero_uq" ON "venta" USING btree ("serie","numero");--> statement-breakpoint
CREATE INDEX "venta_fecha_idx" ON "venta" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "venta_sesion_idx" ON "venta" USING btree ("sesion_id");--> statement-breakpoint
CREATE INDEX "vd_venta_idx" ON "venta_detalle" USING btree ("venta_id");--> statement-breakpoint
CREATE INDEX "vd_producto_idx" ON "venta_detalle" USING btree ("producto_id");--> statement-breakpoint
CREATE INDEX "vp_venta_idx" ON "venta_pago" USING btree ("venta_id");