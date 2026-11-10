"use client";
import { useState } from "react";
import { useDatos, hoyLima, numero, soles } from "@/lib/cliente";
import { Campo, Cargando, Entrada, Selector, Tarjeta, Vacio } from "@/components/ui";

type Periodo = "dia" | "semana" | "mes" | "anio" | "rango";
type Barra = { clave: string; etiqueta: string; detalle: string; total: number; lineas: number; ventas: number };
type Historico = {
  periodo: Periodo; nivel: "mes" | "dia" | "hora"; desde: string; hasta: string; usuarioId: number | null; propias: boolean;
  vendedores: { id: number; nombre: string }[]; total: number; lineas: number; ventas: number; barras: Barra[];
};

const PERIODOS: [Periodo, string][] = [["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"], ["anio", "Año"], ["rango", "Rango"]];
const TURNOS = [["MAÑANA", "Mañana"], ["TARDE", "Tarde"], ["NOCHE", "Noche"], ["COMPLETO", "Completo"]];
const ALTO = 208;

function topeEje(max: number) {
  if (max <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 2.5, 5, 10].find((m) => m * base >= max) ?? 10) * base;
}
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/**
 * Comisiones en barras: por mes del año (vista inicial), por día de una semana, un mes o un rango, o por hora de un día.
 * Se filtra por turno; tocar la barra de un mes baja a sus días y la de un día baja a sus horas.
 * `usuarioId` fija a la persona (p. ej. «Mis comisiones» del administrador); sin él, quien gestiona elige el vendedor.
 */
