"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { useDatos, soles, numero, fechaHora, vence, hoyLima, sumarDias } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Sello, Selector, Tarjeta, Vacio } from "@/components/ui";
import { BuscadorProducto } from "@/components/buscador-producto";
import { useUsuario } from "@/components/shell";
import { descargarCsv } from "@/lib/csv";

type K = {
  producto: { id: number; codigo: string; nombre: string }; desde: string; hasta: string; lotes: { id: number; numero: string; vencimiento: string; cantidad: number }[];
  saldoInicial: { saldoUnidades: number; saldoValorizado?: number }; saldoFinal: { saldoUnidades: number; saldoValorizado?: number }; totales: { entradas: number; salidas: number };
  lineas: { id: number; fecha: string; tipo: string; motivo: string | null; documentoTipo: string; documentoRef: string | null; lote: string | null; vencimiento: string | null; entrada: number; salida: number; costoUnitario?: number; saldoUnidades: number; costoPromedio?: number; saldoValorizado?: number; usuario: string | null }[];
};
const TIPO: Record<string, string> = { VENTA: "Venta", ANULACION_VENTA: "Anulación", COMPRA: "Compra", SALIDA: "Salida", ENTRADA: "Entrada", INVENTARIO_INICIAL: "Inventario inicial" };

function Kardex() {
  const u = useUsuario();
  const sp = useSearchParams();
  const [productoId, setProductoId] = useState<number | null>(sp.get("productoId") ? Number(sp.get("productoId")) : null);
  const [desde, setDesde] = useState(sumarDias(hoyLima(), -30));
  const [hasta, setHasta] = useState(hoyLima());
  const [loteId, setLoteId] = useState("");
  const { datos, cargando, error } = useDatos<K>(productoId ? `/api/kardex?productoId=${productoId}&desde=${desde}&hasta=${hasta}${loteId ? `&loteId=${loteId}` : ""}` : null);
  const exportar = () => datos && descargarCsv(`kardex-${datos.producto.codigo}-${desde}-${hasta}.csv`,
    ["Fecha", "Tipo", "Motivo", "Documento", "Lote", "Vence", "Entrada", "Salida", ...(u.verCostos ? ["Costo unit.", "Saldo und.", "Costo prom.", "Saldo S/"] : ["Saldo und."]), "Usuario"],
    datos.lineas.map((l) => [fechaHora(l.fecha), TIPO[l.tipo] ?? l.tipo, l.motivo ?? "", l.documentoRef ?? l.documentoTipo, l.lote ?? "", l.vencimiento ?? "", l.entrada, l.salida, ...(u.verCostos ? [l.costoUnitario, l.saldoUnidades, l.costoPromedio, l.saldoValorizado] : [l.saldoUnidades]), l.usuario ?? ""]));
  return (
    <div>
      <Encabezado titulo="Kardex" bajada={u.verCostos ? "Movimientos por producto y lote con saldo en unidades y en soles. El kardex no se edita." : "Movimientos por producto y lote con saldo en unidades."}>
        {datos ? <Boton variante="borde" onClick={exportar}><Download size={16} /> Exportar a Excel</Boton> : null}
      </Encabezado>
      <Tarjeta className="p-5 mb-5">
        <div className="grid md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] gap-3 items-end">
          <Campo etiqueta={datos ? `Producto: ${datos.producto.nombre}` : "Producto"}><BuscadorProducto alElegir={(p) => { setProductoId(p.id); setLoteId(""); }} placeholder="Busca el producto" /></Campo>
          <Campo etiqueta="Desde"><Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
          <Campo etiqueta="Hasta"><Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
          <Campo etiqueta="Lote"><Selector value={loteId} onChange={(e) => setLoteId(e.target.value)}><option value="">Todos</option>{datos?.lotes.map((l) => <option key={l.id} value={l.id}>{l.numero} · {vence(l.vencimiento)}</option>)}</Selector></Campo>
        </div>
      </Tarjeta>
      {!productoId ? <Tarjeta><Vacio titulo="Elige un producto">Verás el saldo inicial, cada entrada y salida con su documento, y el saldo final.</Vacio></Tarjeta>
        : error ? <p className="text-rojo">{error}</p> : !datos || cargando ? <Cargando alto="h-80" /> : (
          <>
            <div className="grid sm:grid-cols-4 gap-3 mb-5">
              {[["Saldo inicial", numero(datos.saldoInicial.saldoUnidades), datos.saldoInicial.saldoValorizado], ["Entradas", numero(datos.totales.entradas)], ["Salidas", numero(datos.totales.salidas)], ["Saldo final", numero(datos.saldoFinal.saldoUnidades), datos.saldoFinal.saldoValorizado]].map(([t, v, s]) => (
                <div key={t as string} className="tarjeta p-4"><p className="text-[12.5px] font-semibold text-ink-2">{t}</p><p className="cifra text-[26px] mt-1">{v as string}</p>{u.verCostos && s !== undefined ? <p className="text-[12.5px] text-ink-3">{soles(s as number)}</p> : null}</div>
              ))}
            </div>
            <Tarjeta>
              {datos.lineas.length ? (
                <div className="overflow-x-auto max-h-[70vh]"><table className="tabla">
                  <thead><tr><th>Fecha</th><th>Movimiento</th><th>Documento</th><th>Lote</th><th className="num">Entrada</th><th className="num">Salida</th>{u.verCostos ? <th className="num">Costo unit.</th> : null}<th className="num">Saldo</th>{u.verCostos ? <th className="num">Saldo S/</th> : null}<th>Usuario</th></tr></thead>
                  <tbody>{datos.lineas.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{fechaHora(l.fecha)}</td>
                      <td><Insignia tono={l.entrada ? "ok" : l.tipo === "VENTA" ? "gris" : "ambar"}>{TIPO[l.tipo] ?? l.tipo}</Insignia>{l.motivo ? <span className="block text-[11.5px] text-ink-3 mt-0.5">{l.motivo}</span> : null}</td>
                      <td className="text-[13px]">{l.documentoRef || l.documentoTipo}</td>
                      <td>{l.lote ? <Sello lote={l.lote} vence={l.vencimiento ? vence(l.vencimiento) : undefined} /> : "—"}</td>
                      <td className="num text-ok font-semibold">{l.entrada || ""}</td><td className="num font-semibold">{l.salida || ""}</td>
                      {u.verCostos ? <td className="num text-ink-2">{soles(l.costoUnitario)}</td> : null}
                      <td className="num font-semibold">{numero(l.saldoUnidades)}</td>
                      {u.verCostos ? <td className="num">{soles(l.saldoValorizado)}</td> : null}
                      <td className="text-[13px] text-ink-2">{l.usuario}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <Vacio titulo="Sin movimientos en el periodo" />}
            </Tarjeta>
          </>
        )}
    </div>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Kardex /></Suspense>; }
