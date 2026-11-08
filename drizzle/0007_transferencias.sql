CREATE TABLE "transferencia" (
	"id" serial PRIMARY KEY NOT NULL,
	"serie" text NOT NULL,
	"numero" integer NOT NULL,
	"destino" text NOT NULL,
	"motivo" text NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"registrado_por" integer NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_por" integer,
	"decidido_en" timestamp with time zone,
	"comentario" text,
	"costo_adicional" numeric(12, 2),
	"total_venta" numeric(12, 2),
	"costo_total" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "transferencia_detalle" (
	"id" serial PRIMARY KEY NOT NULL,
	"transferencia_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"unidades" integer NOT NULL,
	"en_campana" boolean DEFAULT false NOT NULL,
	"precio_unitario" numeric(12, 2),
	"costo_unitario" numeric(14, 4)
);
--> statement-breakpoint
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_registrado_por_usuario_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_decidido_por_usuario_id_fk" FOREIGN KEY ("decidido_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencia_detalle" ADD CONSTRAINT "transferencia_detalle_transferencia_id_transferencia_id_fk" FOREIGN KEY ("transferencia_id") REFERENCES "public"."transferencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencia_detalle" ADD CONSTRAINT "transferencia_detalle_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transferencia_doc_uq" ON "transferencia" USING btree ("serie","numero");--> statement-breakpoint
CREATE INDEX "transferencia_estado_idx" ON "transferencia" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "td_transferencia_idx" ON "transferencia_detalle" USING btree ("transferencia_id");