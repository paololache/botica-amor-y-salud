ALTER TABLE "regularizacion_cierre" ADD COLUMN "cargo_usuario_id" integer;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD COLUMN "cargo_estado" text;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD COLUMN "cargo_pagado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD COLUMN "cargo_pagado_por" integer;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD CONSTRAINT "regularizacion_cierre_cargo_usuario_id_usuario_id_fk" FOREIGN KEY ("cargo_usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizacion_cierre" ADD CONSTRAINT "regularizacion_cierre_cargo_pagado_por_usuario_id_fk" FOREIGN KEY ("cargo_pagado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regularizacion_cargo_idx" ON "regularizacion_cierre" USING btree ("cargo_usuario_id","cargo_estado");