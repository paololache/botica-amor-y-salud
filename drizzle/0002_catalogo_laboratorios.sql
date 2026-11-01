CREATE TABLE "laboratorio" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"clave" text NOT NULL,
	CONSTRAINT "laboratorio_clave_unique" UNIQUE("clave")
);
--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "laboratorio_id" integer;--> statement-breakpoint
ALTER TABLE "producto" ADD CONSTRAINT "producto_laboratorio_id_laboratorio_id_fk" FOREIGN KEY ("laboratorio_id") REFERENCES "public"."laboratorio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION clave_laboratorio_migracion(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH l AS (SELECT btrim(regexp_replace(replace(lower(translate(n, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '.', ''), '[^a-z0-9]+', ' ', 'g')) AS t)
  SELECT coalesce(nullif(replace(regexp_replace(t, '\m(laboratorios?|labs?|sac|saa|sa|srl|eirl|ltda|inc|cia)\M', '', 'g'), ' ', ''), ''), replace(t, ' ', '')) FROM l
$$;--> statement-breakpoint
INSERT INTO "laboratorio" ("nombre", "clave")
SELECT DISTINCT ON (clave) nombre, clave FROM (
  SELECT regexp_replace(btrim("laboratorio"), '\s+', ' ', 'g') AS nombre, clave_laboratorio_migracion("laboratorio") AS clave, count(*) AS n
  FROM "producto" WHERE "laboratorio" IS NOT NULL GROUP BY 1, 2
) s WHERE clave <> '' ORDER BY clave, n DESC, (nombre = upper(nombre)), nombre;--> statement-breakpoint
UPDATE "producto" p SET "laboratorio_id" = l."id" FROM "laboratorio" l WHERE p."laboratorio" IS NOT NULL AND l."clave" = clave_laboratorio_migracion(p."laboratorio");--> statement-breakpoint
DROP FUNCTION clave_laboratorio_migracion(text);
