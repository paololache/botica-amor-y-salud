"use client";
import { useState } from "react";
import { Trash } from "lucide-react";
import { api, useDatos, soles, fechaCorta, hoyLima } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Pestanas, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { BuscadorProducto, type ProdBusqueda } from "@/components/buscador-producto";
import { useUsuario } from "@/components/shell";

type Compra = { id: number; proveedor: string; ruc: string; tipo: string; serie: string; numero: string; fechaEmision: string; estado: string; registradoPor: string; totalCosto?: number | null };
type Detalle = { compra: { id: number; serie: string; numero: string; estado: string }; items: { id: number; producto: string; presentacion: string; factor: number; cantidad: number; unidades: number; numeroLote: string; vencimiento: string; costoPresentacion?: number | null; costoAnterior?: number; pvp: number }[] };
type Linea = { prod: ProdBusqueda; presentacionId: number; cantidad: string; numeroLote: string; vencimiento: string };

export default function Compras() {
  const u = useUsuario();
  const [tab, setTab] = useState<"recibir" | "pendientes" | "historial">(u.rol === "ADMIN" ? "pendientes" : "recibir");
  const pendientes = useDatos<Compra[]>("/api/compras?estado=PENDIENTE_COSTO");
  return (
    <div>
      <Encabezado titulo="Compras" bajada="La compra entra al kardex en dos pasos: el inventariador registra lo que llegó y el administrador registra el costo." />
      <div className="mb-5">
        <Pestanas valor={tab} alCambiar={setTab} opciones={[
          { valor: "recibir", texto: "Recibir mercadería" },
          ...(u.rol === "ADMIN" ? [{ valor: "pendientes" as const, texto: "Pendientes de costo", extra: pendientes.datos?.length ? <Insignia tono="amor">{pendientes.datos.length}</Insignia> : undefined }] : []),
          { valor: "historial", texto: "Historial" },
        ]} />
      </div>
      {tab === "recibir" ? <Recibir alTerminar={() => { pendientes.recargar(); }} /> : tab === "pendientes" ? <Pendientes lista={pendientes.datos} recargar={pendientes.recargar} /> : <HistorialCompras />}
    </div>
  );
}

