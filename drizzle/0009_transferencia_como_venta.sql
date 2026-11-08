ALTER TABLE "venta" ALTER COLUMN "sesion_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transferencia" ADD COLUMN "tipo_destino" text DEFAULT 'EMPRESA' NOT NULL;--> statement-breakpoint
ALTER TABLE "transferencia" ADD COLUMN "destino_ruc" text;--> statement-breakpoint
ALTER TABLE "transferencia" ADD COLUMN "vendedor_id" integer;--> statement-breakpoint
ALTER TABLE "transferencia" ADD COLUMN "venta_id" integer;--> statement-breakpoint
ALTER TABLE "transferencia" ADD COLUMN "medio_pago" text;--> statement-breakpoint
ALTER TABLE "venta" ADD COLUMN "canal" text DEFAULT 'MOSTRADOR' NOT NULL;--> statement-breakpoint
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_vendedor_id_usuario_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_venta_id_venta_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE no action ON UPDATE no action;