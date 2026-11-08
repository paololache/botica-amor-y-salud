CREATE TABLE "meta_mensual" (
	"id" serial PRIMARY KEY NOT NULL,
	"mes" text NOT NULL,
	"usuario_id" integer,
	"monto" numeric(12, 2) NOT NULL,
	"actualizado_por" integer,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_mensual" ADD CONSTRAINT "meta_mensual_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_mensual" ADD CONSTRAINT "meta_mensual_actualizado_por_usuario_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_mensual_mes_usuario_uq" ON "meta_mensual" USING btree ("mes",coalesce("usuario_id", 0));