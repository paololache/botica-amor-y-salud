"use client";
import { useEffect, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { api, soles } from "@/lib/cliente";
import { Boton, Campo, Entrada, EntradaNumero, Modal, Selector } from "@/components/ui";

export type Pendiente = { clave: string; origen: string; referencia: string; medio: string; monto: number; fecha: string };
type Prod = { id: number; nombre: string; stockVigente: number; presentaciones: { id: number; nombre: string; factor: number; pvp: number; pvpCampana: number | null }[] };
type Linea = { presentacionId: number; nombre: string; precio: number; cantidad: number };
type Accion = "CONFIRMAR" | "CAMBIAR_MEDIO" | "ANULAR_VENTA" | "CONVERTIR_EN_VENTA";

const MEDIOS = ["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"] as const;
const NOMBRE: Record<string, string> = { EFECTIVO: "Efectivo", YAPE: "Yape", PLIN: "Plin", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * El administrador completa un pago virtual que el cajero no confirmó al cerrar:
 * llegó (con n.º de operación), se pagó con otro medio, no llegó (se anula la venta)
 * o, si era un ingreso, fue una venta: se cargan los productos y el vendedor.
 */
export function Regularizar({ sesionId, item, vendedores, cajeroId, alCerrar, alTerminar }: {
  sesionId: number; item: Pendiente | null; vendedores: { id: number; nombre: string }[]; cajeroId: number;
  alCerrar: () => void; alTerminar: (mensaje: string) => void;
}) {
  const esIngreso = item?.origen === "Ingreso";
  const [accion, setAccion] = useState<Accion>("CONFIRMAR");
  const [operacion, setOperacion] = useState("");
  const [comentario, setComentario] = useState("");
  const [medio, setMedio] = useState("EFECTIVO");
  const [vendedorId, setVendedorId] = useState(cajeroId);
  const [tipo, setTipo] = useState<"NOTA_VENTA" | "BOLETA">("NOTA_VENTA");
  const [buscar, setBuscar] = useState("");
  const [resultados, setResultados] = useState<Prod[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAccion("CONFIRMAR"); setOperacion(""); setComentario(""); setMedio(item.medio === "EFECTIVO" ? "YAPE" : "EFECTIVO");
    setVendedorId(cajeroId); setTipo("NOTA_VENTA"); setBuscar(""); setResultados([]); setLineas([]); setError(null);
  }, [item, cajeroId]);

  useEffect(() => {
    const t = buscar.trim();
    if (t.length < 2) { setResultados([]); return; }
    const h = setTimeout(() => { api<Prod[]>(`/api/productos?buscar=${encodeURIComponent(t)}&limite=8`).then(setResultados).catch(() => setResultados([])); }, 250);
    return () => clearTimeout(h);
  }, [buscar]);

  if (!item) return null;
  const total = r2(lineas.reduce((a, l) => a + l.precio * l.cantidad, 0));
  const ajuste = r2(total - item.monto);
  const agregar = (p: Prod, pr: Prod["presentaciones"][number]) => {
    setLineas((ls) => ls.some((l) => l.presentacionId === pr.id)
      ? ls.map((l) => (l.presentacionId === pr.id ? { ...l, cantidad: l.cantidad + 1 } : l))
      : [...ls, { presentacionId: pr.id, nombre: `${p.nombre} · ${pr.nombre}`, precio: Math.min(pr.pvpCampana ?? pr.pvp, pr.pvp), cantidad: 1 }]);
    setBuscar(""); setResultados([]);
  };
  const cantidad = (id: number, n: number) => setLineas((ls) => ls.flatMap((l) => (l.presentacionId !== id ? [l] : n > 0 ? [{ ...l, cantidad: n }] : [])));

  const listo =
    accion === "CONFIRMAR" ? operacion.trim().length >= 3
    : accion === "CAMBIAR_MEDIO" ? medio !== item.medio && comentario.trim().length >= 5
    : accion === "ANULAR_VENTA" ? comentario.trim().length >= 5
    : lineas.length > 0 && ajuste >= -0.005 && !!vendedorId;

  const guardar = async () => {
    setOcupado(true); setError(null);
    const base = { clave: item.clave, accion };
    const cuerpo =
      accion === "CONFIRMAR" ? { ...base, operacion, comentario: comentario || undefined }
      : accion === "CAMBIAR_MEDIO" ? { ...base, medio, operacion: operacion || undefined, comentario }
      : accion === "ANULAR_VENTA" ? { ...base, comentario }
      : { ...base, vendedorId, tipoComprobante: tipo, operacion: operacion || undefined, comentario: comentario || undefined,
          items: lineas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad, descuentoPct: 0, origen: "DIRECTA" })) };
    try {
      await api(`/api/caja/sesiones/${sesionId}/regularizar`, { cuerpo });
      alTerminar(accion === "CONFIRMAR" ? "Pago confirmado." : accion === "CAMBIAR_MEDIO" ? `Medio cambiado a ${NOMBRE[medio]}.` : accion === "ANULAR_VENTA" ? "Venta anulada; el stock volvió a su lote." : "Venta registrada: se descontó del inventario y suma al vendedor.");
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const opciones: { valor: Accion; texto: string; ayuda: string }[] = [
    { valor: "CONFIRMAR", texto: "Llegó completo", ayuda: "Lo verificaste en la app o el voucher" },
    ...(esIngreso ? [{ valor: "CONVERTIR_EN_VENTA" as const, texto: "Fue una venta", ayuda: "Registra los productos: se descuentan del stock y suman al vendedor" }] : []),
    { valor: "CAMBIAR_MEDIO", texto: "Se pagó con otro medio", ayuda: "Ej.: pagó en efectivo o por Plin y no por Yape" },
    ...(!esIngreso ? [{ valor: "ANULAR_VENTA" as const, texto: "No llegó: anular la venta", ayuda: "El stock vuelve a su lote y sale del reporte del vendedor" }] : []),
  ];

  return (
    <Modal abierto={!!item} alCerrar={alCerrar} titulo={esIngreso ? "Regularizar ingreso" : "Regularizar pago de venta"} ancho="max-w-2xl">
      <div className="rounded-2xl bg-foil px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold truncate">{item.referencia}{esIngreso ? " · ingreso" : ""}</p><p className="text-[13px] text-ink-2">{NOMBRE[item.medio] ?? item.medio} · {new Date(item.fecha).toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" })}</p></div>
        <p className="cifra text-[22px]">{soles(item.monto)}</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-2 mt-4" role="radiogroup" aria-label="Qué pasó con este pago">
        {opciones.map((o) => (
          <button key={o.valor} role="radio" aria-checked={accion === o.valor} onClick={() => { setAccion(o.valor); setError(null); }}
            className={`text-left rounded-xl border px-3 py-2.5 ${accion === o.valor ? "border-petroleo bg-petroleo/5" : "border-foil-3"}`}>
            <span className="block font-semibold text-[14px]">{o.texto}</span><span className="block text-[12px] text-ink-2 mt-0.5">{o.ayuda}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {accion === "CAMBIAR_MEDIO" ? (
          <Campo etiqueta="Medio con que realmente pagó"><Selector value={medio} onChange={(e) => setMedio(e.target.value)}>{MEDIOS.filter((m) => m !== item.medio).map((m) => <option key={m} value={m}>{NOMBRE[m]}</option>)}</Selector></Campo>
        ) : null}

        {accion === "CONVERTIR_EN_VENTA" ? (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Campo etiqueta="Vendedor"><Selector value={vendedorId} onChange={(e) => setVendedorId(Number(e.target.value))}>{vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}</Selector></Campo>
              <Campo etiqueta="Comprobante"><Selector value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}><option value="NOTA_VENTA">Nota de venta</option><option value="BOLETA">Boleta</option></Selector></Campo>
            </div>
            <div className="relative">
              <Campo etiqueta="Productos que se vendieron">
                <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" /><Entrada value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Busca por nombre o código" className="pl-9" /></div>
              </Campo>
              {resultados.length ? (
                <ul className="absolute z-10 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-foil-3 bg-papel shadow-lg">
                  {resultados.flatMap((p) => p.presentaciones.map((pr) => (
                    <li key={pr.id}><button onClick={() => agregar(p, pr)} disabled={p.stockVigente < pr.factor} className="w-full text-left px-3 py-2 hover:bg-foil disabled:opacity-50 flex justify-between gap-3">
                      <span className="min-w-0"><span className="block font-semibold text-[13.5px] truncate">{p.nombre}</span><span className="text-[12px] text-ink-2">{pr.nombre} · stock {p.stockVigente} und.</span></span>
                      <span className="tabular-nums font-semibold text-[13.5px]">{soles(Math.min(pr.pvpCampana ?? pr.pvp, pr.pvp))}</span>
                    </button></li>
                  )))}
                </ul>
              ) : null}
            </div>
            {lineas.length ? (
              <div className="rounded-xl border border-foil-2 divide-y divide-foil">
                {lineas.map((l) => (
                  <div key={l.presentacionId} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 min-w-0 text-[13.5px] truncate">{l.nombre}</span>
                    <button onClick={() => cantidad(l.presentacionId, l.cantidad - 1)} className="size-7 grid place-items-center rounded-lg border border-foil-3" aria-label="Quitar uno"><Minus size={13} /></button>
                    <EntradaNumero inputMode="numeric" value={l.cantidad} onChange={(e) => cantidad(l.presentacionId, Number(e.target.value) || 0)} className="w-14 h-8 text-center" aria-label={`Cantidad de ${l.nombre}`} />
                    <button onClick={() => cantidad(l.presentacionId, l.cantidad + 1)} className="size-7 grid place-items-center rounded-lg border border-foil-3" aria-label="Agregar uno"><Plus size={13} /></button>
                    <span className="w-20 text-right tabular-nums font-semibold text-[13.5px]">{soles(l.precio * l.cantidad)}</span>
                    <button onClick={() => cantidad(l.presentacionId, 0)} className="size-7 grid place-items-center rounded-lg text-ink-3 hover:text-rojo" aria-label={`Quitar ${l.nombre}`}><X size={14} /></button>
                  </div>
                ))}
                <div className="px-3 py-2 text-[13px] flex flex-wrap justify-between gap-2">
                  <span>Productos <b className="tabular-nums">{soles(total)}</b> · cobrado <b className="tabular-nums">{soles(item.monto)}</b></span>
                  {ajuste < -0.005 ? <span className="text-rojo font-semibold">Faltan productos por {soles(-ajuste)}</span>
                    : ajuste > 0.005 ? <span className="text-[#8a5b00] font-semibold">Se aplica un descuento de {soles(ajuste)} para cuadrar</span>
                    : <span className="text-ok font-semibold">Cuadra con lo cobrado</span>}
                </div>
              </div>
            ) : <p className="text-[12.5px] text-ink-3">Agrega lo que se entregó al cliente. La venta queda con la fecha del ingreso y en este cierre.</p>}
          </>
        ) : null}

        {accion !== "ANULAR_VENTA" ? (
          <Campo etiqueta={accion === "CONFIRMAR" ? "N.º de operación o voucher" : "N.º de operación (opcional)"}><Entrada value={operacion} onChange={(e) => setOperacion(e.target.value)} maxLength={40} placeholder="Ej.: 08451236" /></Campo>
        ) : null}
        <Campo etiqueta={accion === "CAMBIAR_MEDIO" || accion === "ANULAR_VENTA" ? "Qué pasó" : "Comentario (opcional)"}>
          <Entrada value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={250} placeholder={accion === "ANULAR_VENTA" ? "Ej.: el cliente no completó el Yape y no regresó" : "Ej.: verificado en el estado de cuenta"} />
        </Campo>
      </div>
      {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
      <div className="flex justify-end gap-2 mt-5">
        <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante={accion === "ANULAR_VENTA" ? "peligro" : "petroleo"} cargando={ocupado} disabled={!listo} onClick={guardar}>
          {accion === "CONFIRMAR" ? "Confirmar pago" : accion === "CAMBIAR_MEDIO" ? "Cambiar medio" : accion === "ANULAR_VENTA" ? "Anular venta" : "Registrar venta"}
        </Boton>
      </div>
    </Modal>
  );
}
