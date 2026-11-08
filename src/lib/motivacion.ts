import type { MetaDia } from "./services/metas";

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mensajes por tramo de avance de la meta del día. {n} nombre, {p} % de avance, {f} lo que falta. */
const TRAMOS: { desde: number; mensajes: string[] }[] = [
  { desde: 150, mensajes: [
    "¡Imparable, {n}! Ya vas {p} de tu meta.",
    "Día récord: superaste tu meta con creces. ¡Felicitaciones!",
    "¡Increíble! Vas {p} de lo previsto para hoy.",
    "Estás teniendo un gran día, {n}. ¡Sigue brillando!",
  ] },
  { desde: 100, mensajes: [
    "¡Meta cumplida, {n}! Todo lo que vendas ahora es extra.",
    "¡Lo lograste! Ya pasaste tu meta de hoy.",
    "Excelente trabajo: vas {p} de tu meta.",
    "¡Meta superada! Cada venta de aquí en adelante suma a tu récord.",
  ] },
  { desde: 75, mensajes: [
    "¡Ya casi! Solo faltan {f} para tu meta.",
    "Vas {p}, {n}. ¡Es la recta final!",
    "Estás muy cerca: {f} más y la cumples.",
    "¡Un empujón más y llegas a tu meta de hoy!",
  ] },
  { desde: 50, mensajes: [
    "¡Pasaste la mitad de tu meta! Te faltan {f}.",
    "Más de la mitad, {n}. ¡Sigue a este ritmo!",
    "Vas {p} de tu meta. El día se ve muy bien.",
    "Mitad cumplida. Ofrece un complemento y llegas antes.",
  ] },
  { desde: 25, mensajes: [
    "¡Buen ritmo, {n}! Ya vas {p} de tu meta.",
    "Superaste la cuarta parte de tu meta. Faltan {f}.",
    "Sugiere un producto en campaña en la próxima venta y acelera.",
    "Vas por buen camino: {p} de tu meta de hoy.",
  ] },
  { desde: 0, mensajes: [
    "¡Buen comienzo, {n}! Vas {p} de tu meta.",
    "Ya arrancaste: te faltan {f} para tu meta de hoy.",
    "Cada venta suma. Los productos en campaña te ayudan a avanzar más rápido.",
    "El día recién empieza y ya vas sumando. ¡Vamos!",
  ] },
];
const SIN_META = [
  "¡Venta registrada, {n}! Un cliente bien atendido siempre vuelve.",
  "¡Bien hecho! Vamos por la siguiente venta.",
  "Gran atención, {n}. El próximo cliente te espera.",
  "Una venta más en tu día. ¡Sigue así!",
];

/** Elige un mensaje según el avance, distinto del anterior. `total` es el monto de la venta recién emitida. */
export function mensajeMotivacional(meta: MetaDia | null | undefined, nombre: string, total: number, anterior?: string | null) {
  const n = nombre.replace(/^Q\.F\.\s*/, "").split(" ")[0];
  let opciones: string[];
  if (!meta?.objetivo || meta.porcentaje === null) opciones = SIN_META;
  else if (meta.vendido >= meta.objetivo && meta.vendido - total < meta.objetivo) opciones = [`¡Con esta venta cumpliste tu meta del día, {n}! Felicitaciones.`];
  else opciones = TRAMOS.find((t) => meta.porcentaje! >= t.desde)!.mensajes;
  const llenar = (m: string) => m.replace("{n}", n).replace("{p}", `${Math.round(meta?.porcentaje ?? 0)}%`).replace("{f}", soles(meta?.faltante ?? 0));
  const candidatas = opciones.map(llenar).filter((m) => m !== anterior);
  const lista = candidatas.length ? candidatas : opciones.map(llenar);
  return lista[Math.floor(Math.random() * lista.length)];
}
