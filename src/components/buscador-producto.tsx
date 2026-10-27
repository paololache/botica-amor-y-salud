"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, soles } from "@/lib/cliente";

export type ProdBusqueda = { id: number; codigo: string; nombre: string; principioActivo: string | null; stockVigente: number; stock: number; presentaciones: { id: number; nombre: string; factor: number; pvp: number }[] };

export function BuscadorProducto({ alElegir, placeholder = "Buscar producto por nombre o código", autoFocus }: { alElegir: (p: ProdBusqueda) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ProdBusqueda[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    const h = setTimeout(() => api<ProdBusqueda[]>(`/api/productos?buscar=${encodeURIComponent(q)}&limite=8`).then((r) => { setRes(r); setI(0); }).catch(() => setRes([])), 160);
    return () => clearTimeout(h);
  }, [q]);
  const elegir = (p: ProdBusqueda) => { alElegir(p); setQ(""); setRes([]); };
  return (
    <div className="relative">
      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, res.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
          if (e.key === "Enter" && res[i]) { e.preventDefault(); elegir(res[i]); }
          if (e.key === "Escape") setRes([]);
        }}
        className="w-full h-10 pl-9 pr-3 rounded-xl border border-foil-3 bg-papel text-[14.5px] focus:border-petroleo-3 focus:outline-none focus:ring-3 focus:ring-menta/40" />
      {res.length ? (
        <ul className="absolute z-30 left-0 right-0 mt-1.5 tarjeta shadow-xl py-1 max-h-80 overflow-y-auto">
          {res.map((p, k) => (
            <li key={p.id}>
              <button type="button" onMouseEnter={() => setI(k)} onClick={() => elegir(p)} className={`w-full text-left px-3 py-2 flex justify-between gap-3 ${k === i ? "bg-foil/70" : ""}`}>
                <span><span className="font-semibold text-[14px]">{p.nombre}</span><span className="block text-[12px] text-ink-3">{p.codigo}{p.principioActivo ? ` · ${p.principioActivo}` : ""}</span></span>
                <span className="text-[12.5px] text-ink-2 text-right">{p.stock} und.<span className="block">{soles(p.presentaciones[0]?.pvp)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
