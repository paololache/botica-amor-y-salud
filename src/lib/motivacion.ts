import type { MetaDia } from "./services/metas";

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Ritmo de quien vende: ventas en la última hora (incluida la recién emitida) y en el día. */
export type Ritmo = { ultimaHora: number; montoUltimaHora: number; hoy: number };

/**
 * Variables: {n} nombre, {p} % de avance, {f} lo que falta para la meta,
 * {v} ventas en la última hora, {m} monto vendido en la última hora, {h} ventas del día.
 */
const TRAMOS: { desde: number; mensajes: string[] }[] = [
  { desde: 150, mensajes: [
    "¡Imparable, {n}! Ya vas {p} de tu meta.",
    "Día récord: superaste tu meta con creces. ¡Felicitaciones!",
    "¡Increíble! Vas {p} de lo previsto para hoy.",
    "Estás teniendo un gran día, {n}. ¡Sigue brillando!",
    "Esto ya es un día para recordar: {p} de tu meta.",
    "Tus clientes salen contentos y se nota en las ventas. ¡Excelente, {n}!",
    "Superaste tu meta y sigues sumando. ¡Qué día, {n}!",
  ] },
  { desde: 100, mensajes: [
    "¡Meta cumplida, {n}! Todo lo que vendas ahora es extra.",
    "¡Lo lograste! Ya pasaste tu meta de hoy.",
    "Excelente trabajo: vas {p} de tu meta.",
    "¡Meta superada! Cada venta de aquí en adelante suma a tu récord.",
    "Meta del día en el bolsillo. ¡Vamos por más, {n}!",
    "¡Cumpliste! Ahora cada venta es un logro adicional.",
  ] },
  { desde: 75, mensajes: [
    "¡Ya casi! Solo faltan {f} para tu meta.",
    "Vas {p}, {n}. ¡Es la recta final!",
    "Estás muy cerca: {f} más y la cumples.",
    "¡Un empujón más y llegas a tu meta de hoy!",
    "La meta ya se ve: te faltan {f}. ¡Tú puedes!",
    "Tres cuartos del camino recorrido. Un par de ventas más y lo logras.",
  ] },
  { desde: 50, mensajes: [
    "¡Pasaste la mitad de tu meta! Te faltan {f}.",
    "Más de la mitad, {n}. ¡Sigue a este ritmo!",
    "Vas {p} de tu meta. El día se ve muy bien.",
    "Mitad cumplida. Ofrece un complemento y llegas antes.",
    "Media meta lista. Recomienda un producto en campaña y acelera.",
    "Buen avance, {n}: ya cruzaste la mitad del camino.",
  ] },
  { desde: 25, mensajes: [
    "¡Buen ritmo, {n}! Ya vas {p} de tu meta.",
    "Superaste la cuarta parte de tu meta. Faltan {f}.",
    "Sugiere un producto en campaña en la próxima venta y acelera.",
    "Vas por buen camino: {p} de tu meta de hoy.",
    "Cada cliente cuenta. Ya llevas {p}, {n}.",
    "¡Bien! Un cuarto de la meta ya está. A seguir sumando.",
  ] },
  { desde: 0, mensajes: [
    "¡Buen comienzo, {n}! Vas {p} de tu meta.",
    "Ya arrancaste: te faltan {f} para tu meta de hoy.",
    "Cada venta suma. Los productos en campaña te ayudan a avanzar más rápido.",
    "El día recién empieza y ya vas sumando. ¡Vamos!",
    "Primeras ventas del día. ¡Que siga así, {n}!",
    "Una atención amable trae al siguiente cliente. ¡Adelante!",
  ] },
];

const SIN_META = [
  "¡Venta registrada, {n}! Un cliente bien atendido siempre vuelve.",
  "¡Bien hecho! Vamos por la siguiente venta.",
  "Gran atención, {n}. El próximo cliente te espera.",
  "Una venta más en tu día. ¡Sigue así!",
  "¡Listo! Recuerda ofrecer los productos en campaña.",
  "Cliente atendido. ¡Buen trabajo, {n}!",
  "Cada venta cuenta. ¡A por la siguiente!",
];

/** Varias ventas en la misma hora: se celebra lo bien que se está vendiendo hoy. */
const RACHA: { desde: number; mensajes: string[] }[] = [
  { desde: 10, mensajes: [
    "¡Hora imparable, {n}! {v} ventas en la última hora.",
    "¡Qué hora! Llevas {v} ventas en 60 minutos. Hoy es tu día.",
    "{v} ventas en una hora: así se vende, {n}. ¡Impresionante!",
    "La botica está a tope y tú también: {v} ventas en la última hora.",
  ] },
  { desde: 5, mensajes: [
    "¡Estás en racha, {n}! {v} ventas en la última hora.",
    "¡Hoy se está vendiendo muy bien! Ya van {v} en esta hora ({m}).",
    "Racha encendida: {v} ventas seguidas en la última hora. ¡No pares!",
    "¡Excelente ritmo! {m} vendidos en la última hora.",
    "Hoy vas volando, {n}: {v} ventas en una hora y {h} en el día.",
  ] },
  { desde: 3, mensajes: [
    "¡Buen ritmo, {n}! {v} ventas en la última hora.",
    "Las ventas están fluyendo: {v} en esta hora. ¡Así se hace!",
    "¡Se está vendiendo bien hoy! Ya llevas {h} ventas en el día.",
    "Cliente tras cliente: {v} ventas en la última hora. ¡Bien, {n}!",
    "Hoy está movido y lo estás aprovechando: {v} ventas en una hora.",
  ] },
];

/** A partir de cuántas ventas en la última hora se celebran las rachas. */
export const RACHA_DESDE = 3;

/**
 * Elige un mensaje distinto del anterior. Prioridad: cumplir la meta con esta venta; si hay varias ventas en la misma
 * hora, una frase de racha (lo bien que se vende hoy); si no, una según el avance de la meta.
 * `total` es el monto de la venta recién emitida.
 */
export function mensajeMotivacional(meta: MetaDia | null | undefined, nombre: string, total: number, anterior?: string | null, ritmo?: Ritmo | null) {
  const n = nombre.replace(/^Q\.F\.\s*/, "").split(" ")[0];
  let opciones: string[];
  const recienCumplida = !!meta?.objetivo && meta.porcentaje !== null && meta.vendido >= meta.objetivo && meta.vendido - total < meta.objetivo;
  if (recienCumplida) opciones = ["¡Con esta venta cumpliste tu meta del día, {n}! Felicitaciones."];
  else if (ritmo && ritmo.ultimaHora >= RACHA_DESDE) opciones = RACHA.find((r) => ritmo.ultimaHora >= r.desde)!.mensajes;
  else if (!meta?.objetivo || meta.porcentaje === null) opciones = SIN_META;
  else opciones = TRAMOS.find((t) => meta.porcentaje! >= t.desde)!.mensajes;
  const llenar = (m: string) => m
    .replace("{n}", n).replace("{p}", `${Math.round(meta?.porcentaje ?? 0)}%`).replace("{f}", soles(meta?.faltante ?? 0))
    .replace("{v}", String(ritmo?.ultimaHora ?? 0)).replace("{m}", soles(ritmo?.montoUltimaHora ?? 0)).replace("{h}", String(ritmo?.hoy ?? 0));
  const candidatas = opciones.map(llenar).filter((m) => m !== anterior);
  const lista = candidatas.length ? candidatas : opciones.map(llenar);
  return lista[Math.floor(Math.random() * lista.length)];
}
