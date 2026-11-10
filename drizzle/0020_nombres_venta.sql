-- "Ticket" no es un término que use el personal de la botica: las métricas base pasan a llamarse por "venta".
UPDATE "metrica" SET "nombre" = 'Venta promedio' WHERE "codigo" = 'ticket_promedio' AND "nombre" = 'Ticket promedio';--> statement-breakpoint
UPDATE "metrica" SET "nombre" = 'Unidades por venta' WHERE "codigo" = 'unidades_por_ticket' AND "nombre" = 'Unidades por ticket';
