"use client";
import { Minus, Plus } from "lucide-react";
import { soles } from "@/lib/cliente";

export const DENOMS = [
  { v: "200", t: "S/ 200", b: true }, { v: "100", t: "S/ 100", b: true }, { v: "50", t: "S/ 50", b: true }, { v: "20", t: "S/ 20", b: true }, { v: "10", t: "S/ 10", b: true },
  { v: "5", t: "S/ 5" }, { v: "2", t: "S/ 2" }, { v: "1", t: "S/ 1" }, { v: "0.5", t: "50 cént." }, { v: "0.2", t: "20 cént." }, { v: "0.1", t: "10 cént." },
];

export const totalDe = (c: Record<string, number>) => Math.round(Object.entries(c).reduce((s, [d, n]) => s + Number(d) * (n || 0), 0) * 100) / 100;

/** Conteo de efectivo por denominación: billetes arriba, monedas abajo. */
export function ContadorEfectivo({ conteo, alCambiar }: { conteo: Record<string, number>; alCambiar: (c: Record<string, number>) => void }) {
  const set = (d: string, n: number) => alCambiar({ ...conteo, [d]: Math.max(0, n) });
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        {DENOMS.map((d) => (
          <div key={d.v} className={`rounded-2xl border px-3 py-2.5 ${conteo[d.v] ? "border-petroleo-3/40 bg-[#f1f8f6]" : "border-foil-2 bg-papel"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[12.5px] font-semibold ${d.b ? "text-petroleo-3" : "text-ink-2"}`}>{d.t}</span>
              <span className="text-[11.5px] text-ink-3">{d.b ? "billete" : "moneda"}</span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <button type="button" onClick={() => set(d.v, (conteo[d.v] || 0) - 1)} className="size-8 grid place-items-center rounded-lg hover:bg-foil" aria-label={`Quitar ${d.t}`}><Minus size={15} /></button>
              <input value={conteo[d.v] || ""} placeholder="0" inputMode="numeric" aria-label={`Cantidad de ${d.t}`} onChange={(e) => set(d.v, parseInt(e.target.value) || 0)}
                className="w-14 h-8 text-center rounded-lg border border-foil-3 font-semibold bg-papel" />
              <button type="button" onClick={() => set(d.v, (conteo[d.v] || 0) + 1)} className="size-8 grid place-items-center rounded-lg hover:bg-foil" aria-label={`Agregar ${d.t}`}><Plus size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-end justify-between mt-4 px-1">
        <span className="text-sm font-semibold text-ink-2">Efectivo contado</span>
        <span className="cifra text-[32px] leading-none">{soles(totalDe(conteo))}</span>
      </div>
    </div>
  );
}
