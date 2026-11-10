"use client";
import { useState } from "react";
import { useDatos, numero, soles } from "@/lib/cliente";
import { Campo, Cargando, Selector, Tarjeta, Vacio } from "@/components/ui";

type Barra = { clave: string; etiqueta: string; detalle: string; total: number; tickets: number };
type Historico = { nivel: "mes" | "dia" | "hora"; propias: boolean; anios: number[]; total: number; tickets: number; barras: Barra[] };

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const TURNOS = [["MAÑANA", "Mañana"], ["TARDE", "Tarde"], ["NOCHE", "Noche"], ["COMPLETO", "Completo"]];
const ALTO = 208;

/** Tope redondo del eje: 1, 2, 2.5 o 5 por potencia de 10, para que las líneas de guía caigan en cifras limpias. */
function topeEje(max: number) {
  if (max <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 2.5, 5, 10].find((m) => m * base >= max) ?? 10) * base;
}
const compacto = (n: number) => (n >= 1000 ? `${Number((n / 1000).toFixed(1))} mil` : numero(n));

/** Barras del histórico de ventas: tocar una barra baja del año al mes y del mes al día. */
export function HistoricoVentas() {
  const ahora = new Date();
  const [anio, setAnio] = useState(String(ahora.getFullYear()));
  const [mes, setMes] = useState("");
  const [dia, setDia] = useState("");
  const [turno, setTurno] = useState("");
  const [activa, setActiva] = useState<number | null>(null);
  const q = new URLSearchParams({ anio, ...(mes ? { mes } : {}), ...(mes && dia ? { dia } : {}), ...(turno ? { turno } : {}) });
  const { datos, error, cargando } = useDatos<Historico>(`/api/panel/historico?${q}`);
  const diasDelMes = mes ? new Date(Number(anio), Number(mes), 0).getDate() : 0;
  const cambiarAnio = (a: string) => { setAnio(a); setDia(""); setActiva(null); };
  const cambiarMes = (m: string) => { setMes(m); setDia(""); setActiva(null); };
  const barras = datos?.barras ?? [];
  const tope = topeEje(Math.max(0, ...barras.map((b) => b.total)));
  const paso = barras.length > 16 ? 5 : barras.length > 12 ? 2 : 1;
  const b = activa !== null ? barras[activa] : null;
  const bajar = (x: Barra) => {
    setActiva(null);
    if (datos?.nivel === "mes") setMes(String(Number(x.clave)));
    else if (datos?.nivel === "dia") setDia(String(Number(x.clave)));
  };
  return (
    <Tarjeta titulo={datos?.propias === false ? "Histórico de ventas" : "Tu histórico de ventas"}>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Campo etiqueta="Año"><Selector value={anio} onChange={(e) => cambiarAnio(e.target.value)}>
            {(datos?.anios ?? [Number(anio)]).map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector></Campo>
          <Campo etiqueta="Mes"><Selector value={mes} onChange={(e) => cambiarMes(e.target.value)}>
            <option value="">Todos</option>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Selector></Campo>
          <Campo etiqueta="Día"><Selector value={dia} disabled={!mes} title={mes ? undefined : "Elige primero un mes"} onChange={(e) => { setDia(e.target.value); setActiva(null); }}>
            <option value="">Todos</option>
            {Array.from({ length: diasDelMes }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </Selector></Campo>
          <Campo etiqueta="Turno"><Selector value={turno} onChange={(e) => { setTurno(e.target.value); setActiva(null); }}>
            <option value="">Todos</option>
            {TURNOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Selector></Campo>
        </div>
        {error ? <p className="text-sm text-rojo">{error}</p> : !datos ? <Cargando alto="h-64" /> : (
          <div className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="flex flex-wrap items-baseline gap-x-3 mb-4">
              <span className="cifra text-[30px] leading-none">{soles(datos.total)}</span>
              <span className="text-[13px] text-ink-2">{numero(datos.tickets)} {datos.tickets === 1 ? "venta" : "ventas"} · con IGV, sin anuladas</span>
            </div>
            {datos.tickets === 0 ? <Vacio titulo="Sin ventas con estos filtros">Prueba con otro periodo o con todos los turnos.</Vacio> : (
              <>
                <div className="relative pl-12" onMouseLeave={() => setActiva(null)}>
                  <div className="relative" style={{ height: ALTO }}>
                    {[0, 0.5, 1].map((f) => (
                      <div key={f} className="absolute inset-x-0 border-t border-foil-2" style={{ bottom: `${f * 100}%` }} aria-hidden>
                        <span className="absolute right-full mr-2 -translate-y-1/2 text-[11.5px] text-ink-3 whitespace-nowrap">{compacto(tope * f)}</span>
                      </div>
                    ))}
                    <div className="absolute inset-0 flex">
                      {barras.map((x, i) => (
                        <button key={x.clave} type="button" className={`relative flex-1 min-w-0 h-full ${datos.nivel === "hora" ? "cursor-default" : ""}`}
                          aria-label={`${x.detalle}: ${soles(x.total)}, ${x.tickets} ${x.tickets === 1 ? "venta" : "ventas"}`}
                          onMouseEnter={() => setActiva(i)} onFocus={() => setActiva(i)} onBlur={() => setActiva(null)} onClick={() => bajar(x)}>
                          <span className={`absolute bottom-0 left-px right-px mx-auto max-w-7 rounded-t transition-colors ${activa === i ? "bg-petroleo" : "bg-petroleo-3"}`}
                            style={{ height: x.total > 0 ? `max(2px, ${(x.total / tope) * 100}%)` : 0 }} />
                        </button>
                      ))}
                    </div>
                    {b && activa !== null ? (
                      <div role="status" className="absolute z-10 pointer-events-none rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-lg"
                        style={{ bottom: `calc(${(b.total / tope) * 100}% + 6px)`, ...(activa / barras.length > 0.6 ? { right: `${100 - ((activa + 1) / barras.length) * 100}%` } : { left: `${(activa / barras.length) * 100}%` }) }}>
                        <div className="font-semibold">{b.detalle}</div>
                        <div>{soles(b.total)} · {b.tickets} {b.tickets === 1 ? "venta" : "ventas"}</div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex mt-1.5" aria-hidden>
                    {barras.map((x, i) => <span key={x.clave} className="flex-1 min-w-0 text-center text-[11.5px] text-ink-3 overflow-visible whitespace-nowrap">{i % paso === 0 ? x.etiqueta : ""}</span>)}
                  </div>
                </div>
                <details className="mt-4 text-[13px]">
                  <summary className="cursor-pointer font-semibold text-ink-2">Ver como tabla</summary>
                  <div className="overflow-x-auto mt-2 max-h-72 overflow-y-auto"><table className="tabla">
                    <thead><tr><th>Periodo</th><th className="num">Monto</th><th className="num">N.º de ventas</th></tr></thead>
                    <tbody>{barras.filter((x) => x.tickets > 0).map((x) => <tr key={x.clave}><td>{x.detalle}</td><td className="num">{soles(x.total)}</td><td className="num">{numero(x.tickets)}</td></tr>)}</tbody>
                  </table></div>
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
