"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Printer, Save, Trash } from "lucide-react";
import { api, useDatos, soles, numero, fechaCorta, hoyLima, sumarDias, vence } from "@/lib/cliente";
import { descargarCsv } from "@/lib/csv";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Interruptor, Sello, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type Cat = { id: string; nombre: string; tipo: "ventas" | "especial"; config?: { agrupar: string; metricas: string[]; orden?: string; limite?: number; filtros?: Record<string, string> } };
type Met = { codigo: string; nombre: string; unidad: string; tipo: string; sensible: boolean; formula?: string; id?: number; enPanel?: boolean };
type Info = { catalogo: Cat[]; metricas: { base: Met[]; derivadas: Met[]; dimensiones: { codigo: string; nombre: string }[] }; guardados: { id: number; nombre: string; config: { agrupar: string; metricas: string[]; filtros?: Record<string, string> } }[] };
type Res = { desde: string; hasta: string; agrupar: { codigo: string; nombre: string }; columnas: { codigo: string; nombre: string; unidad: string }[]; filas: { grupo: string; valores: Record<string, number | null> }[]; totales: Record<string, number | null> | null };
type Esp = { columnas: string[]; filas: Record<string, unknown>[] };

const fmt = (v: number | null | undefined, unidad: string) => v === null || v === undefined ? "—" : unidad === "SOLES" ? soles(v) : unidad === "PORCENTAJE" ? `${numero(v, 1)}%` : unidad === "UNIDADES" ? numero(v) : numero(v, v % 1 ? 2 : 0);

