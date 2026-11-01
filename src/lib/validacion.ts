import { z } from "zod";
import { DENOMINACIONES, esFechaValida, esMesValido } from "./util";

export const fecha = z.string().refine(esFechaValida, "fecha inválida");
export const fechaOpcional = z.preprocess((v) => (v === "" || v === null ? undefined : v), fecha.optional());
export const mes = z.string().refine(esMesValido, "mes inválido");
/** Texto obligatorio: los espacios no cuentan como contenido. */
export const texto = (min: number, mensaje?: string) => z.string().trim().min(min, mensaje);
/** Importe en soles con un tope que ninguna operación real de la botica alcanza. */
export const monto = z.number().positive().max(10000000, "el monto es demasiado grande");
export const montoOCero = z.number().min(0).max(10000000, "el monto es demasiado grande");
/** Billetes y monedas: solo denominaciones que existen. */
export const conteoEfectivo = z.record(z.string(), z.number().int().min(0).max(1000000)).refine((c) => Object.keys(c).every((d) => (DENOMINACIONES as readonly string[]).includes(d)), "denominación inválida");
