"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgePercent, X } from "lucide-react";
import { soles } from "@/lib/cliente";

type Producto = {
  campanaId: number; productoId: number; producto: string; codigo: string; porcentaje: number; fin: string; vigente: number;
  precio: { presentacion: string; campana: number; lista: number } | null;
};
type Estado = { activo: false; motivo: string } | { activo: true; umbralMin: number; minutosSinVender: number; debeRecordar: boolean; productos: Producto[] };

const CLAVE = "botica_recordatorio_campana_hasta";
const CADA_MS = 60_000;

const leerPausa = () => { try { return Number(localStorage.getItem(CLAVE) ?? 0); } catch { return 0; } };
const pausar = (min: number) => { try { localStorage.setItem(CLAVE, String(Date.now() + min * 60_000)); } catch { /* solo esta visita */ } };

/**
 * Recordatorio de productos en campaña para quien vende: aparece cuando lleva un rato con la caja abierta sin vender.
 * Se revisa cada minuto mientras la pestaña está a la vista; desaparece solo al registrar una venta.
 */
export function RecordatorioCampana() {
  const ruta = usePathname();
  const [estado, setEstado] = useState<Extract<Estado, { activo: true }> | null>(null);
  const [visible, setVisible] = useState(false);
  const pausadoLocal = useRef(0);

  const revisar = useCallback(async () => {
    if (document.hidden) return;
    try {
      const r = await fetch("/api/campanas/recordatorio", { cache: "no-store" });
      if (!r.ok) return;
      const e = (await r.json()) as Estado;
      if (!e.activo || !e.debeRecordar) { setVisible(false); setEstado(e.activo ? e : null); return; }
      setEstado(e);
      if (Math.max(leerPausa(), pausadoLocal.current) <= Date.now()) setVisible(true);
    } catch { /* sin conexión: se reintenta en el siguiente minuto */ }
  }, []);

  useEffect(() => {
    const inicio = setTimeout(revisar, 4000);
    const h = setInterval(revisar, CADA_MS);
    document.addEventListener("visibilitychange", revisar);
    return () => { clearTimeout(inicio); clearInterval(h); document.removeEventListener("visibilitychange", revisar); };
  }, [revisar]);

  // Al volver de una venta, se revisa enseguida para ocultarlo si ya vendió.
  useEffect(() => { if (visible) revisar(); }, [ruta]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible || !estado) return null;
  const cerrar = () => { pausar(estado.umbralMin); pausadoLocal.current = Date.now() + estado.umbralMin * 60_000; setVisible(false); };
  const minutos = estado.minutosSinVender;
  const hace = minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`;

  return (
    <aside role="status" aria-live="polite" aria-label="Recordatorio de productos en campaña"
      className="no-imprimir aparecer fixed z-40 bottom-5 left-5 right-5 sm:left-auto sm:w-[380px] rounded-3xl bg-papel shadow-2xl border border-amor/25 overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-4 pb-3 bg-[linear-gradient(160deg,#fff,#fdf0f5)]">
        <span className="size-10 shrink-0 rounded-2xl bg-amor text-white grid place-items-center"><BadgePercent size={20} /></span>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-[15.5px] leading-snug">¡Aprovecha las campañas!</p>
          <p className="text-[13px] text-ink-2 mt-0.5">Llevas {hace} sin vender. Ofrece estos productos al próximo cliente.</p>
        </div>
        <button onClick={cerrar} className="size-8 -mr-1 grid place-items-center rounded-full text-ink-3 hover:bg-foil" aria-label="Cerrar recordatorio"><X size={16} /></button>
      </div>
      <ul className="divide-y divide-foil">
        {estado.productos.slice(0, 3).map((p) => (
          <li key={p.campanaId} className="flex items-center gap-3 px-5 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[14px] truncate">{p.producto}</p>
              <p className="text-[12.5px] text-ink-2">
                {p.precio ? <>{p.precio.presentacion} a <b className="text-amor-2">{soles(p.precio.campana)}</b> <s className="text-ink-3">{soles(p.precio.lista)}</s></> : `${p.vigente} und. disponibles`}
                {p.porcentaje ? <> · comisionas <b>{p.porcentaje}%</b></> : null}
              </p>
            </div>
            <Link href={`/vender?q=${encodeURIComponent(p.codigo || p.producto)}`}
              onClick={(e) => {
                setVisible(false);
                if (ruta === "/vender") { e.preventDefault(); window.dispatchEvent(new CustomEvent("botica:buscar-producto", { detail: p.codigo || p.producto })); }
              }}
              className="shrink-0 h-8 px-3 rounded-lg bg-amor text-white text-[13px] font-semibold grid place-items-center hover:bg-amor-2">Vender</Link>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 px-5 py-2.5 border-t border-foil text-[12.5px]">
        <span className="text-ink-3">{estado.productos.length > 3 ? `y ${estado.productos.length - 3} más en campaña` : "Productos en campaña con stock"}</span>
        <button onClick={cerrar} className="font-semibold text-petroleo-3 hover:underline">Recordar en {estado.umbralMin} min</button>
      </div>
    </aside>
  );
}
