CREATE TABLE "uso_modulo" (
	"usuario_id" integer NOT NULL,
	"ruta" text NOT NULL,
	"visitas" integer DEFAULT 0 NOT NULL,
	"ultima" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uso_modulo_usuario_id_ruta_pk" PRIMARY KEY("usuario_id","ruta")
);
--> statement-breakpoint
ALTER TABLE "uso_modulo" ADD CONSTRAINT "uso_modulo_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;