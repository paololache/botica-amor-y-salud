"use client";
import {
  ArrowDownToLine, CalendarClock, CalendarX2, ClipboardCheck, FileClock, Hourglass, LockOpen, Megaphone, PackageX, Scale, TrendingDown, type LucideIcon,
} from "lucide-react";

export type Conteo = { tipo: string; nombre: string; total: number; criticas: number; grupo: string };

const ICONOS: Record<string, LucideIcon> = {
  AGOTADO: PackageX, VENCIDO: CalendarX2, POR_VENCER: CalendarClock, POR_TERMINARSE: TrendingDown, BAJO_MINIMO: ArrowDownToLine,
  DIF_CAJA: Scale, CAJA_ABIERTA: LockOpen, CPE_PENDIENTE: FileClock, SALIDA_PENDIENTE: ClipboardCheck, CAMPANA_POR_VENCER: Megaphone, SIN_ROTACION: Hourglass,
};

/** Resumen de alertas: una tarjeta por tipo con su cantidad; el color indica la severidad más alta. */
export function Blister({ conteos, seleccion, alElegir }: { conteos: Conteo[]; seleccion: string | null; alElegir: (tipo: string | null) => void }) {
  const orden = ["AGOTADO", "VENCIDO", "POR_VENCER", "POR_TERMINARSE", "DIF_CAJA", "CPE_PENDIENTE", "BAJO_MINIMO", "CAJA_ABIERTA", "SALIDA_PENDIENTE", "CAMPANA_POR_VENCER", "SIN_ROTACION"];
  const lista = [...conteos].sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo));
  const pendientes = lista.reduce((s, c) => s + c.total, 0);
  return (
    <div className="alertas-panel">
      <div className="alertas">
        {lista.map((c, i) => {
          const vacio = c.total === 0;
          const sev = c.criticas > 0 ? "CRITICA" : c.tipo === "SIN_ROTACION" || c.tipo === "CAMPANA_POR_VENCER" || c.tipo === "SALIDA_PENDIENTE" ? "INFO" : "ALTA";
          const Icono = ICONOS[c.tipo] ?? ClipboardCheck;
          return (
            <button key={c.tipo} type="button" className="alerta" style={{ ["--i" as string]: i }} data-vacio={vacio ? "1" : "0"} data-sev={vacio ? undefined : sev}
              data-sel={seleccion === c.tipo ? "1" : "0"} disabled={vacio} aria-pressed={seleccion === c.tipo}
              aria-label={`${c.nombre}: ${c.total}${c.criticas ? `, ${c.criticas} críticas` : ""}`}
              onClick={() => alElegir(seleccion === c.tipo ? null : c.tipo)}>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="icono"><Icono size={18} strokeWidth={1.75} aria-hidden /></span>
                {c.criticas > 0 && c.criticas < c.total ? <span className="criticas">{c.criticas} críticas</span> : null}
              </span>
              <span className="flex flex-col gap-1.5 min-w-0">
                <span className="n">{c.total}</span>
                <span className="l">{c.nombre}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-2">
        <span className="font-semibold text-ink">{pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}</span>
        <span>{seleccion ? "Toca la tarjeta otra vez para ver todo" : "Toca una tarjeta para filtrar"}</span>
      </div>
    </div>
  );
}
