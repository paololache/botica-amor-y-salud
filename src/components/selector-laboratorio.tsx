"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/cliente";
import { claveLaboratorio } from "@/lib/util";
import { Entrada } from "@/components/ui";

export type Laboratorio = { id: number; nombre: string };
type Respuesta = { laboratorio: Laboratorio | null; existente: boolean; parecidos: Laboratorio[] };

/** El laboratorio siempre se elige del catálogo; lo que no existe se da de alta aquí mismo, pasando por la validación de duplicados. */
/** Orden de las coincidencias: igual, empieza igual, contiene; a igualdad, el nombre más corto. */
function ordenar(laboratorios: Laboratorio[], clave: string) {
  const rango = (l: Laboratorio) => { const k = claveLaboratorio(l.nombre); return k === clave ? 0 : k.startsWith(clave) ? 1 : 2; };
  return laboratorios.filter((l) => !clave || claveLaboratorio(l.nombre).includes(clave))
    .sort((a, b) => (clave ? rango(a) - rango(b) || a.nombre.length - b.nombre.length : 0) || a.nombre.localeCompare(b.nombre));
}

/**
 * autoElegir: al salir del campo con un texto a medias («ac farm»), se elige solo el laboratorio que mejor coincide
 * («AC FARMA»). Si no hay ninguno, queda a la vista el aviso para agregarlo como nuevo.
 */
export function SelectorLaboratorio({ etiqueta = "Laboratorio", laboratorios, valor, alElegir, autoElegir = false }: { etiqueta?: string; laboratorios: Laboratorio[]; valor: Laboratorio | null; alElegir: (l: Laboratorio | null) => void; autoElegir?: boolean }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [parecidos, setParecidos] = useState<Laboratorio[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clave = claveLaboratorio(q);
  const coincidencias = ordenar(laboratorios, clave);
  const exacto = laboratorios.some((l) => claveLaboratorio(l.nombre) === clave);
  const puedeCrear = clave.length >= 2 && !exacto;

  const elegir = (l: Laboratorio) => { setQ(""); setParecidos(null); setAbierto(false); setError(null); alElegir(l); };
  const crear = async (confirmarParecido: boolean) => {
    setOcupado(true); setError(null);
    try {
      const r = await api<Respuesta>("/api/laboratorios", { cuerpo: { nombre: q, confirmarParecido } });
      if (r.laboratorio) elegir(r.laboratorio);
      else setParecidos(r.parecidos);
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const titulo = <span className="block text-[12.5px] font-semibold text-ink-2 mb-1.5">{etiqueta}</span>;
  if (valor) return (
    <div>
      {titulo}
      <div className="flex justify-between items-center gap-2 h-10 rounded-xl bg-foil px-3 text-sm"><b className="truncate">{valor.nombre}</b><button type="button" className="text-ink-3 shrink-0" onClick={() => alElegir(null)}>Cambiar</button></div>
    </div>
  );

  const opcion = "w-full text-left px-3 py-2 text-sm hover:bg-foil/70";
  return (
    <div>
      {titulo}
      <Entrada value={q} autoComplete="off" aria-label={etiqueta} placeholder="Busca o agrega un laboratorio" onFocus={() => setAbierto(true)}
        onBlur={() => { setAbierto(false); if (autoElegir && clave && coincidencias.length && !parecidos) elegir(coincidencias[0]); }}
        onChange={(e) => { setQ(e.target.value); setParecidos(null); setError(null); setAbierto(true); }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (coincidencias.length && clave) elegir(coincidencias[0]);
          else if (puedeCrear && !parecidos) crear(false);
        }} />
      {parecidos ? (
        <div className="mt-1.5 rounded-xl border border-foil-3 overflow-hidden" onMouseDown={(e) => e.preventDefault()}>
          <p className="px-3 py-2 text-[12.5px] font-semibold text-ink-2 bg-foil/60">¿Quisiste decir alguno de estos?</p>
          {parecidos.map((l) => <button key={l.id} type="button" className={`${opcion} font-semibold`} onClick={() => elegir(l)}>{l.nombre}</button>)}
          <button type="button" disabled={ocupado} className={`${opcion} text-vino-2 border-t border-foil-2`} onClick={() => crear(true)}>No, «{q.trim()}» es otro laboratorio: agregarlo</button>
        </div>
      ) : abierto ? (
        <ul className="mt-1.5 rounded-xl border border-foil-3 max-h-44 overflow-y-auto" onMouseDown={(e) => e.preventDefault()}>
          {coincidencias.map((l) => <li key={l.id}><button type="button" className={opcion} onClick={() => elegir(l)}>{l.nombre}</button></li>)}
          {puedeCrear ? <li><button type="button" disabled={ocupado} className={`${opcion} font-semibold text-vino-2 flex items-center gap-1.5`} onClick={() => crear(false)}><Plus size={15} /> Agregar «{q.trim()}»</button></li> : null}
          {!coincidencias.length && !puedeCrear ? <li className="px-3 py-2 text-sm text-ink-3">Escribe el nombre del laboratorio</li> : null}
        </ul>
      ) : autoElegir && puedeCrear && !coincidencias.length ? (
        <div className="mt-1.5 rounded-xl border border-ambar/60 bg-ambar-claro/50 px-3 py-2 text-[12.5px]" role="status">
          «{q.trim()}» no está en el catálogo.{" "}
          <button type="button" disabled={ocupado} className="font-semibold text-vino-2" onClick={() => crear(false)}>Agregarlo como laboratorio nuevo</button>
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-rojo mt-1" role="alert">{error}</p> : null}
    </div>
  );
}
