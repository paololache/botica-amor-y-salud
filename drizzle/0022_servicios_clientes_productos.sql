CREATE TABLE "atencion_servicio" (
	"id" serial PRIMARY KEY NOT NULL,
	"servicio_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer NOT NULL,
	"cliente_id" integer,
	"paciente_doc" text,
	"paciente_nombre" text NOT NULL,
	"paciente_edad" integer,
	"paciente_sexo" text,
	"resultados" jsonb,
	"clasificacion" text,
	"derivar" boolean DEFAULT false NOT NULL,
	"receta" jsonb,
	"consentimiento" boolean DEFAULT false NOT NULL,
	"verificaciones" jsonb,
	"producto_origen" text,
	"producto_id" integer,
	"lote_id" integer,
	"producto_texto" text,
	"lote_texto" text,
	"vencimiento_producto" date,
	"dosis" text,
	"sitio_aplicacion" text,
	"observacion" text,
	"reaccion_adversa" text,
	"precio" numeric(12, 2) DEFAULT 0 NOT NULL,
	"medio_pago" "medio_pago",
	"sesion_id" integer,
	"movimiento_caja_id" integer,
	"estado" text DEFAULT 'REGISTRADA' NOT NULL,
	"anulada_por" integer,
	"motivo_anulacion" text
);
--> statement-breakpoint
CREATE TABLE "servicio" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"via" text,
	"descripcion" text,
	"precio" numeric(12, 2) DEFAULT 0 NOT NULL,
	"requiere_receta" boolean DEFAULT false NOT NULL,
	"requiere_consentimiento" boolean DEFAULT false NOT NULL,
	"roles" text[] NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "servicio_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "telefono" text;--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "notas" text;--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "creado_en" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "nombre_comercial" text;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "patologias" text;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_servicio_id_servicio_id_fk" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_lote_id_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_sesion_id_sesion_caja_id_fk" FOREIGN KEY ("sesion_id") REFERENCES "public"."sesion_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atencion_servicio" ADD CONSTRAINT "atencion_servicio_anulada_por_usuario_id_fk" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "atencion_fecha_idx" ON "atencion_servicio" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "atencion_paciente_idx" ON "atencion_servicio" USING btree ("paciente_doc");