function Reportes() {
  const u = useUsuario();
  const avisar = useAviso();
  const sp = useSearchParams();
  const info = useDatos<Info>("/api/reportes");
  const [sel, setSel] = useState<string>(sp.get("r") ?? "ventas-categoria");
  const [cfg, setCfg] = useState<{ agrupar: string; metricas: string[]; orden?: string; limite?: number; filtros?: Record<string, string> }>({ agrupar: "categoria", metricas: ["ventas", "unidades", "tickets", "ticket_promedio"] });
  const [desde, setDesde] = useState(sumarDias(hoyLima(), -29));
  const [hasta, setHasta] = useState(hoyLima());
  const [res, setRes] = useState<Res | null>(null);
  const [esp, setEsp] = useState<Esp | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombreGuardar, setNombreGuardar] = useState("");

  const todas = useMemo(() => [...(info.datos?.metricas.base ?? []), ...(info.datos?.metricas.derivadas ?? [])], [info.datos]);
  const actual = info.datos?.catalogo.find((c) => c.id === sel);

  useEffect(() => {
    if (!info.datos) return;
    const c = info.datos.catalogo.find((x) => x.id === sel);
    const g = info.datos.guardados.find((x) => `g${x.id}` === sel);
    if (c?.config) setCfg({ ...c.config, metricas: c.config.metricas.filter((m) => todas.some((t) => t.codigo === m)) });
    else if (g) setCfg(g.config);
  }, [sel, info.datos, todas]);

  useEffect(() => {
    if (!info.datos) return;
    const ejecutar = async () => {
      setCargando(true); setError(null);
      try {
        if (actual?.tipo === "especial") { setRes(null); setEsp(await api<Esp>(`/api/reportes/especial/${sel}?desde=${desde}&hasta=${hasta}`)); }
        else if (cfg.metricas.length) { setEsp(null); setRes(await api<Res>("/api/reportes/ejecutar", { cuerpo: { ...cfg, desde, hasta } })); }
      } catch (e) { setError((e as Error).message); } finally { setCargando(false); }
    };
    const h = setTimeout(ejecutar, 120);
    return () => clearTimeout(h);
  }, [cfg, desde, hasta, sel, actual?.tipo, info.datos]);

  const alternarMetrica = (m: string) => setCfg((c) => ({ ...c, metricas: c.metricas.includes(m) ? c.metricas.filter((x) => x !== m) : [...c.metricas, m].slice(0, 10) }));
  const exportar = () => {
    if (res) descargarCsv(`reporte-${sel}-${desde}-${hasta}.csv`, [res.agrupar.nombre, ...res.columnas.map((c) => c.nombre)], [...res.filas.map((f) => [f.grupo, ...res.columnas.map((c) => f.valores[c.codigo])]), ...(res.totales ? [["Total", ...res.columnas.map((c) => res.totales![c.codigo])]] : [])]);
    else if (esp) descargarCsv(`reporte-${sel}.csv`, Object.keys(esp.filas[0] ?? {}), esp.filas.map((f) => Object.values(f)));
  };
  const guardar = async () => {
    try { const r = await api<{ id: number }>("/api/reportes/guardados", { cuerpo: { nombre: nombreGuardar, config: { agrupar: cfg.agrupar, metricas: cfg.metricas, filtros: cfg.filtros } } }); avisar("ok", "Guardado en Mis reportes."); setNombreGuardar(""); await info.recargar(); setSel(`g${r.id}`); }
    catch (e) { avisar("error", (e as Error).message); }
  };

  if (!info.datos) return <Cargando alto="h-96" />;
  const primera = res?.columnas[0];
  const maxPrimera = primera ? Math.max(1, ...res!.filas.map((f) => Math.abs(f.valores[primera.codigo] ?? 0))) : 1;

  return (
    <div>
      <Encabezado titulo="Reportes" bajada="Los más usados ya están listos; cambia el periodo, la agrupación y las métricas, o crea métricas propias.">
        <Boton variante="borde" onClick={exportar} disabled={!res && !esp}><Download size={16} /> Excel</Boton>
        <Boton variante="borde" onClick={() => window.print()}><Printer size={16} /> PDF</Boton>
      </Encabezado>
      <div className={`grid gap-6 items-start ${u.rol === "ADMIN" ? "2xl:grid-cols-[240px_minmax(0,1fr)_320px] xl:grid-cols-[240px_minmax(0,1fr)]" : "xl:grid-cols-[240px_minmax(0,1fr)]"}`}>
        <nav className="no-imprimir space-y-5" aria-label="Catálogo de reportes">
          <div>
            <p className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-wide mb-2 px-2">Precargados</p>
            {info.datos.catalogo.map((c) => <button key={c.id} onClick={() => setSel(c.id)} className={`w-full text-left px-3 py-2 rounded-xl text-[14px] ${sel === c.id ? "bg-petroleo text-white font-semibold" : "hover:bg-foil-2/60"}`}>{c.nombre}</button>)}
          </div>
          <div>
            <p className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-wide mb-2 px-2">Mis reportes</p>
            {info.datos.guardados.length ? info.datos.guardados.map((g) => <button key={g.id} onClick={() => setSel(`g${g.id}`)} className={`w-full text-left px-3 py-2 rounded-xl text-[14px] ${sel === `g${g.id}` ? "bg-petroleo text-white font-semibold" : "hover:bg-foil-2/60"}`}>{g.nombre}</button>) : <p className="text-[13px] text-ink-3 px-3">Guarda un reporte personalizado para verlo aquí.</p>}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          <Tarjeta className="no-imprimir p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <Campo etiqueta="Desde"><Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" /></Campo>
              <Campo etiqueta="Hasta"><Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" /></Campo>
              {actual?.tipo !== "especial" ? <Campo etiqueta="Agrupar por"><Selector value={cfg.agrupar} onChange={(e) => setCfg({ ...cfg, agrupar: e.target.value, orden: undefined })} className="w-44">{info.datos.metricas.dimensiones.map((d) => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}</Selector></Campo> : null}
              <div className="flex gap-1.5">{[["Hoy", 0], ["7 días", 6], ["30 días", 29], ["90 días", 89]].map(([t, d]) => <button key={t as string} onClick={() => { setDesde(sumarDias(hoyLima(), -(d as number))); setHasta(hoyLima()); }} className="h-10 px-3 rounded-xl bg-foil text-[13px] font-semibold hover:bg-foil-2">{t}</button>)}</div>
            </div>
            {actual?.tipo !== "especial" ? (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {todas.map((m) => (
                  <button key={m.codigo} onClick={() => alternarMetrica(m.codigo)} aria-pressed={cfg.metricas.includes(m.codigo)}
                    className={`h-8 px-3 rounded-full text-[13px] font-semibold border transition ${cfg.metricas.includes(m.codigo) ? "bg-[#e9f4f1] border-petroleo-3/50 text-petroleo" : "border-foil-3 text-ink-2 hover:border-ink-3"}`}>
                    {m.nombre}{m.tipo === "PERSONALIZADA" ? " ✦" : ""}
                  </button>
                ))}
              </div>
            ) : null}
          </Tarjeta>

          <Tarjeta titulo={<span>{actual?.nombre ?? info.datos.guardados.find((g) => `g${g.id}` === sel)?.nombre} <span className="text-ink-3 font-sans font-normal text-[13px] ml-2">{fechaCorta(desde)} – {fechaCorta(hasta)}</span></span>}>
            {error ? <p className="px-5 pb-5 text-rojo text-sm">{error}</p> : cargando && !res && !esp ? <div className="p-5"><Cargando /></div> : res ? (
              res.filas.length ? (
                <div className="overflow-x-auto"><table className="tabla">
                  <thead><tr><th>{res.agrupar.nombre}</th>{res.columnas.map((c) => <th key={c.codigo} className="num"><button onClick={() => setCfg({ ...cfg, orden: c.codigo })} className={cfg.orden === c.codigo ? "text-ink" : ""}>{c.nombre}</button></th>)}</tr></thead>
                  <tbody>
                    {res.filas.map((f) => (
                      <tr key={f.grupo}>
                        <td className="min-w-[200px]"><div className="font-semibold">{f.grupo}</div>{primera ? <div className="barra mt-1.5 max-w-[240px]"><span style={{ width: `${(Math.abs(f.valores[primera.codigo] ?? 0) / maxPrimera) * 100}%` }} /></div> : null}</td>
                        {res.columnas.map((c) => <td key={c.codigo} className="num">{fmt(f.valores[c.codigo], c.unidad)}</td>)}
                      </tr>
                    ))}
                    {res.totales && res.filas.length > 1 ? <tr className="font-semibold"><td>Total</td>{res.columnas.map((c) => <td key={c.codigo} className="num">{fmt(res.totales![c.codigo], c.unidad)}</td>)}</tr> : null}
                  </tbody>
                </table></div>
              ) : <Vacio titulo="Sin ventas en el periodo" />
            ) : esp ? <Especial id={sel} datos={esp} verCostos={u.verCostos} /> : null}
            {res && !sel.startsWith("g") ? (
              <div className="no-imprimir flex flex-wrap gap-2 px-5 py-4 border-t border-foil">
                <Entrada className="max-w-xs" placeholder="Nombre para guardar este reporte" value={nombreGuardar} onChange={(e) => setNombreGuardar(e.target.value)} />
                <Boton variante="borde" disabled={nombreGuardar.trim().length < 3} onClick={guardar}><Save size={15} /> Guardar en Mis reportes</Boton>
              </div>
            ) : null}
          </Tarjeta>
        </div>

        {u.rol === "ADMIN" ? <NuevaMetrica base={info.datos.metricas.base} derivadas={info.datos.metricas.derivadas} alGuardar={info.recargar} /> : null}
      </div>
    </div>
  );
}

