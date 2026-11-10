CREATE TABLE "regularizacion_cierre" (
	"id" serial PRIMARY KEY NOT NULL,
	"sesion_id" integer NOT NULL,
	"clave" text NOT NULL,
	"origen" text NOT NULL,
	"accion" text NOT NULL,
	"referencia" text,
	"medio_anterior" "medio_pago",
	"medio" "medio_pago",
	"monto" numeric(12, 2) NOT NULL,
	"operacion" text,
	"venta_id" integer,
	"comentario" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movimiento_caja" ADD COLUMN "venta_id" integer;--> statement-breakpoint
ALTER TABLE "sesion_caja" ADD COLUMN "validado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sesion_caja" ADD COLUMN "observacion_validacion" text;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD CONSTRAINT "regularizacion_cierre_sesion_id_sesion_caja_id_fk" FOREIGN KEY ("sesion_id") REFERENCES "public"."sesion_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD CONSTRAINT "regularizacion_cierre_venta_id_venta_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD CONSTRAINT "regularizacion_cierre_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regularizacion_sesion_idx" ON "regularizacion_cierre" USING btree ("sesion_id");