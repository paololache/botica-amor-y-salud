"use client";
import { useState } from "react";
import { Trash } from "lucide-react";
import { api, useDatos, soles, fechaHora, vence } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Pestanas, Sello, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { BuscadorProducto } from "@/components/buscador-producto";
import { useUsuario } from "@/components/shell";

type Motivo = { id: number; codigo: string; nombre: string; tipo: string; requiereAprobacion: boolean; rolAprobador: string; requiereEvidencia: boolean };
type Mov = { id: number; motivo: string; tipo: string; rolAprobador: string; descripcion: string; evidencia: string | null; estado: string; totalCosto?: number; fecha: string; registradoPor: string; comentario: string | null; puedoAprobar: boolean; items: { producto: string; lote: string; vencimiento: string; unidades: number }[] };
type Lote = { id: number; numero: string; vencimiento: string; cantidad: number; estado: string };
type Linea = { producto: string; lotes: Lote[]; loteId: number; unidades: string };

export default function Movimientos() {
  const u = useUsuario();
  const [tab, setTab] = useState<"nuevo" | "bandeja" | "historial">(u.rol === "INVENTARIADOR" ? "nuevo" : "bandeja");
  const pend = useDatos<Mov[]>("/api/movimientos?estado=PENDIENTE");
  const porAprobar = (pend.datos ?? []).filter((m) => m.puedoAprobar).length;
  return (
    <div>
      <Encabezado titulo="Salidas y entradas" bajada="Toda baja de stock sin venta lleva un motivo del catálogo; el stock solo se mueve al aprobar." />
      <div className="mb-5"><Pestanas valor={tab} alCambiar={setTab} opciones={[
        { valor: "nuevo", texto: "Registrar" },
        ...(u.rol === "ADMIN" || u.rol === "QF" ? [{ valor: "bandeja" as const, texto: "Por aprobar", extra: porAprobar ? <Insignia tono="amor">{porAprobar}</Insignia> : undefined }] : []),
        { valor: "historial", texto: "Historial" },
      ]} /></div>
      {tab === "nuevo" ? <Nuevo alTerminar={pend.recargar} /> : tab === "bandeja" ? <Lista estado="PENDIENTE" soloMias recargarPadre={pend.recargar} /> : <Lista />}
    </div>
  );
}

function Nuevo({ alTerminar }: { alTerminar: () => void }) {
  const avisar = useAviso();
  const motivos = useDatos<Motivo[]>("/api/motivos");
  const [motivoId, setMotivoId] = useState<number | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const m = motivos.datos?.find((x) => x.id === motivoId);
  const enviar = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await api<{ id: number; estado: string; requiereAprobacion: boolean; aprobador: string | null }>("/api/movimientos", { cuerpo: { motivoId, descripcion, evidencia: evidencia || undefined, items: lineas.map((l) => ({ loteId: l.loteId, unidades: Number(l.unidades) })) } });
      avisar("ok", r.requiereAprobacion ? `MOV-${String(r.id).padStart(5, "0")} enviado a aprobación (${r.aprobador === "QF" ? "químico farmacéutico" : "administrador"}).` : `MOV-${String(r.id).padStart(5, "0")} aplicado al kardex.`);
      setLineas([]); setDescripcion(""); setEvidencia(""); alTerminar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  return (
    <div className="grid xl:grid-cols-[380px_minmax(0,1fr)] gap-6 items-start">
      <Tarjeta titulo="Motivo">
        <div className="px-5 pb-5 space-y-3">
          {!motivos.datos ? <Cargando alto="h-40" /> : (
            <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
              {["SALIDA", "ENTRADA"].map((t) => (
                <div key={t}>
                  <p className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-wide mt-2 mb-1">{t === "SALIDA" ? "Salidas" : "Entradas"}</p>
                  {motivos.datos!.filter((x) => x.tipo === t).map((x) => (
                    <button key={x.id} onClick={() => setMotivoId(x.id)} className={`w-full text-left rounded-xl px-3 py-2 border ${motivoId === x.id ? "border-petroleo bg-[#f1f8f6]" : "border-transparent hover:bg-foil/60"}`}>
                      <span className="font-semibold text-[14px]">{x.nombre}</span>
                      <span className="block text-[12px] text-ink-3">{x.requiereAprobacion ? `Aprueba ${x.rolAprobador === "QF" ? "el QF" : "el administrador"}` : "Sin aprobación bajo S/ 50"}{x.requiereEvidencia ? " · exige evidencia" : ""}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <Campo etiqueta="Descripción" ayuda="Mínimo 10 caracteres"><Entrada value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué pasó y dónde" /></Campo>
          {m?.requiereEvidencia ? <Campo etiqueta="Evidencia" ayuda="Número de acta, denuncia o nombre del archivo"><Entrada value={evidencia} onChange={(e) => setEvidencia(e.target.value)} placeholder="Acta 014-2026" /></Campo> : null}
        </div>
      </Tarjeta>
      <Tarjeta titulo="Productos y lotes">
        <div className="px-5 pb-3"><BuscadorProducto placeholder="Agregar producto" alElegir={async (p) => {
          const f = await api<{ lotes: Lote[] }>(`/api/productos/${p.id}`);
          const lotes = f.lotes.filter((l) => l.cantidad > 0 || m?.tipo === "ENTRADA");
          if (!lotes.length) { avisar("error", "Este producto no tiene lotes con stock."); return; }
          setLineas((ls) => [...ls, { producto: p.nombre, lotes, loteId: lotes[0].id, unidades: "1" }]);
        }} /></div>
        {lineas.length ? (
          <table className="tabla"><thead><tr><th>Producto</th><th>Lote</th><th className="num">Unidades</th><th /></tr></thead>
            <tbody>{lineas.map((l, i) => {
              const lote = l.lotes.find((x) => x.id === l.loteId)!;
              return (
                <tr key={i}><td className="font-semibold">{l.producto}</td>
                  <td><select className="h-9 rounded-lg border border-foil-3 px-2 text-[13px] bg-papel" value={l.loteId} onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, loteId: Number(e.target.value) } : x)))}>{l.lotes.map((x) => <option key={x.id} value={x.id}>{x.numero} · vence {vence(x.vencimiento)} · {x.cantidad} und.</option>)}</select></td>
                  <td className="num"><input className="w-20 h-9 rounded-lg border border-foil-3 text-right px-2" inputMode="numeric" value={l.unidades} onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, unidades: e.target.value.replace(/\D/g, "") } : x)))} aria-label="Unidades" />
                    {m?.tipo === "SALIDA" && Number(l.unidades) > lote.cantidad ? <span className="block text-[11.5px] text-rojo">Máx. {lote.cantidad}</span> : null}</td>
                  <td><button className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-rojo" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}><Trash size={15} /></button></td></tr>
              );
            })}</tbody></table>
        ) : <Vacio titulo="Agrega los productos del movimiento">Elige el lote exacto: la baja se valoriza al costo de ese lote.</Vacio>}
        <div className="px-5 py-4 border-t border-foil flex items-center justify-between gap-3">
          {error ? <p className="text-sm text-rojo">{error}</p> : <span className="text-[13px] text-ink-2">{m ? `Motivo: ${m.nombre}` : "Elige un motivo"}</span>}
          <Boton variante="amor" cargando={ocupado} disabled={!m || descripcion.trim().length < 10 || !lineas.length} onClick={enviar}>{m?.requiereAprobacion ? "Enviar a aprobación" : "Registrar"}</Boton>
        </div>
      </Tarjeta>
    </div>
  );
}