export function HistoricoComisiones({ usuarioId, titulo = "Tus comisiones en el tiempo" }: { usuarioId?: number; titulo?: string }) {
  const hoy = hoyLima();
  const [periodo, setPeriodo] = useState<Periodo>("anio");
  const [fecha, setFecha] = useState(hoy);
  const [anio, setAnio] = useState(hoy.slice(0, 4));
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [turno, setTurno] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [activa, setActiva] = useState<number | null>(null);
  const q = new URLSearchParams({
    periodo,
    ...(periodo === "anio" ? { anio } : periodo === "rango" ? { desde, hasta } : { fecha }),
    ...(turno ? { turno } : {}),
    ...(usuarioId ? { usuarioId: String(usuarioId) } : vendedor ? { usuarioId: vendedor } : {}),
  });
  const rangoListo = periodo !== "rango" || (!!desde && !!hasta && desde <= hasta);
  const { datos, error, cargando } = useDatos<Historico>(rangoListo ? `/api/comisiones/historico?${q}` : null);
  const barras = datos?.barras ?? [];
  const tope = topeEje(Math.max(0, ...barras.map((b) => b.total)));
  const paso = barras.length > 16 ? 5 : barras.length > 12 ? 2 : 1;
  const b = activa !== null ? barras[activa] : null;
  const anios = Array.from({ length: 5 }, (_, i) => String(Number(hoy.slice(0, 4)) - i));
  const elegir = (p: Periodo) => { setPeriodo(p); setActiva(null); };
  const bajar = (x: Barra) => {
    setActiva(null);
    if (datos?.nivel === "mes") { setFecha(`${x.clave}-01`); setPeriodo("mes"); }
    else if (datos?.nivel === "dia") { setFecha(x.clave); setPeriodo("dia"); }
  };

  return (
    <Tarjeta titulo={titulo}>
      <div className="px-5 pb-5">
        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-foil w-fit mb-3" role="radiogroup" aria-label="Periodo">
          {PERIODOS.map(([v, t]) => (
            <button key={v} role="radio" aria-checked={periodo === v} onClick={() => elegir(v)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-semibold ${periodo === v ? "bg-papel shadow-sm" : "text-ink-2"}`}>{t}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {periodo === "anio" ? (
            <Campo etiqueta="Año"><Selector value={anio} onChange={(e) => { setAnio(e.target.value); setActiva(null); }}>{anios.map((a) => <option key={a}>{a}</option>)}</Selector></Campo>
          ) : periodo === "mes" ? (
            <Campo etiqueta="Mes"><Entrada type="month" value={fecha.slice(0, 7)} max={hoy.slice(0, 7)} onChange={(e) => e.target.value && setFecha(`${e.target.value}-01`)} /></Campo>
          ) : periodo === "rango" ? (
            <>
              <Campo etiqueta="Desde"><Entrada type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} /></Campo>
              <Campo etiqueta="Hasta"><Entrada type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></Campo>
            </>
          ) : (
            <Campo etiqueta={periodo === "semana" ? "Semana del día" : "Día"}><Entrada type="date" value={fecha} max={hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Campo>
          )}
          <Campo etiqueta="Turno"><Selector value={turno} onChange={(e) => { setTurno(e.target.value); setActiva(null); }}>
            <option value="">Todos</option>
            {TURNOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Selector></Campo>
          {!usuarioId && datos && !datos.propias ? (
            <Campo etiqueta="Vendedor"><Selector value={vendedor} onChange={(e) => { setVendedor(e.target.value); setActiva(null); }}>
              <option value="">Todos</option>
              {datos.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector></Campo>
          ) : null}
        </div>
        {!rangoListo ? <p className="text-sm text-rojo">La fecha final no puede ser anterior a la inicial.</p>
          : error ? <p className="text-sm text-rojo">{error}</p> : !datos ? <Cargando alto="h-64" /> : (
          <div className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="flex flex-wrap items-baseline gap-x-3 mb-1">
              <span className="cifra text-[30px] leading-none text-amor-2">{soles(datos.total)}</span>
              <span className="text-[13px] text-ink-2">{numero(datos.lineas)} {datos.lineas === 1 ? "producto en campaña" : "productos en campaña"} · {numero(datos.ventas)} {datos.ventas === 1 ? "venta" : "ventas"}</span>
            </div>
            <p className="text-[12.5px] text-ink-3 mb-4">{datos.desde === datos.hasta ? fechaCorta(datos.desde) : `Del ${fechaCorta(datos.desde)} al ${fechaCorta(datos.hasta)}`}{turno ? ` · turno ${turno.toLowerCase()}` : ""} · sin anuladas</p>
            {datos.total === 0 ? <Vacio titulo="Sin comisiones con estos filtros">Prueba con otro periodo o con todos los turnos.</Vacio> : (
              <>
                <div className="relative pl-12" onMouseLeave={() => setActiva(null)}>
                  <div className="relative" style={{ height: ALTO }}>
                    {[0, 0.5, 1].map((f) => (
                      <div key={f} className="absolute inset-x-0 border-t border-foil-2" aria-hidden style={{ bottom: `${f * 100}%` }}>
                        <span className="absolute right-full mr-2 -translate-y-1/2 text-[11.5px] text-ink-3 whitespace-nowrap">{soles(tope * f).replace(".00", "")}</span>
                      </div>
                    ))}
                    <div className="absolute inset-0 flex">
                      {barras.map((x, i) => (
                        <button key={x.clave} type="button" className={`relative flex-1 min-w-0 h-full ${datos.nivel === "hora" ? "cursor-default" : ""}`}
                          aria-label={`${x.detalle}: ${soles(x.total)} de comisión, ${x.ventas} ${x.ventas === 1 ? "venta" : "ventas"}`}
                          onMouseEnter={() => setActiva(i)} onFocus={() => setActiva(i)} onBlur={() => setActiva(null)} onClick={() => bajar(x)}>
                          <span className={`absolute bottom-0 left-px right-px mx-auto max-w-8 rounded-t transition-colors ${activa === i ? "bg-amor-2" : "bg-amor"}`}
                            style={{ height: x.total > 0 ? `max(2px, ${(x.total / tope) * 100}%)` : 0 }} />
                        </button>
                      ))}
                    </div>
                    {b && activa !== null ? (
                      <div role="status" className="absolute z-10 pointer-events-none rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-lg"
                        style={{ bottom: `calc(${(b.total / tope) * 100}% + 6px)`, ...(activa / barras.length > 0.6 ? { right: `${100 - ((activa + 1) / barras.length) * 100}%` } : { left: `${(activa / barras.length) * 100}%` }) }}>
                        <div className="font-semibold">{b.detalle}</div>
                        <div>{soles(b.total)} · {b.ventas} {b.ventas === 1 ? "venta" : "ventas"}</div>
                        {datos.nivel !== "hora" && b.total > 0 ? <div className="text-white/70">Toca para ver el detalle</div> : null}
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
                    <thead><tr><th>Periodo</th><th className="num">Comisión</th><th className="num">Productos en campaña</th><th className="num">N.º de ventas</th></tr></thead>
                    <tbody>{barras.filter((x) => x.total > 0).map((x) => <tr key={x.clave}><td>{x.detalle}</td><td className="num font-semibold">{soles(x.total)}</td><td className="num">{numero(x.lineas)}</td><td className="num">{numero(x.ventas)}</td></tr>)}</tbody>
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
