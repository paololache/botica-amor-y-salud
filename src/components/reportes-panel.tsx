"use client";
import { useEffect, useRef, useState } from "react";
import { useDatos, numero, soles } from "@/lib/cliente";
import { Cargando, Selector, Tarjeta, Vacio } from "@/components/ui";

type Mes = { mes: string; vendido: number; meta: number | null; porcentaje: number | null; estado: string };
type Anual = {
  anio: number; mes: number; propias: boolean; meses: Mes[]; total: number; anios: number[];
  porVendedor: { usuarioId: number; nombre: string; total: number }[]; seleccionado: Mes | null;
};
type MasVendidos = { periodo: string; desde: string; propias: boolean; productos: { id: number; codigo: string; nombre: string; stockInicial: number; vendida: number; saldo: number }[] };

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Paleta categórica validada (orden fijo); el resto de vendedores se agrupa en «Otros».
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
const LINEA = "#1d6b62";

function topeEje(max: number) {
  if (max <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 2.5, 5, 10].find((m) => m * base >= max) ?? 10) * base;
}
const compacto = (n: number) => (n >= 1000 ? `${Number((n / 1000).toFixed(1))} mil` : numero(Math.round(n)));

function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho] as const;
}

/** Línea de ventas por mes con la cuota punteada; tocar un mes lo elige para el reparto o el avance de cuota. */
function LineaMensual({ meses, mes, alElegir, etiquetaCuota }: { meses: Mes[]; mes: number; alElegir: (m: number) => void; etiquetaCuota: string }) {
  const [ref, W] = useAncho<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 230, izq = 46, der = 14, arriba = 26, abajo = 26;
  const conDatos = meses.filter((m) => m.estado !== "PENDIENTE");
  const tope = topeEje(Math.max(0, ...meses.map((m) => Math.max(m.vendido, m.meta ?? 0))));
  const paso = (W - izq - der) / 12;
  const x = (i: number) => izq + paso * (i + 0.5);
  const y = (v: number) => arriba + (1 - v / tope) * (H - arriba - abajo);
  const linea = conDatos.map((m) => `${x(Number(m.mes.slice(5)) - 1)},${y(m.vendido)}`).join(" ");
  const cuotas = meses.map((m, i) => (m.meta ? { i, v: m.meta } : null)).filter((c): c is { i: number; v: number } => !!c);
  const h = hover !== null ? meses[hover] : null;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} role="img" aria-label="Ventas por mes del año" className="block overflow-visible">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={izq} x2={W - der} y1={y(tope * f)} y2={y(tope * f)} stroke="var(--color-foil-2)" />
            <text x={izq - 8} y={y(tope * f)} dy="0.35em" textAnchor="end" fontSize="11" fill="var(--color-ink-3)">{compacto(tope * f)}</text>
          </g>
        ))}
        <rect x={x(mes - 1) - paso / 2} y={arriba - 6} width={paso} height={H - arriba - abajo + 6} fill="var(--color-foil)" rx="6" />
        {cuotas.length ? <polyline points={cuotas.map((c) => `${x(c.i)},${y(c.v)}`).join(" ")} fill="none" stroke="var(--color-ink-3)" strokeWidth="1.5" strokeDasharray="5 4" /> : null}
        {conDatos.length > 1 ? <polyline points={linea} fill="none" stroke={LINEA} strokeWidth="2" strokeLinejoin="round" /> : null}
        {conDatos.map((m, k) => {
          const i = Number(m.mes.slice(5)) - 1;
          // La etiqueta va debajo cuando la línea baja hacia el punto, para no cruzarla.
          const abajoDelPunto = k > 0 && conDatos[k - 1].vendido > m.vendido && y(m.vendido) + 20 < H - abajo;
          return (
            <g key={m.mes}>
              <circle cx={x(i)} cy={y(m.vendido)} r={hover === i || mes === i + 1 ? 5.5 : 4} fill={LINEA} stroke="var(--color-papel)" strokeWidth="2" />
              {m.vendido > 0 ? <text x={x(i)} y={abajoDelPunto ? y(m.vendido) + 18 : y(m.vendido) - 10} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--color-ink-2)"
                stroke="var(--color-papel)" strokeWidth="3" paintOrder="stroke">{compacto(m.vendido)}</text> : null}
            </g>
          );
        })}
        {MESES.map((t, i) => <text key={t} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={mes === i + 1 ? "var(--color-ink)" : "var(--color-ink-3)"} fontWeight={mes === i + 1 ? 600 : 400}>{t}</text>)}
        {MESES.map((t, i) => (
          <rect key={`h${t}`} x={x(i) - paso / 2} y={0} width={paso} height={H} fill="transparent" className="cursor-pointer"
            onMouseEnter={() => setHover(i)} onClick={() => alElegir(i + 1)}>
            <title>{`${MESES_LARGO[i]}: ${soles(meses[i]?.vendido ?? 0)}`}</title>
          </rect>
        ))}
      </svg>
      {h && hover !== null ? (
        <div role="status" className="absolute z-10 pointer-events-none rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-lg"
          style={{ top: Math.max(0, y(Math.max(h.vendido, h.meta ?? 0)) - 64), ...(hover > 7 ? { right: W - x(hover) + 8 } : { left: x(hover) + 8 }) }}>
          <div className="font-semibold capitalize">{MESES_LARGO[hover]}</div>
          <div>Ventas {soles(h.vendido)}</div>
          {h.meta ? <div>{etiquetaCuota} {soles(h.meta)} · {Math.round(h.porcentaje ?? 0)}%</div> : <div className="text-white/70">Sin cuota</div>}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: LINEA }} /> Ventas</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-3" /> {etiquetaCuota}</span>
        <span className="text-ink-3">Toca un mes para ver su detalle</span>
      </div>
    </div>
  );
}

