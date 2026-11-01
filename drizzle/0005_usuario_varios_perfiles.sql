ALTER TABLE "usuario" ADD COLUMN "roles" "rol"[];--> statement-breakpoint
UPDATE "usuario" SET "roles" = ARRAY["rol"];--> statement-breakpoint
ALTER TABLE "usuario" ALTER COLUMN "roles" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_con_perfil" CHECK (cardinality("usuario"."roles") > 0);
