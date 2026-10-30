"use client";
import { useState } from "react";
import { Eye, FileText, Printer, RefreshCw } from "lucide-react";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, Entrada, Insignia, Modal, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type V = { id: number; serie: string; numero: number; fecha: string; tipo: string; total: number; costoTotal?: number; estado: string; cpeEstado: string; vendedor: string; cliente: string | null };

const TIPO: Record<string, string> = { BOLETA: "Boleta", FACTURA: "Factura", NOTA_VENTA: "Nota de venta" };
const ICONO = "size-8 grid place-items-center rounded-lg border border-foil-3 text-ink-2 hover:border-vino-2 hover:text-vino";

export default function Ventas() {
  const u = useUsuario();
  const avisar = useAviso();
  const [dias, setDias] = useState(1);
  const { datos, recargar } = useDatos<V[]>(`/api/ventas?dias=${dias}`);
  const [tipo, setTipo] = useState("");
  const [anular, setAnular] = useState<V | null>(null);
  const [motivo, setMotivo] = useState("");
  const lista = (datos ?? []).filter((v) => !tipo || v.tipo === tipo);
  const emitidas = lista.filter((v) => v.estado === "EMITIDA");
  const total = emitidas.reduce((s, v) => s + v.total, 0);
  const pendientes = (datos ?? []).filter((v) => v.cpeEstado === "PENDIENTE").length;
  return (
    <div>
      <Encabezado titulo="Ventas" bajada={`${emitidas.length} comprobantes · ${soles(total)}${u.rol === "ADMIN" || u.rol === "CONTADOR" ? "" : " · solo tus ventas"}`}>
        <Selector value={dias} onChange={(e) => setDias(Number(e.target.value))} className="w-40"><option value={1}>Hoy</option><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option></Selector>
        <Selector value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-56" aria-label="Tipo de comprobante"><option value="">Todos los comprobantes</option><option value="BOLETA">Boletas</option><option value="FACTURA">Facturas</option><option value="NOTA_VENTA">Notas de venta</option></Selector>
        {u.rol === "ADMIN" && pendientes ? <Boton variante="borde" onClick={async () => { const r = await api<{ aceptados: number }>("/api/ventas/reenviar", { metodo: "POST" }); avisar("ok", `${r.aceptados} CPE aceptados.`); recargar(); }}><RefreshCw size={15} /> Reenviar {pendientes} CPE</Boton> : null}
      </Encabezado>
      <Tarjeta>
        {!datos ? <div className="p-5"><Cargando /></div> : lista.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Comprobante</th><th>Fecha</th><th>Vendedor</th><th>Cliente</th><th>SUNAT</th><th className="num">Total</th>{u.verCostos ? <th className="num">Costo</th> : null}<th /></tr></thead>
            <tbody>{lista.map((v) => (
              <tr key={v.id} className={v.estado === "ANULADA" ? "opacity-55" : ""}>
                <td><span className="block text-[11.5px] text-ink-3">{TIPO[v.tipo] ?? v.tipo}</span><span className="sello">{v.serie}-{String(v.numero).padStart(6, "0")}</span>{v.estado === "ANULADA" ? <Insignia tono="rojo" className="ml-2">Anulada</Insignia> : null}</td>
                <td>{fechaHora(v.fecha)}</td><td>{v.vendedor}</td><td>{v.cliente ?? "Cliente varios"}</td>
                <td><Insignia tono={v.cpeEstado === "ACEPTADO" ? "ok" : v.cpeEstado === "NO_APLICA" ? "gris" : "ambar"}>{v.cpeEstado === "NO_APLICA" ? "No aplica" : v.cpeEstado[0] + v.cpeEstado.slice(1).toLowerCase()}</Insignia></td>
                <td className="num font-semibold">{soles(v.total)}</td>
                {u.verCostos ? <td className="num text-ink-2">{soles(v.costoTotal)}</td> : null}
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <a href={`/comprobante/${v.id}?formato=ticket`} target="_blank" rel="noopener" className={ICONO} title="Ver comprobante" aria-label={`Ver ${v.serie}-${v.numero}`}><Eye size={16} /></a>
                    <a href={`/comprobante/${v.id}?formato=ticket&imprimir=1`} target="_blank" rel="noopener" className={ICONO} title="Imprimir ticket 80 mm" aria-label={`Imprimir ticket de ${v.serie}-${v.numero}`}><Printer size={16} /></a>
                    <a href={`/comprobante/${v.id}?formato=a4&imprimir=1`} target="_blank" rel="noopener" className={ICONO} title="Imprimir en A4" aria-label={`Imprimir A4 de ${v.serie}-${v.numero}`}><FileText size={16} /></a>
                    {u.rol === "ADMIN" && v.estado === "EMITIDA" ? <Boton tam="sm" variante="fantasma" className="text-rojo" onClick={() => { setAnular(v); setMotivo(""); }}>Anular</Boton> : null}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Vacio titulo="Sin ventas en este periodo" />}
      </Tarjeta>
      <Modal abierto={!!anular} alCerrar={() => setAnular(null)} titulo="Anular venta">
        <p className="text-sm text-ink-2">El stock vuelve al lote original y la comisión se revierte. Si la venta no es de hoy, se emite nota de crédito.</p>
        <Entrada className="mt-4" autoFocus placeholder="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div className="flex justify-end gap-2 mt-5">
          <Boton variante="fantasma" onClick={() => setAnular(null)}>Cancelar</Boton>
          <Boton variante="peligro" disabled={motivo.trim().length < 5} onClick={async () => {
            try { const r = await api<{ modo: string }>(`/api/ventas/${anular!.id}/anular`, { cuerpo: { motivo } }); avisar("ok", r.modo === "ANULACION" ? "Venta anulada." : "Nota de crédito emitida."); setAnular(null); recargar(); }
            catch (e) { avisar("error", (e as Error).message); }
          }}>Anular {anular ? `${anular.serie}-${anular.numero}` : ""}</Boton>
        </div>
      </Modal>
    </div>
  );
}
