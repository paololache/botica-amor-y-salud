ALTER TABLE "presentacion" ADD COLUMN "codigo" text;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "forma_farmaceutica" text;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "registro_sanitario" text;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "registro_vence" date;--> statement-breakpoint
ALTER TABLE "presentacion" ADD CONSTRAINT "presentacion_codigo_unique" UNIQUE("codigo");