function Lista({ estado, soloMias, recargarPadre }: { estado?: string; soloMias?: boolean; recargarPadre?: () => void }) {
  const avisar = useAviso();
  const u = useUsuario();
  const { datos, recargar } = useDatos<Mov[]>(`/api/movimientos${estado ? `?estado=${estado}` : ""}`);
  const [coment, setComent] = useState<Record<number, string>>({});
  const lista = (datos ?? []).filter((m) => !soloMias || m.puedoAprobar);
  const decidir = async (m: Mov, decision: "APROBAR" | "RECHAZAR") => {
    try { await api(`/api/movimientos/${m.id}/decidir`, { cuerpo: { decision, comentario: coment[m.id] } }); avisar("ok", decision === "APROBAR" ? "Aprobado: el stock ya se descontó." : "Rechazado: el stock no se movió."); recargar(); recargarPadre?.(); }
    catch (e) { avisar("error", (e as Error).message); }
  };
  if (!datos) return <Cargando />;
  if (!lista.length) return <Tarjeta><Vacio titulo={soloMias ? "No tienes movimientos por aprobar" : "Sin movimientos"} /></Tarjeta>;
  return (
    <div className="space-y-3">
      {lista.map((m) => (
        <Tarjeta key={m.id} className="p-5 aparecer">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className="sello">MOV-{String(m.id).padStart(5, "0")}</span><span className="font-semibold">{m.motivo}</span>
                <Insignia tono={m.estado === "APROBADA" ? "ok" : m.estado === "RECHAZADA" ? "rojo" : "ambar"}>{m.estado[0] + m.estado.slice(1).toLowerCase()}</Insignia></div>
              <p className="text-sm text-ink-2 mt-1.5">{m.descripcion}</p>
              <p className="text-[12.5px] text-ink-3 mt-1">{m.registradoPor} · {fechaHora(m.fecha)}{m.evidencia ? ` · evidencia: ${m.evidencia}` : ""}{m.comentario ? ` · «${m.comentario}»` : ""}</p>
            </div>
            {u.verCostos && m.totalCosto !== undefined ? <div className="text-right"><p className="text-[12px] text-ink-3">Valorizado</p><p className="font-semibold">{soles(m.totalCosto)}</p></div> : null}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">{m.items.map((it, i) => <span key={i} className="inline-flex items-center gap-2 rounded-xl bg-foil px-3 py-1.5 text-[13px]"><b>{it.producto}</b><Sello lote={it.lote} vence={vence(it.vencimiento)} /> {it.unidades} und.</span>)}</div>
          {m.puedoAprobar ? (
            <div className="flex flex-wrap gap-2 mt-4">
              <Entrada className="flex-1 min-w-[220px]" placeholder="Comentario (obligatorio para rechazar)" value={coment[m.id] ?? ""} onChange={(e) => setComent({ ...coment, [m.id]: e.target.value })} />
              <Boton variante="borde" onClick={() => decidir(m, "RECHAZAR")}>Rechazar</Boton>
              <Boton onClick={() => decidir(m, "APROBAR")}>Aprobar</Boton>
            </div>
          ) : null}
        </Tarjeta>
      ))}
    </div>
  );
}
