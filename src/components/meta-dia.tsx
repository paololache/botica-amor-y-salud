"use client";
import { CalendarCheck, Target } from "lucide-react";
import { soles } from "@/lib/cliente";
import type { AvanceMes, MetaDia } from "@/lib/services/metas";

/** Barra de avance de la meta de venta del día. */
export function BarraMeta({ meta, compacta }: { meta: MetaDia; compacta?: boolean }) {
  if (!meta.objetivo || meta.porcentaje === null) return null;
  const cumplida = meta.porcentaje >= 100;
  return (
    <div>
      <div className={`flex items-center justify-between gap-2 ${compacta ? "text-[12.5px]" : "text-[13px]"}`}>
        <span className="flex items-center gap-1.5 font-semibold text-ink-2"><Target size={14} className={cumplida ? "text-ok" : "text-amor"} aria-hidden /> Meta del día</span>
        <span className="tabular-nums text-ink-2"><b className="text-ink">{soles(meta.vendido)}</b> de {soles(meta.objetivo)}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-foil-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(meta.porcentaje))} aria-label="Avance de la meta del día">
        <div className={`h-full rounded-full transition-[width] duration-700 ${cumplida ? "bg-ok" : "bg-amor"}`} style={{ width: `${Math.min(100, meta.porcentaje)}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-ink-3">
        {cumplida ? `¡Cumplida! Vas ${Math.round(meta.porcentaje)}%` : `${Math.round(meta.porcentaje)}% · faltan ${soles(meta.faltante ?? 0)}`}
        {meta.automatica ? " · meta calculada con tu promedio" : ""}
      </p>
    </div>
  );
}

/** Avance de la cuota del mes con el ritmo diario que falta para cumplirla. */
export function BarraCuotaMes({ cuota, titulo }: { cuota: AvanceMes; titulo: string }) {
  if (!cuota.meta || cuota.porcentaje === null) return null;
  const cumplida = cuota.porcentaje >= 100;
  // Lo esperado a la fecha si se vendiera parejo todos los días del mes.
  const esperado = cuota.diasMes ? (cuota.diasTranscurridos / cuota.diasMes) * 100 : 0;
  const atrasado = !cumplida && cuota.porcentaje + 0.5 < esperado;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[13px]">
        <span className="flex items-center gap-1.5 font-semibold text-ink-2 whitespace-nowrap"><CalendarCheck size={14} className={cumplida ? "text-ok" : "text-petroleo-3"} aria-hidden /> {titulo}</span>
        <span className="tabular-nums text-ink-2 whitespace-nowrap"><b className="text-ink">{soles(cuota.vendido)}</b> de {soles(cuota.meta)}</span>
      </div>
      <div className="relative mt-1.5 h-2.5 rounded-full bg-foil-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(cuota.porcentaje))} aria-label={titulo}>
        <div className={`h-full rounded-full transition-[width] duration-700 ${cumplida ? "bg-ok" : atrasado ? "bg-ambar" : "bg-petroleo-3"}`} style={{ width: `${Math.min(100, cuota.porcentaje)}%` }} />
        {!cumplida && esperado > 0 && esperado < 100 ? <span className="absolute top-0 h-full w-0.5 bg-ink/40" style={{ left: `${esperado}%` }} title="Lo esperado a la fecha" /> : null}
      </div>
      <p className="mt-1 text-[12px] text-ink-3">
        {cumplida ? `¡Cuota cumplida! ${Math.round(cuota.porcentaje)}%`
          : `${Math.round(cuota.porcentaje)}% · faltan ${soles(cuota.faltante ?? 0)}${cuota.porDia ? ` · ${soles(cuota.porDia)} por día` : ""}`}
        {!cumplida && cuota.proyeccion !== null && cuota.vendido > 0 ? ` · al ritmo actual cerrarías en ${soles(cuota.proyeccion)}` : ""}
      </p>
    </div>
  );
}
