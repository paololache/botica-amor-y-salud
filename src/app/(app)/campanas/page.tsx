"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleCheck, Search } from "lucide-react";
import { api, useDatos, fechaCorta, hoyLima, sumarDias, vence } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Modal, Pestanas, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";

type Camp = { id: number; nombre: string; productoId: number; producto: string; codigo: string; lote: string | null; porcentaje: number; inicio: string; fin: string; estado: string; diasRestantes: number | null };
type Verif = { producto: { id: number; codigo: string; nombre: string }; enKardex: boolean; ultimoMovimiento: string | null; stock: number; lotes: { id: number; numero: string; vencimiento: string; cantidad: number }[] };
const TONO: Record<string, "ok" | "amor" | "gris" | "ambar" | "azul"> = { ACTIVA: "ok", PROGRAMADA: "azul", PAUSADA: "ambar", FINALIZADA: "gris" };

function Campanas() {
  const avisar = useAviso();
  const sp = useSearchParams();
  const lista = useDatos<Camp[]>("/api/campanas");
  const [codigo, setCodigo] = useState(sp.get("codigo") ?? "");
  const [verif, setVerif] = useState<Verif | null>(null);
  const [errVerif, setErrVerif] = useState<string | null>(null);
  const [f, setF] = useState({ loteId: "", nombre: "", porcentaje: "", inicio: hoyLima(), fin: sumarDias(hoyLima(), 30), observacion: "" });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState<"vigentes" | "todas">("vigentes");
  const [extender, setExtender] = useState<Camp | null>(null);
  const [nuevoFin, setNuevoFin] = useState("");

  const verificar = async (c = codigo) => {
    setErrVerif(null); setVerif(null);
    if (!c.trim()) return;
    try {
      const v = await api<Verif>(`/api/campanas/verificar?codigo=${encodeURIComponent(c.trim())}`);
      setVerif(v);
      if (!f.nombre) setF((x) => ({ ...x, nombre: `${v.producto.nombre.split(" ·")[0]} · promoción` }));
    } catch (e) { setErrVerif((e as Error).message); }
  };
  useEffect(() => { if (sp.get("codigo")) verificar(sp.get("codigo")!); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const guardar = async (activarAhora: boolean) => {
    setOcupado(true); setError(null);
    try {
      const c = await api<{ estado: string }>("/api/campanas", { cuerpo: { codigo: verif!.producto.codigo, loteId: f.loteId ? Number(f.loteId) : null, nombre: f.nombre, porcentaje: Number(f.porcentaje), inicio: f.inicio, fin: f.fin, observacion: f.observacion || undefined, activarAhora } });
      avisar("ok", c.estado === "ACTIVA" ? `Campaña activa: ${verif!.producto.nombre} comisiona ${f.porcentaje}%.` : `Campaña programada desde el ${fechaCorta(f.inicio)}.`);
      setVerif(null); setCodigo(""); setF({ loteId: "", nombre: "", porcentaje: "", inicio: hoyLima(), fin: sumarDias(hoyLima(), 30), observacion: "" }); lista.recargar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const cambiar = async (c: Camp, accion: "FINALIZAR" | "EXTENDER", fin?: string) => {
    try { await api(`/api/campanas/${c.id}`, { metodo: "PATCH", cuerpo: { accion, fin } }); avisar("ok", accion === "FINALIZAR" ? "Campaña finalizada." : `Campaña extendida hasta el ${fechaCorta(fin!)}.`); lista.recargar(); setExtender(null); }
    catch (e) { avisar("error", (e as Error).message); }
  };

  const camps = (lista.datos ?? []).filter((c) => filtro === "todas" || c.estado !== "FINALIZADA");
  const pct = Number(f.porcentaje);
  const valido = verif?.enKardex && verif.stock > 0 && f.nombre.trim().length >= 3 && pct > 0 && pct <= 100 && f.fin > f.inicio;

  return (
    <div>
      <Encabezado titulo="Campañas de promoción" bajada="Cada venta de un producto en campaña activa genera comisión para el vendedor: % de la campaña × precio cobrado sin IGV." />
      <div className="grid xl:grid-cols-[420px_minmax(0,1fr)] gap-6 items-start">
        <Tarjeta titulo="Nueva campaña">
          <div className="px-5 pb-5 space-y-3.5">
            <Campo etiqueta="Producto (código del kardex)">
              <div className="flex gap-2">
                <Entrada value={codigo} onChange={(e) => { setCodigo(e.target.value); setVerif(null); }} onKeyDown={(e) => e.key === "Enter" && verificar()} placeholder="Escanea o escribe el código" />
                <Boton variante="borde" onClick={() => verificar()} aria-label="Verificar código"><Search size={16} /></Boton>
              </div>
            </Campo>
            {errVerif ? <p className="text-sm text-rojo -mt-1">{errVerif}</p> : null}
            {verif ? (
              <div className={`rounded-2xl p-3.5 text-[13.5px] ${verif.enKardex && verif.stock > 0 ? "bg-ok-claro" : "bg-rojo-claro"}`}>
                <p className="font-semibold">{verif.producto.nombre}</p>
                {verif.enKardex && verif.stock > 0 ? (
                  <p className="text-ok flex items-center gap-1.5 mt-1"><CircleCheck size={15} /> Registrado en el kardex · stock {verif.stock} · último movimiento {fechaCorta(verif.ultimoMovimiento)}</p>
                ) : <p className="text-rojo mt-1">{verif.enKardex ? "No tiene stock: no puede entrar en campaña." : "No tiene movimientos en el kardex: regístralo primero con una compra o entrada."}</p>}
              </div>
            ) : null}
            <Campo etiqueta="Lote (opcional)" ayuda="Si eliges un lote, solo ese lote comisiona">
              <Selector value={f.loteId} disabled={!verif} onChange={(e) => setF({ ...f, loteId: e.target.value })}><option value="">Todos los lotes</option>{verif?.lotes.map((l) => <option key={l.id} value={l.id}>{l.numero} · vence {vence(l.vencimiento)} · {l.cantidad} und.</option>)}</Selector>
            </Campo>
            <Campo etiqueta="Nombre de la campaña"><Entrada value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={100} /></Campo>
            <Campo etiqueta="% de comisión" ayuda="Ingreso manual, sin valor por defecto">
              <div className="relative"><Entrada inputMode="decimal" value={f.porcentaje} onChange={(e) => setF({ ...f, porcentaje: e.target.value.replace(",", ".") })} placeholder="5.00" className="pr-8" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">%</span></div>
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Inicio estimado"><Entrada type="date" min={hoyLima()} value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></Campo>
              <Campo etiqueta="Fin estimado"><Entrada type="date" min={f.inicio} value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></Campo>
            </div>
            <Campo etiqueta="Observación (opcional)"><Entrada value={f.observacion} maxLength={250} onChange={(e) => setF({ ...f, observacion: e.target.value })} /></Campo>
            {error ? <p className="text-sm text-rojo">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <Boton variante="borde" className="flex-1" disabled={!valido} cargando={ocupado} onClick={() => guardar(false)}>Guardar</Boton>
              <Boton variante="amor" className="flex-1" disabled={!valido} cargando={ocupado} onClick={() => guardar(true)}>Guardar y activar ahora</Boton>
            </div>
            <p className="text-[12px] text-ink-3">También puedes activar o pausar una campaña con el interruptor de la lista de productos.</p>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Campañas" accion={<Pestanas valor={filtro} alCambiar={setFiltro} opciones={[{ valor: "vigentes", texto: "Vigentes" }, { valor: "todas", texto: "Todas" }]} />}>
          {!lista.datos ? <div className="p-5"><Cargando /></div> : camps.length ? (
            <div className="overflow-x-auto"><table className="tabla">
              <thead><tr><th>Campaña</th><th className="num">%</th><th>Vigencia</th><th>Estado</th><th /></tr></thead>
              <tbody>{camps.map((c) => (
                <tr key={c.id}>
                  <td><b className="text-[14px]">{c.nombre}</b><span className="block text-[12px] text-ink-3">{c.producto} · {c.codigo}{c.lote ? ` · lote ${c.lote}` : ""}</span></td>
                  <td className="num cifra text-[18px]">{c.porcentaje}</td>
                  <td className="text-[13px] whitespace-nowrap">{fechaCorta(c.inicio)} → {fechaCorta(c.fin)}{c.diasRestantes !== null && c.estado !== "PROGRAMADA" ? <span className={`block text-[12px] ${c.diasRestantes <= 3 ? "text-rojo" : "text-ink-3"}`}>{c.diasRestantes <= 0 ? "termina hoy" : `quedan ${c.diasRestantes} días`}</span> : null}</td>
                  <td><Insignia tono={TONO[c.estado]}>{c.estado[0] + c.estado.slice(1).toLowerCase()}</Insignia></td>
                  <td className="text-right whitespace-nowrap">{c.estado !== "FINALIZADA" ? <>
                    <Boton tam="sm" variante="fantasma" onClick={() => { setExtender(c); setNuevoFin(sumarDias(c.fin, 15)); }}>Extender</Boton>
                    <Boton tam="sm" variante="fantasma" onClick={() => cambiar(c, "FINALIZAR")}>Finalizar</Boton></> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Vacio titulo="Sin campañas vigentes">Crea la primera con el formulario.</Vacio>}
        </Tarjeta>
      </div>
      <Modal abierto={!!extender} alCerrar={() => setExtender(null)} titulo="Extender campaña">
        <p className="text-sm text-ink-2">{extender?.nombre} termina el {fechaCorta(extender?.fin)}.</p>
        <Campo etiqueta="Nueva fecha de fin" className="mt-4"><Entrada type="date" value={nuevoFin} min={extender?.fin} onChange={(e) => setNuevoFin(e.target.value)} /></Campo>
        <div className="flex justify-end gap-2 mt-5"><Boton variante="fantasma" onClick={() => setExtender(null)}>Cancelar</Boton><Boton onClick={() => extender && cambiar(extender, "EXTENDER", nuevoFin)}>Extender hasta el {fechaCorta(nuevoFin)}</Boton></div>
      </Modal>
    </div>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Campanas /></Suspense>; }