function Especial({ id, datos, verCostos }: { id: string; datos: Esp; verCostos: boolean }) {
  if (!datos.filas.length) return <Vacio titulo="No hay registros" />;
  if (id === "por-vencer") return (
    <div className="overflow-x-auto"><table className="tabla"><thead><tr><th>Producto</th><th>Lote</th><th className="num">Días</th><th className="num">Unidades</th>{verCostos ? <th className="num">Costo</th> : null}<th>Acción sugerida</th></tr></thead>
      <tbody>{datos.filas.map((f, i) => { const d = f.dias as number; return <tr key={i}><td className="font-semibold">{f.producto as string}</td><td><Sello lote={f.lote as string} vence={vence(f.vencimiento as string)} sev={d <= 30 ? "CRITICA" : d <= 60 ? "ALTA" : undefined} /></td><td className={`num font-semibold ${d <= 30 ? "text-rojo" : ""}`}>{d <= 0 ? "Vencido" : d}</td><td className="num">{f.unidades as number}</td>{verCostos ? <td className="num">{soles(f.costoTotal as number)}</td> : null}<td>{f.accion as string}</td></tr>; })}</tbody></table></div>
  );
  if (id === "stock-critico") return (
    <div className="overflow-x-auto"><table className="tabla"><thead><tr><th>Producto</th><th className="num">Stock</th><th className="num">Mínimo</th><th className="num">Venta/día</th><th className="num">Alcanza</th><th className="num">Pedido sugerido</th></tr></thead>
      <tbody>{datos.filas.map((f, i) => <tr key={i}><td className="font-semibold">{f.producto as string}</td><td className={`num ${(f.stock as number) === 0 ? "text-rojo font-semibold" : ""}`}>{f.stock as number}</td><td className="num">{f.minimo as number}</td><td className="num">{f.ventaDiaria as number}</td><td className="num">{f.cobertura === null ? "—" : `${f.cobertura} días`}</td><td className="num font-semibold">{f.sugerido as number} und.</td></tr>)}</tbody></table></div>
  );
  if (id === "salidas-motivo") return (
    <table className="tabla"><thead><tr><th>Motivo</th><th className="num">Movimientos</th><th className="num">Unidades</th>{verCostos ? <th className="num">Pérdida a costo</th> : null}</tr></thead>
      <tbody>{datos.filas.map((f, i) => <tr key={i}><td className="font-semibold">{f.motivo as string}</td><td className="num">{f.movimientos as number}</td><td className="num">{f.unidades as number}</td>{verCostos ? <td className="num">{soles(f.costoTotal as number)}</td> : null}</tr>)}</tbody></table>
  );
  return (
    <div className="overflow-x-auto"><table className="tabla"><thead><tr><th>Sesión</th><th>Caja</th><th>Cajero</th><th>Turno</th><th>Cierre</th><th className="num">Diferencia</th></tr></thead>
      <tbody>{datos.filas.map((f, i) => <tr key={i}><td><a className="sello" href={`/caja/reporte/${f.id}`}>{String(f.id).padStart(6, "0")}</a></td><td>{f.caja as string}</td><td>{f.cajero as string}</td><td className="capitalize">{String(f.turno).toLowerCase()}</td><td>{fechaCorta(f.cerradaEn as string)}</td><td className={`num font-semibold ${Math.abs((f.diferencia as number) ?? 0) > 5 ? "text-rojo" : ""}`}>{soles(f.diferencia as number)}</td></tr>)}</tbody></table></div>
  );
}