/** Reparto de las ventas del mes entre vendedores (dona con leyenda: nombre, monto y porcentaje). */
function DonaVendedores({ datos, titulo }: { datos: { nombre: string; total: number }[]; titulo: string }) {
  const total = datos.reduce((a, d) => a + d.total, 0);
  const lista = datos.length > SERIES.length ? [...datos.slice(0, SERIES.length - 1), { nombre: "Otros", total: datos.slice(SERIES.length - 1).reduce((a, d) => a + d.total, 0) }] : datos;
  const R = 62, C = 2 * Math.PI * R, GROSOR = 22;
  let acum = 0;
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-2 mb-2">{titulo}</p>
      {total <= 0 ? <p className="text-sm text-ink-3 py-6">Sin ventas en este mes.</p> : (
        <div className="flex flex-wrap items-center gap-5">
          <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label={titulo}>
            <circle cx="85" cy="85" r={R} fill="none" stroke="var(--color-foil)" strokeWidth={GROSOR} />
            {lista.map((d, i) => {
              const largo = (d.total / total) * C;
              const seg = <circle key={d.nombre} cx="85" cy="85" r={R} fill="none" stroke={d.nombre === "Otros" ? "#9aa5a2" : SERIES[i]} strokeWidth={GROSOR}
                strokeDasharray={`${Math.max(0, largo - (lista.length > 1 ? 2 : 0))} ${C}`} strokeDashoffset={-acum} transform="rotate(-90 85 85)"><title>{`${d.nombre}: ${soles(d.total)}`}</title></circle>;
              acum += largo;
              return seg;
            })}
            <text x="85" y="80" textAnchor="middle" fontSize="11" fill="var(--color-ink-3)">Total</text>
            <text x="85" y="98" textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--color-ink)">{compacto(total)}</text>
          </svg>
          <ul className="flex-1 min-w-[180px] space-y-1.5 text-[13px]">
            {lista.map((d, i) => (
              <li key={d.nombre} className="flex items-center gap-2">
                <span className="size-3 rounded-sm shrink-0" style={{ background: d.nombre === "Otros" ? "#9aa5a2" : SERIES[i] }} />
                <span className="flex-1 min-w-0 truncate">{d.nombre}</span>
                <span className="tabular-nums font-semibold">{soles(d.total)}</span>
                <span className="tabular-nums text-ink-3 w-11 text-right">{Math.round((d.total / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Avance de la cuota del mes elegido (anillo). */
function AnilloCuota({ m, titulo }: { m: Mes | null; titulo: string }) {
  const R = 62, C = 2 * Math.PI * R;
  const pct = m?.meta ? Math.min(1, m.vendido / m.meta) : 0;
  const cumplida = !!m?.meta && m.vendido >= m.meta;
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-2 mb-2">{titulo}</p>
      {!m || !m.meta ? <p className="text-sm text-ink-3 py-6">{m && m.vendido > 0 ? `Vendiste ${soles(m.vendido)}. ` : ""}No hay cuota fijada para este mes.</p> : (
        <div className="flex flex-wrap items-center gap-5">
          <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label={`${titulo}: ${Math.round((m.vendido / m.meta) * 100)}%`}>
            <circle cx="85" cy="85" r={R} fill="none" stroke="var(--color-foil-2)" strokeWidth="18" />
            <circle cx="85" cy="85" r={R} fill="none" stroke={cumplida ? "var(--color-ok)" : LINEA} strokeWidth="18" strokeLinecap="round"
              strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90 85 85)" />
            <text x="85" y="84" textAnchor="middle" fontSize="24" fontWeight="650" fill="var(--color-ink)">{Math.round((m.vendido / m.meta) * 100)}%</text>
            <text x="85" y="104" textAnchor="middle" fontSize="11" fill="var(--color-ink-3)">{cumplida ? "cuota cumplida" : "de la cuota"}</text>
          </svg>
          <dl className="flex-1 min-w-[160px] grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
            <dt className="text-ink-2">Vendido</dt><dd className="text-right font-semibold tabular-nums">{soles(m.vendido)}</dd>
            <dt className="text-ink-2">Cuota</dt><dd className="text-right tabular-nums">{soles(m.meta)}</dd>
            <dt className="text-ink-2">{cumplida ? "Superaste por" : "Te falta"}</dt><dd className={`text-right font-semibold tabular-nums ${cumplida ? "text-ok" : "text-rojo"}`}>{soles(Math.abs(m.meta - m.vendido))}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

/** Reportes mensuales del panel: ventas por mes con la cuota y, debajo, reparto por vendedor o avance de la cuota propia. */
export function VentasMensuales() {
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState<number | null>(null);
  const q = new URLSearchParams({ ...(anio ? { anio } : {}), ...(mes ? { mes: String(mes) } : {}) });
  const { datos, error, cargando } = useDatos<Anual>(`/api/panel/anual?${q}`);
  const titulo = datos?.propias ? "Tus ventas por mes" : "Ventas de la botica por mes";
  return (
    <Tarjeta titulo={titulo} accion={datos ? (
      <Selector value={String(datos.anio)} onChange={(e) => { setAnio(e.target.value); setMes(null); }} className="w-28" aria-label="Año">
        {datos.anios.map((a) => <option key={a}>{a}</option>)}
      </Selector>
    ) : null}>
      <div className="px-5 pb-5">
        {error ? <p className="text-sm text-rojo">{error}</p> : !datos ? <Cargando alto="h-72" /> : (
          <div className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="flex flex-wrap items-baseline gap-x-3 mb-2">
              <span className="cifra text-[26px] leading-none">{soles(datos.total)}</span>
              <span className="text-[13px] text-ink-2">acumulado {datos.anio} · {datos.propias ? "tus ventas de mostrador" : "todas las cajas y vendedores"} · con IGV, sin anuladas ni delivery</span>
            </div>
            {datos.total === 0 && !datos.meses.some((m) => m.meta) ? <Vacio titulo={`Sin ventas en ${datos.anio}`}>Elige otro año.</Vacio> : (
              <>
                <LineaMensual meses={datos.meses} mes={datos.mes} alElegir={setMes} etiquetaCuota={datos.propias ? "Tu cuota" : "Cuota de la botica"} />
                <div className="mt-5 pt-4 border-t border-foil">
                  {datos.propias
                    ? <AnilloCuota m={datos.seleccionado} titulo={`Avance de tu cuota · ${MESES_LARGO[datos.mes - 1]} ${datos.anio}`} />
                    : <DonaVendedores datos={datos.porVendedor} titulo={`Ventas por vendedor · ${MESES_LARGO[datos.mes - 1]} ${datos.anio}`} />}
                </div>
                <details className="mt-4 text-[13px]">
                  <summary className="cursor-pointer font-semibold text-ink-2">Ver como tabla</summary>
                  <div className="overflow-x-auto mt-2"><table className="tabla">
                    <thead><tr><th>Mes</th><th className="num">Ventas</th><th className="num">Cuota</th><th className="num">Avance</th></tr></thead>
                    <tbody>{datos.meses.filter((m) => m.estado !== "PENDIENTE").map((m, i) => (
                      <tr key={m.mes}><td className="capitalize">{MESES_LARGO[Number(m.mes.slice(5)) - 1] ?? i}</td><td className="num font-semibold">{soles(m.vendido)}</td><td className="num">{m.meta ? soles(m.meta) : "—"}</td><td className="num">{m.porcentaje !== null && m.meta ? `${m.porcentaje.toFixed(1)}%` : "—"}</td></tr>
                    ))}</tbody>
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

const PERIODOS = [["dia", "Hoy"], ["semana", "Semana"], ["mes", "Mes"], ["anio", "Año"]] as const;

/** Productos más vendidos del periodo: stock al inicio, cantidad vendida y saldo de stock. */
export function ProductosMasVendidos() {
  const [periodo, setPeriodo] = useState("mes");
  const { datos, error, cargando } = useDatos<MasVendidos>(`/api/panel/mas-vendidos?periodo=${periodo}`);
  return (
    <Tarjeta titulo={datos?.propias ? "Tus productos más vendidos" : "Productos más vendidos"} accion={
      <Selector value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-32" aria-label="Periodo">
        {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </Selector>
    }>
      {error ? <p className="px-5 pb-5 text-sm text-rojo">{error}</p> : !datos ? <div className="p-5"><Cargando /></div> : datos.productos.length ? (
        <div className={`overflow-x-auto ${cargando ? "opacity-60" : ""}`}><table className="tabla">
          <thead><tr>
            <th>Nombre del producto</th>
            <th className="num" title="Unidades al inicio del periodo">Stock inicial</th>
            <th className="num">Cantidad vendida</th>
            <th className="num" title="Unidades que quedan hoy">Saldo de stock</th>
          </tr></thead>
          <tbody>{datos.productos.map((p) => (
            <tr key={p.id}>
              <td><span className="font-semibold">{p.nombre}</span><span className="block text-[12px] text-ink-3">{p.codigo}</span></td>
              <td className="num tabular-nums">{numero(p.stockInicial)}</td>
              <td className="num tabular-nums font-semibold">{numero(p.vendida)}</td>
              <td className={`num tabular-nums font-semibold ${p.saldo <= 0 ? "text-rojo" : ""}`}>{numero(p.saldo)}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="px-5 py-3 text-[12px] text-ink-3">En unidades. Stock inicial: lo que había al empezar el periodo; saldo: lo que queda hoy (incluye compras y salidas del periodo).{datos.propias ? " Cuenta solo tus ventas." : ""}</p>
        </div>
      ) : <Vacio titulo="Sin ventas en este periodo">Prueba con un periodo más largo.</Vacio>}
    </Tarjeta>
  );
}
