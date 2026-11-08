ALTER TABLE "transferencia" ADD COLUMN "destino_tipo_doc" text;--> statement-breakpoint
UPDATE "transferencia" SET "destino_tipo_doc" = 'RUC' WHERE "destino_ruc" IS NOT NULL;