function NuevaMetrica({ base, derivadas, alGuardar }: { base: Met[]; derivadas: Met[]; alGuardar: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState("");
  const [formula, setFormula] = useState("");
  const [unidad, setUnidad] = useState("NUMERO");
  const [roles, setRoles] = useState<string[]>(["ADMIN"]);
  const [enPanel, setEnPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setError(null);
    try { const m = await api<{ sensible: boolean }>("/api/metricas", { cuerpo: { nombre, formula, unidad, roles, enPanel } }); avisar("ok", m.sensible ? "Métrica creada. Usa costos: solo la verá el administrador." : "Métrica creada."); setNombre(""); setFormula(""); alGuardar(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <aside className="no-imprimir space-y-4 xl:col-start-2 2xl:col-start-auto xl:grid xl:grid-cols-2 xl:gap-4 xl:space-y-0 2xl:block 2xl:space-y-4 items-start">
      <Tarjeta titulo="Nueva métrica">
        <div className="px-5 pb-5 space-y-3">
          <Campo etiqueta="Nombre"><Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ventas por ticket con complemento" /></Campo>
          <Campo etiqueta="Fórmula" ayuda="Usa + − × ÷ y paréntesis sobre las métricas base">
            <Entrada value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="ventas / tickets" className="font-mono text-[13.5px]" />
          </Campo>
          <div className="flex flex-wrap gap-1">{base.map((b) => <button key={b.codigo} onClick={() => setFormula((f) => `${f}${f && !/[\s(]$/.test(f) ? " " : ""}${b.codigo}`)} className="h-7 px-2 rounded-lg bg-foil text-[12px] font-mono hover:bg-foil-2" title={b.nombre}>{b.codigo}</button>)}</div>
          <Campo etiqueta="Unidad"><Selector value={unidad} onChange={(e) => setUnidad(e.target.value)}><option value="SOLES">Soles</option><option value="PORCENTAJE">Porcentaje</option><option value="UNIDADES">Unidades</option><option value="NUMERO">Número</option></Selector></Campo>
          <fieldset><legend className="text-[12.5px] font-semibold text-ink-2 mb-1.5">Quién la ve</legend>
            <div className="flex flex-wrap gap-1.5">{["ADMIN", "QF", "CONTADOR", "INVENTARIADOR"].map((r) => <button key={r} onClick={() => setRoles((rs) => rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r])} aria-pressed={roles.includes(r)} className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border ${roles.includes(r) ? "bg-petroleo text-white border-petroleo" : "border-foil-3 text-ink-2"}`}>{r === "ADMIN" ? "Admin" : r === "QF" ? "QF" : r[0] + r.slice(1).toLowerCase()}</button>)}</div>
          </fieldset>
          <label className="flex items-center justify-between text-sm"><span className="font-semibold text-ink-2">Mostrar como tarjeta en el panel</span><Interruptor activo={enPanel} alCambiar={() => setEnPanel(!enPanel)} etiqueta="Mostrar en el panel" /></label>
          {error ? <p className="text-sm text-rojo">{error}</p> : null}
          <Boton className="w-full" disabled={nombre.trim().length < 3 || !formula.trim()} onClick={guardar}>Guardar métrica</Boton>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Métricas propias">
        <ul className="px-5 pb-4 space-y-2.5">{derivadas.map((d) => (
          <li key={d.codigo} className="flex items-start justify-between gap-2">
            <div><p className="font-semibold text-[13.5px]">{d.nombre} {d.sensible ? <Insignia tono="ambar">con costos</Insignia> : null}</p><p className="font-mono text-[12px] text-ink-3">{d.formula}</p></div>
            <button className="text-ink-3 hover:text-rojo mt-0.5" aria-label={`Eliminar ${d.nombre}`} onClick={async () => { await api(`/api/metricas?id=${d.id}`, { metodo: "DELETE" }); alGuardar(); }}><Trash size={14} /></button>
          </li>
        ))}</ul>
      </Tarjeta>
    </aside>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Reportes /></Suspense>; }
