CREATE TABLE "venta_servicio" (
	"id" serial PRIMARY KEY NOT NULL,
	"venta_id" integer NOT NULL,
	"servicio_id" integer NOT NULL,
	"descripcion" text NOT NULL,
	"cantidad" integer NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"tipo_igv" text DEFAULT 'GRAVADO' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD COLUMN "cobrado_en_venta" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "tipo_igv" text DEFAULT 'GRAVADO' NOT NULL;--> statement-breakpoint
ALTER TABLE "venta" ADD COLUMN "exonerada" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venta" ADD COLUMN "inafecta" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venta_detalle" ADD COLUMN "tipo_igv" text DEFAULT 'GRAVADO' NOT NULL;--> statement-breakpoint
ALTER TABLE "venta_servicio" ADD CONSTRAINT "venta_servicio_venta_id_venta_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_servicio" ADD CONSTRAINT "venta_servicio_servicio_id_servicio_id_fk" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vs_venta_idx" ON "venta_servicio" USING btree ("venta_id");