function Recibir({ alTerminar }: { alTerminar: () => void }) {
  const avisar = useAviso();
  const [cab, setCab] = useState({ ruc: "", razonSocial: "", tipoComprobante: "FACTURA", serie: "", numero: "", fechaEmision: hoyLima() });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviar = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await api<{ id: number; avisos: string[] }>("/api/compras", { cuerpo: {
        proveedor: { ruc: cab.ruc, razonSocial: cab.razonSocial }, tipoComprobante: cab.tipoComprobante, serie: cab.serie, numero: cab.numero, fechaEmision: cab.fechaEmision,
        items: lineas.map((l) => ({ presentacionId: l.presentacionId, cantidad: Number(l.cantidad), numeroLote: l.numeroLote, vencimiento: l.vencimiento })),
      } });
      avisar("ok", `Recepción registrada. Queda pendiente de costo para el administrador.${r.avisos.length ? " " + r.avisos.join(" ") : ""}`);
      setLineas([]); setCab({ ...cab, serie: "", numero: "" }); alTerminar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  const valido = cab.ruc.length === 11 && cab.razonSocial && cab.serie && cab.numero && lineas.length && lineas.every((l) => Number(l.cantidad) > 0 && l.numeroLote && l.vencimiento);
  return (
    <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
      <Tarjeta titulo="Comprobante del proveedor">
        <div className="px-5 pb-5 space-y-3">
          <Campo etiqueta="RUC"><Entrada inputMode="numeric" value={cab.ruc} onChange={(e) => setCab({ ...cab, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="20100000011" /></Campo>
          <Campo etiqueta="Razón social"><Entrada value={cab.razonSocial} onChange={(e) => setCab({ ...cab, razonSocial: e.target.value })} /></Campo>
          <Campo etiqueta="Tipo"><Selector value={cab.tipoComprobante} onChange={(e) => setCab({ ...cab, tipoComprobante: e.target.value })}><option value="FACTURA">Factura</option><option value="BOLETA">Boleta</option><option value="NOTA_COMPRA">Nota de compra</option></Selector></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Serie"><Entrada value={cab.serie} onChange={(e) => setCab({ ...cab, serie: e.target.value.toUpperCase() })} placeholder="F001" /></Campo>
            <Campo etiqueta="Número"><Entrada value={cab.numero} onChange={(e) => setCab({ ...cab, numero: e.target.value })} placeholder="14147" /></Campo>
          </div>
          <Campo etiqueta="Fecha de emisión"><Entrada type="date" value={cab.fechaEmision} onChange={(e) => setCab({ ...cab, fechaEmision: e.target.value })} /></Campo>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Lo que llegó" accion={<span className="text-[12.5px] text-ink-3">Sin costos: los registra el administrador</span>}>
        <div className="px-5 pb-3"><BuscadorProducto alElegir={(p) => setLineas((ls) => [...ls, { prod: p, presentacionId: p.presentaciones[p.presentaciones.length - 1].id, cantidad: "1", numeroLote: "", vencimiento: "" }])} placeholder="Agregar producto recibido" /></div>
        {lineas.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Producto</th><th>Presentación</th><th className="num">Cantidad</th><th>Lote</th><th>Vencimiento</th><th /></tr></thead>
            <tbody>{lineas.map((l, i) => {
              const set = (c: Partial<Linea>) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, ...c } : x)));
              return (
                <tr key={i}>
                  <td className="font-semibold">{l.prod.nombre}</td>
                  <td><select className="h-9 rounded-lg border border-foil-3 px-2 text-[13.5px] bg-papel" value={l.presentacionId} onChange={(e) => set({ presentacionId: Number(e.target.value) })}>{l.prod.presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></td>
                  <td className="num"><input className="w-20 h-9 rounded-lg border border-foil-3 text-right px-2" inputMode="numeric" value={l.cantidad} onChange={(e) => set({ cantidad: e.target.value.replace(/\D/g, "") })} aria-label="Cantidad" /></td>
                  <td><input className="w-28 h-9 rounded-lg border border-foil-3 px-2 uppercase" value={l.numeroLote} onChange={(e) => set({ numeroLote: e.target.value })} aria-label="Lote" /></td>
                  <td><input type="date" className="h-9 rounded-lg border border-foil-3 px-2" value={l.vencimiento} onChange={(e) => set({ vencimiento: e.target.value })} aria-label="Vencimiento" /></td>
                  <td><button className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-rojo" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}><Trash size={15} /></button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Vacio titulo="Agrega los productos de la factura">Busca cada producto y escribe la cantidad, el lote y el vencimiento impresos en la caja.</Vacio>}
        <div className="px-5 py-4 border-t border-foil flex items-center justify-between gap-3">
          {error ? <p className="text-sm text-rojo">{error}</p> : <span />}
          <Boton variante="amor" disabled={!valido} cargando={ocupado} onClick={enviar}>Registrar recepción</Boton>
        </div>
      </Tarjeta>
    </div>
  );
}

function Pendientes({ lista, recargar }: { lista: Compra[] | null; recargar: () => void }) {
  const avisar = useAviso();
  const [sel, setSel] = useState<number | null>(null);
  const det = useDatos<Detalle>(sel ? `/api/compras/${sel}` : null);
  const [costos, setCostos] = useState<Record<number, string>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pvp, setPvp] = useState<{ producto: string; pvpSugerido: number }[] | null>(null);
  if (!lista) return <Cargando />;
  if (!lista.length) return <Tarjeta><Vacio titulo="No hay compras pendientes de costo">Cuando el inventariador registre una recepción aparecerá aquí.</Vacio></Tarjeta>;
  const costear = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await api<{ total: number; pvpSugerido: { producto: string; pvpSugerido: number }[] }>(`/api/compras/${sel}/costear`, { cuerpo: { costos: det.datos!.items.map((i) => ({ detalleId: i.id, costoPresentacion: Number(costos[i.id]) || 0 })), confirmarVariacion: confirmar } });
      avisar("ok", `Compra ingresada al kardex por ${soles(r.total)}.`); setPvp(r.pvpSugerido); setSel(null); setCostos({}); setConfirmar(false); recargar();
    } catch (e) { setError((e as Error).message); if ((e as { codigo?: string }).codigo === "VARIACION_COSTO") setConfirmar(true); } finally { setOcupado(false); }
  };
  return (
    <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
      <Tarjeta titulo="Recepciones por costear">
        <ul className="px-3 pb-3 space-y-1.5">
          {lista.map((c) => (
            <li key={c.id}><button onClick={() => { setSel(c.id); setCostos({}); setError(null); setConfirmar(false); setPvp(null); }} className={`w-full text-left rounded-xl px-3 py-2.5 ${sel === c.id ? "bg-foil" : "hover:bg-foil/60"}`}>
              <div className="font-semibold text-[14px]">{c.proveedor}</div>
              <div className="text-[12.5px] text-ink-2">{c.serie}-{c.numero} · {fechaCorta(c.fechaEmision)} · recibió {c.registradoPor}</div>
            </button></li>
          ))}
        </ul>
      </Tarjeta>
      {pvp ? (
        <Tarjeta titulo="PVP sugerido con el nuevo costo promedio">
          <table className="tabla"><tbody>{pvp.map((x, i) => <tr key={i}><td>{x.producto}</td><td className="num font-semibold">{soles(x.pvpSugerido)}</td></tr>)}</tbody></table>
        </Tarjeta>
      ) : sel && det.datos ? (
        <Tarjeta titulo={`Costear ${det.datos.compra.serie}-${det.datos.compra.numero}`}>
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Producto</th><th>Lote</th><th className="num">Cantidad</th><th className="num">Costo anterior</th><th className="num">Costo por presentación</th></tr></thead>
            <tbody>{det.datos.items.map((i) => (
              <tr key={i.id}><td><b>{i.producto}</b><span className="block text-[12px] text-ink-3">{i.presentacion}</span></td><td><span className="sello">{i.numeroLote}</span></td><td className="num">{i.cantidad}</td><td className="num text-ink-2">{soles(i.costoAnterior)}</td>
                <td className="num"><input className="w-28 h-9 rounded-lg border border-foil-3 text-right px-2" inputMode="decimal" placeholder="0.00" value={costos[i.id] ?? ""} onChange={(e) => setCostos({ ...costos, [i.id]: e.target.value.replace(",", ".") })} aria-label={`Costo de ${i.producto}`} /></td></tr>
            ))}</tbody>
          </table></div>
          <div className="px-5 py-4 border-t border-foil flex flex-wrap items-center justify-between gap-3">
            {error ? <p className="text-sm text-rojo max-w-lg">{error}</p> : <span className="text-[13px] text-ink-2">Total: {soles(det.datos.items.reduce((s, i) => s + (Number(costos[i.id]) || 0) * i.cantidad, 0))}</span>}
            <Boton variante="amor" cargando={ocupado} onClick={costear}>{confirmar ? "Confirmar variación e ingresar" : "Ingresar al kardex"}</Boton>
          </div>
        </Tarjeta>
      ) : <Tarjeta><Vacio titulo="Elige una recepción">Registra el costo de cada producto según la factura del proveedor.</Vacio></Tarjeta>}
    </div>
  );
}

function HistorialCompras() {
  const { datos } = useDatos<Compra[]>("/api/compras");
  const u = useUsuario();
  return (
    <Tarjeta>
      {!datos ? <div className="p-5"><Cargando /></div> : (
        <div className="overflow-x-auto"><table className="tabla">
          <thead><tr><th>Comprobante</th><th>Proveedor</th><th>Emisión</th><th>Estado</th>{u.verCostos ? <th className="num">Total</th> : null}</tr></thead>
          <tbody>{datos.map((c) => <tr key={c.id}><td><span className="sello">{c.serie}-{c.numero}</span></td><td>{c.proveedor}</td><td>{fechaCorta(c.fechaEmision)}</td><td>{c.estado === "CONFIRMADA" ? <Insignia tono="ok">En kardex</Insignia> : <Insignia tono="ambar">Pendiente de costo</Insignia>}</td>{u.verCostos ? <td className="num">{soles(c.totalCosto)}</td> : null}</tr>)}</tbody>
        </table></div>
      )}
    </Tarjeta>
  );
}
