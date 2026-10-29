"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { X, CircleCheck, TriangleAlert } from "lucide-react";

type Variante = "amor" | "petroleo" | "borde" | "fantasma" | "peligro";
const VARIANTES: Record<Variante, string> = {
  amor: "bg-amor text-white hover:bg-amor-2 shadow-[0_8px_18px_-10px_rgba(226,69,122,.9)]",
  petroleo: "bg-petroleo text-white hover:bg-petroleo-2",
  borde: "bg-papel text-ink border border-foil-3 hover:border-ink-3",
  fantasma: "text-ink-2 hover:bg-foil-2/60",
  peligro: "bg-rojo text-white hover:brightness-95",
};

export function Boton({ variante = "petroleo", tam = "md", cargando, className = "", children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tam?: "sm" | "md" | "lg"; cargando?: boolean }) {
  const t = tam === "sm" ? "h-8 px-3 text-[13px] rounded-lg" : tam === "lg" ? "h-14 px-6 text-[17px] rounded-2xl" : "h-10 px-4 text-sm rounded-xl";
  return (
    <button {...p} disabled={p.disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition active:translate-y-px disabled:opacity-50 disabled:pointer-events-none ${t} ${VARIANTES[variante]} ${className}`}>
      {cargando ? <span className="size-4 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Campo({ etiqueta, ayuda, error, children, className = "" }: { etiqueta: string; ayuda?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[12.5px] font-semibold text-ink-2 mb-1.5">{etiqueta}</span>
      {children}
      {ayuda ? <span className="block text-[12px] text-ink-3 mt-1">{ayuda}</span> : null}
      {error ? <span className="block text-[12px] text-rojo mt-1">{error}</span> : null}
    </label>
  );
}

const baseInput = "h-10 rounded-xl border border-foil-3 bg-papel px-3 text-[14.5px] text-ink placeholder:text-ink-3 focus:border-vino-2 focus:outline-none focus:ring-3 focus:ring-rosado/50 transition";
export function Entrada({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${baseInput} ${/(^|\s)w-/.test(className) ? "" : "w-full"} ${className}`} />;
}
export function Selector({ className = "", children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${baseInput} pr-8 ${/(^|\s)w-/.test(className) ? "" : "w-full"} ${className}`}>{children}</select>;
}

export function Insignia({ tono = "gris", children, className = "" }: { tono?: "gris" | "rojo" | "ambar" | "ok" | "amor" | "petroleo" | "azul"; children: ReactNode; className?: string }) {
  const t = { gris: "bg-foil-2 text-ink-2", rojo: "bg-rojo-claro text-rojo", ambar: "bg-ambar-claro text-[#8a5b00]", ok: "bg-ok-claro text-ok", amor: "bg-amor-claro text-amor-2", petroleo: "bg-petroleo text-white", azul: "bg-[#e3eff7] text-[#1f5f88]" }[tono];
  return <span className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

export function Sello({ lote, vence, sev }: { lote?: string | null; vence?: string | null; sev?: string }) {
  return (
    <span className="sello" data-sev={sev}>
      {lote ? <span>L {lote}</span> : null}
      {vence ? <span>V {vence}</span> : null}
    </span>
  );
}

export function Tarjeta({ children, className = "", titulo, accion }: { children: ReactNode; className?: string; titulo?: ReactNode; accion?: ReactNode }) {
  return (
    <section className={`tarjeta ${className}`}>
      {titulo ? (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="font-display font-semibold text-[15px]">{titulo}</h2>
          {accion}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Vacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto mb-4 h-10 w-24 rounded-full border-2 border-dashed border-foil-3" aria-hidden />
      <p className="font-display font-semibold text-[15px]">{titulo}</p>
      {children ? <p className="text-ink-2 text-sm mt-1.5 max-w-sm mx-auto">{children}</p> : null}
      {accion ? <div className="mt-4">{accion}</div> : null}
    </div>
  );
}

export function Modal({ abierto, alCerrar, titulo, children, ancho = "max-w-lg" }: { abierto: boolean; alCerrar: () => void; titulo: string; children: ReactNode; ancho?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} onClose={alCerrar} onCancel={(e) => { e.preventDefault(); alCerrar(); }}
      className={`w-[calc(100%-32px)] ${ancho} rounded-3xl p-0 backdrop:bg-petroleo/45 backdrop:backdrop-blur-[2px] shadow-2xl m-auto`}>
      {abierto ? (
        <div className="aparecer">
          <div className="flex items-center justify-between px-6 pt-5 pb-2">
            <h2 className="font-display font-semibold text-lg">{titulo}</h2>
            <button onClick={alCerrar} className="size-9 grid place-items-center rounded-full hover:bg-foil" aria-label="Cerrar"><X size={18} /></button>
          </div>
          <div className="px-6 pb-6">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

type Aviso = { id: number; tipo: "ok" | "error"; texto: string };
const AvisoCtx = createContext<(tipo: Aviso["tipo"], texto: string) => void>(() => {});
export function useAviso() { return useContext(AvisoCtx); }
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((tipo: Aviso["tipo"], texto: string) => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, tipo, texto }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "error" ? 6000 : 3500);
  }, []);
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[min(380px,calc(100%-40px))]" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aparecer flex gap-3 items-start rounded-2xl px-4 py-3 shadow-xl text-sm text-white ${a.tipo === "ok" ? "bg-petroleo" : "bg-rojo"}`}>
            {a.tipo === "ok" ? <CircleCheck size={18} className="shrink-0 mt-0.5 text-menta" /> : <TriangleAlert size={18} className="shrink-0 mt-0.5" />}
            <span>{a.texto}</span>
          </div>
        ))}
      </div>
    </AvisoCtx.Provider>
  );
}

export function Pestanas<T extends string>({ valor, opciones, alCambiar }: { valor: T; opciones: { valor: T; texto: string; extra?: ReactNode }[]; alCambiar: (v: T) => void }) {
  return (
    <div className="inline-flex p-1 rounded-2xl bg-foil-2/70 gap-1" role="tablist">
      {opciones.map((o) => (
        <button key={o.valor} role="tab" aria-selected={valor === o.valor} onClick={() => alCambiar(o.valor)}
          className={`h-9 px-4 rounded-xl text-sm font-semibold transition inline-flex items-center gap-2 ${valor === o.valor ? "bg-papel text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
          {o.texto}{o.extra}
        </button>
      ))}
    </div>
  );
}

export function Cargando({ alto = "h-40" }: { alto?: string }) {
  return <div className={`${alto} rounded-2xl bg-gradient-to-r from-foil-2/60 via-foil/60 to-foil-2/60 bg-[length:200%_100%] animate-pulse`} />;
}

export function Interruptor({ activo, alCambiar, etiqueta, deshabilitado }: { activo: boolean; alCambiar: () => void; etiqueta: string; deshabilitado?: boolean }) {
  return (
    <button role="switch" aria-checked={activo} aria-label={etiqueta} disabled={deshabilitado} onClick={alCambiar}
      className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 ${activo ? "bg-amor" : "bg-foil-3"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${activo ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function Encabezado({ titulo, bajada, children }: { titulo: string; bajada?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display font-semibold text-[26px] md:text-[30px] leading-tight">{titulo}</h1>
        {bajada ? <p className="text-ink-2 mt-1.5 text-[15px]">{bajada}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
