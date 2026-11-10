"use client";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Calculator, Download, Printer, Save, Search, ShieldAlert, Trash } from "lucide-react";
import { api, useDatos, soles, numero, fechaCorta, fechaHora, hoyLima, sumarDias } from "@/lib/cliente";
import { descargarCsv } from "@/lib/csv";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Interruptor, Modal, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { tieneRol } from "@/lib/permisos";
import { CumplimientoCuota } from "./cuotas";

type Periodo = "fecha" | "vencimiento" | null;
type Cfg = { agrupar: string; metricas: string[]; orden?: string; limite?: number; filtros?: Record<string, string> };
type Cat = { id: string; nombre: string; grupo: string; periodo: Periodo; tipo: "ventas" | "especial" | "cuota"; config?: Cfg };
type Met = { codigo: string; nombre: string; unidad: string; tipo: string; sensible: boolean; formula?: string; id?: number; enPanel?: boolean };
type Opcion = { id: number; nombre: string };
type Info = {
  catalogo: Cat[]; metricas: { base: Met[]; derivadas: Met[]; dimensiones: { codigo: string; nombre: string }[] };
  guardados: { id: number; nombre: string; config: Cfg }[]; opciones: { categorias: Opcion[]; laboratorios: Opcion[]; vendedores: Opcion[] };
};
type Res = { desde: string; hasta: string; agrupar: { codigo: string; nombre: string }; columnas: { codigo: string; nombre: string; unidad: string }[]; filas: { grupo: string; valores: Record<string, number | null> }[]; totales: Record<string, number | null> | null };
type Col = { codigo: string; nombre: string; tipo: "texto" | "codigo" | "soles" | "entero" | "decimal" | "fecha" | "fechaHora" | "dias" | "estado" | "diferencia"; oculta?: boolean };
type Esp = { desde?: string; hasta?: string; columnas: Col[]; filtros: { codigo: string; nombre: string; tipo: "lista" | "botones" }[]; filas: Record<string, unknown>[] };

const fmt = (v: number | null | undefined, unidad: string) => v === null || v === undefined ? "—" : unidad === "SOLES" ? soles(v) : unidad === "PORCENTAJE" ? `${numero(v, 1)}%` : unidad === "UNIDADES" ? numero(v) : numero(v, v % 1 ? 2 : 0);
const finDeMes = (f: string) => { const [a, m] = f.split("-").map(Number); return `${a}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const inicioDeMes = (f: string) => `${f.slice(0, 7)}-01`;
const mesAnterior = (f: string) => sumarDias(inicioDeMes(f), -1);

/** Atajos de periodo: para ventas y movimientos miran hacia atrás; para vencimientos, hacia adelante. */
function atajos(periodo: Periodo): { texto: string; rango: () => [string, string] }[] {
  const hoy = hoyLima();
  if (periodo === "vencimiento") return [
    { texto: "Vencidos", rango: () => ["2000-01-01", hoy] },
    { texto: "Este mes", rango: () => [hoy, finDeMes(hoy)] },
    { texto: "Próximo mes", rango: () => { const i = sumarDias(finDeMes(hoy), 1); return [i, finDeMes(i)]; } },
    { texto: "30 días", rango: () => [hoy, sumarDias(hoy, 30)] },
    { texto: "60 días", rango: () => [hoy, sumarDias(hoy, 60)] },
    { texto: "90 días", rango: () => [hoy, sumarDias(hoy, 90)] },
    { texto: "6 meses", rango: () => [hoy, sumarDias(hoy, 180)] },
  ];
  return [
    { texto: "Hoy", rango: () => [hoy, hoy] },
    { texto: "Ayer", rango: () => [sumarDias(hoy, -1), sumarDias(hoy, -1)] },
    { texto: "7 días", rango: () => [sumarDias(hoy, -6), hoy] },
    { texto: "Este mes", rango: () => [inicioDeMes(hoy), hoy] },
    { texto: "Mes anterior", rango: () => [inicioDeMes(mesAnterior(hoy)), mesAnterior(hoy)] },
    { texto: "30 días", rango: () => [sumarDias(hoy, -29), hoy] },
    { texto: "90 días", rango: () => [sumarDias(hoy, -89), hoy] },
    { texto: "Este año", rango: () => [`${hoy.slice(0, 4)}-01-01`, hoy] },
  ];
}
const rangoInicial = (periodo: Periodo): [string, string] => periodo === "vencimiento" ? [hoyLima(), sumarDias(hoyLima(), 90)] : [sumarDias(hoyLima(), -29), hoyLima()];

const TONO: Record<string, "rojo" | "ambar" | "azul" | "ok" | "gris"> = {
  Agotado: "rojo", "Bajo mínimo": "ambar", "Por terminarse": "azul",
  "Dar de baja": "rojo", "Devolver o liquidar": "rojo", "Liquidar o crear campaña": "ambar", "Priorizar venta": "azul",
  Salida: "ambar", Entrada: "ok", Faltante: "rojo", Sobrante: "ok", Cuadrado: "gris", "Por aprobar": "ambar",
};
/** Columnas que tiene sentido sumar al pie de los reportes especiales. */
const SUMABLES = new Set(["unidades", "costoTotal", "costoPedido", "sugerido", "movimientos", "saldoEfectivo", "saldoVirtual", "diferencia"]);
const esNumero = (t: Col["tipo"]) => ["soles", "entero", "decimal", "dias", "diferencia"].includes(t);

function celda(c: Col, v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="text-ink-3">—</span>;
  switch (c.tipo) {
    case "codigo": return <span className="sello">{String(v)}</span>;
    case "soles": return soles(Number(v));
    case "entero": return numero(Number(v));
    case "decimal": return numero(Number(v), 1);
    case "fecha": return <span className="whitespace-nowrap">{fechaCorta(String(v))}</span>;
    case "fechaHora": return <span className="whitespace-nowrap">{fechaHora(String(v))}</span>;
    case "dias": { const d = Number(v); return <span className={`font-semibold ${d <= 30 ? "text-rojo" : d <= 60 ? "text-[#8a5b00]" : ""}`}>{d <= 0 ? "Vencido" : d}</span>; }
    case "estado": return <Insignia tono={TONO[String(v)] ?? "gris"}>{String(v)}</Insignia>;
    case "diferencia": { const d = Number(v); return <span className={`inline-block rounded-full px-2 py-0.5 font-semibold tabular-nums ${d < -0.004 ? "bg-rojo-claro text-rojo" : d > 0.004 ? "bg-ok-claro text-ok" : "text-ink-2"}`}>{d > 0.004 ? "+" : d < -0.004 ? "−" : ""}{soles(Math.abs(d))}</span>; }
    default: return String(v);
  }
}

function leerColumnas(clave: string): string[] | null { try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : null; } catch { return null; } }
function guardarColumnas(clave: string, cols: string[]) { try { localStorage.setItem(clave, JSON.stringify(cols)); } catch { /* solo esta visita */ } }

/** Botón que se enciende o apaga: columnas, periodos rápidos y filtros por botones. */
function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={activo}
      className={`h-8 px-3 rounded-full text-[13px] font-semibold border transition ${activo ? "bg-[#e9f4f1] border-petroleo-3/50 text-petroleo" : "border-foil-3 text-ink-2 hover:border-ink-3"}`}>
      {children}
    </button>
  );
}
const Etiqueta = ({ children }: { children: ReactNode }) => <p className="text-[12px] font-semibold text-ink-3 uppercase tracking-wide mb-1.5">{children}</p>;

function Reportes() {
  const u = useUsuario();
  const avisar = useAviso();
  const sp = useSearchParams();
  const info = useDatos<Info>("/api/reportes");
  const [sel, setSel] = useState<string>(sp.get("r") ?? "ventas-categoria");
  const [cfg, setCfg] = useState<Cfg>({ agrupar: "categoria", metricas: ["ventas", "unidades", "tickets", "ticket_promedio"] });
  const [[desde, hasta], setRango] = useState<[string, string]>(rangoInicial("fecha"));
  // Solo el propietario filtra por canal; va aparte de la configuración para no guardarse en reportes compartidos.
  const [canal, setCanal] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [esp, setEsp] = useState<Esp | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombreGuardar, setNombreGuardar] = useState("");
  const [metricasAbierto, setMetricasAbierto] = useState(false);
  // Filtros y columnas de los reportes de inventario y caja: se aplican sobre los datos ya traídos.
  const [busqueda, setBusqueda] = useState("");
  const [rapidos, setRapidos] = useState<Record<string, string>>({});
  const [visibles, setVisibles] = useState<string[] | null>(null);
  const [orden, setOrden] = useState<{ col: string; asc: boolean } | null>(null);

  const todas = useMemo(() => [...(info.datos?.metricas.base ?? []), ...(info.datos?.metricas.derivadas ?? [])], [info.datos]);
  const actual = info.datos?.catalogo.find((c) => c.id === sel);
  const guardado = info.datos?.guardados.find((g) => `g${g.id}` === sel);
  const tipo = actual?.tipo ?? (guardado ? "ventas" : null);
  const periodo: Periodo = actual ? actual.periodo : guardado ? "fecha" : null;
  const nombre = actual?.nombre ?? guardado?.nombre ?? "";

  // Al cambiar de reporte: su configuración, su periodo por defecto y filtros limpios.
  useEffect(() => {
    if (!info.datos) return;
    const c = info.datos.catalogo.find((x) => x.id === sel);
    const g = info.datos.guardados.find((x) => `g${x.id}` === sel);
    if (!c && !g && info.datos.catalogo.length) { setSel(info.datos.catalogo[0].id); return; } // ?r= con un reporte que no existe
    if (c?.config) setCfg({ ...c.config, metricas: c.config.metricas.filter((m) => todas.some((t) => t.codigo === m)) });
    else if (g) setCfg(g.config);
    setRango(rangoInicial(c ? c.periodo : "fecha"));
    setBusqueda(""); setRapidos({}); setOrden(null); setEsp(null); setRes(null);
    setVisibles(leerColumnas(`botica_reporte_columnas_${sel}`));
  }, [sel, info.datos, todas]);

  useEffect(() => {
    if (!info.datos || !tipo || tipo === "cuota") return;
    const ejecutar = async () => {
      setCargando(true); setError(null);
      try {
        if (tipo === "especial") { setRes(null); setEsp(await api<Esp>(`/api/reportes/especial/${sel}${periodo ? `?desde=${desde}&hasta=${hasta}` : ""}`)); }
        else if (cfg.metricas.length) { setEsp(null); setRes(await api<Res>("/api/reportes/ejecutar", { cuerpo: { ...cfg, filtros: { ...cfg.filtros, ...(canal ? { canal } : {}) }, desde, hasta } })); }
      } catch (e) { setError((e as Error).message); } finally { setCargando(false); }
    };
    const h = setTimeout(ejecutar, 150);
    return () => clearTimeout(h);
  }, [cfg, desde, hasta, sel, tipo, periodo, info.datos, canal]);

  const alternarMetrica = (m: string) => setCfg((c) => ({ ...c, metricas: c.metricas.includes(m) ? c.metricas.filter((x) => x !== m) : [...c.metricas, m].slice(0, 10) }));
  const fijarFiltro = (k: string, v: string) => setCfg((c) => { const f = { ...(c.filtros ?? {}) }; if (v) f[k] = v; else delete f[k]; return { ...c, filtros: f }; });

  const columnasEsp = useMemo(() => esp?.columnas ?? [], [esp]);
  const activas = columnasEsp.filter((c) => (visibles ? visibles.includes(c.codigo) : !c.oculta));
  const alternarColumna = (codigo: string) => {
    const base = activas.map((c) => c.codigo);
    const nuevas = base.includes(codigo) ? base.filter((x) => x !== codigo) : columnasEsp.map((c) => c.codigo).filter((x) => x === codigo || base.includes(x));
    if (!nuevas.length) return;
    setVisibles(nuevas); guardarColumnas(`botica_reporte_columnas_${sel}`, nuevas);
  };
  const opcionesRapidas = useMemo(() => Object.fromEntries((esp?.filtros ?? []).map((x) => [x.codigo, [...new Set((esp?.filas ?? []).map((r) => String(r[x.codigo] ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b))])), [esp]);
  const filasEsp = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    let out = (esp?.filas ?? []).filter((r) => Object.entries(rapidos).every(([k, v]) => !v || String(r[k]) === v)
      && (!t || columnasEsp.some((c) => (c.tipo === "texto" || c.tipo === "codigo") && String(r[c.codigo] ?? "").toLowerCase().includes(t))));
    if (orden) {
      const col = columnasEsp.find((c) => c.codigo === orden.col);
      out = [...out].sort((a, b) => {
        const x = a[orden.col], y = b[orden.col];
        const r = col && esNumero(col.tipo) ? Number(x ?? -Infinity) - Number(y ?? -Infinity) : String(x ?? "").localeCompare(String(y ?? ""));
        return orden.asc ? r : -r;
      });
    }
    return out;
  }, [esp, rapidos, busqueda, orden, columnasEsp]);

  const exportar = () => {
    const sufijo = periodo ? `-${desde}-${hasta}` : `-${hoyLima()}`;
    if (res) descargarCsv(`reporte-${sel}${canal ? `-${canal.toLowerCase()}` : ""}${sufijo}.csv`, [res.agrupar.nombre, ...res.columnas.map((c) => c.nombre)], [...res.filas.map((x) => [x.grupo, ...res.columnas.map((c) => x.valores[c.codigo])]), ...(res.totales ? [["Total", ...res.columnas.map((c) => res.totales![c.codigo])]] : [])]);
    else if (esp) descargarCsv(`reporte-${sel}${sufijo}.csv`, activas.map((c) => c.nombre), filasEsp.map((r) => activas.map((c) => {
      const v = r[c.codigo];
      return c.tipo === "fechaHora" && v ? fechaHora(String(v)) : c.tipo === "dias" && Number(v) <= 0 ? "Vencido" : v;
    })));
  };
  const guardar = async () => {
    try { const r = await api<{ id: number }>("/api/reportes/guardados", { cuerpo: { nombre: nombreGuardar, config: { agrupar: cfg.agrupar, metricas: cfg.metricas, filtros: cfg.filtros } } }); avisar("ok", "Guardado en Mis reportes."); setNombreGuardar(""); await info.recargar(); setSel(`g${r.id}`); }
    catch (e) { avisar("error", (e as Error).message); }
  };

  if (!info.datos) return <Cargando alto="h-96" />;
  const primera = res?.columnas[0];
  const maxPrimera = primera ? Math.max(1, ...res!.filas.map((x) => Math.abs(x.valores[primera.codigo] ?? 0))) : 1;
  const grupos = [...new Set(info.datos.catalogo.map((c) => c.grupo))];
  const f = cfg.filtros ?? {};
  const op = info.datos.opciones;
  const filtrosEsp = Object.values(rapidos).filter(Boolean).length + (busqueda.trim() ? 1 : 0);
  const filtrosVentas = ["categoriaId", "laboratorioId", "vendedorId", "comprobante"].filter((k) => f[k]).length + (canal ? 1 : 0);

  return (
    <div>
      <Encabezado titulo="Reportes" bajada="Elige el reporte, ajusta los filtros y las columnas; el resultado aparece abajo, a todo lo ancho.">
        {tipo !== "cuota" ? <Boton variante="borde" onClick={exportar} disabled={!res && !esp}><Download size={16} /> Excel</Boton> : null}
        <Boton variante="borde" onClick={() => window.print()}><Printer size={16} /> PDF</Boton>
        {u.roles.includes("ADMIN") ? <Boton variante="borde" onClick={() => setMetricasAbierto(true)}><Calculator size={16} /> Métricas</Boton> : null}
        {tieneRol(u.roles, "ADMIN", "CONTADOR") ? <Link href="/caja/eliminaciones"><Boton variante="borde"><ShieldAlert size={16} /> Eliminaciones de caja</Boton></Link> : null}
      </Encabezado>

      <Tarjeta className="no-imprimir p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Campo etiqueta="Reporte">
            <Selector value={sel} onChange={(e) => setSel(e.target.value)} className="w-80 font-semibold" aria-label="Reporte">
              {grupos.map((g) => <optgroup key={g} label={g}>{info.datos!.catalogo.filter((c) => c.grupo === g).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>)}
              {info.datos.guardados.length ? <optgroup label="Mis reportes">{info.datos.guardados.map((g) => <option key={g.id} value={`g${g.id}`}>{g.nombre}</option>)}</optgroup> : null}
            </Selector>
          </Campo>
          {periodo ? (
            <>
              <Campo etiqueta={periodo === "vencimiento" ? "Vence desde" : "Desde"}><Entrada type="date" value={desde} onChange={(e) => setRango([e.target.value, hasta])} className="w-40" /></Campo>
              <Campo etiqueta={periodo === "vencimiento" ? "Vence hasta" : "Hasta"}><Entrada type="date" value={hasta} onChange={(e) => setRango([desde, e.target.value])} className="w-40" /></Campo>
            </>
          ) : tipo === "especial" ? <p className="text-[13px] text-ink-3 h-10 flex items-center">Muestra el estado de hoy; no usa periodo.</p> : null}
        </div>
        {periodo ? (
          <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Periodos rápidos">
            {atajos(periodo).map((a) => { const [d, h] = a.rango(); return <Chip key={a.texto} activo={d === desde && h === hasta} onClick={() => setRango([d, h])}>{a.texto}</Chip>; })}
          </div>
        ) : null}

        {tipo === "ventas" ? (
          <>
            <div className="flex flex-wrap gap-3 items-end mt-4 pt-4 border-t border-foil">
              <Campo etiqueta="Agrupar por"><Selector value={cfg.agrupar} onChange={(e) => setCfg({ ...cfg, agrupar: e.target.value, orden: undefined })} className="w-44">{info.datos.metricas.dimensiones.map((d) => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}</Selector></Campo>
              <Campo etiqueta="Categoría"><Selector value={f.categoriaId ?? ""} onChange={(e) => fijarFiltro("categoriaId", e.target.value)} className="w-48"><option value="">Todas</option>{op.categorias.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</Selector></Campo>
              <Campo etiqueta="Laboratorio"><Selector value={f.laboratorioId ?? ""} onChange={(e) => fijarFiltro("laboratorioId", e.target.value)} className="w-48"><option value="">Todos</option>{op.laboratorios.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</Selector></Campo>
              <Campo etiqueta="Vendedor"><Selector value={f.vendedorId ?? ""} onChange={(e) => fijarFiltro("vendedorId", e.target.value)} className="w-48"><option value="">Todos</option>{op.vendedores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</Selector></Campo>
              <Campo etiqueta="Comprobante"><Selector value={f.comprobante ?? ""} onChange={(e) => fijarFiltro("comprobante", e.target.value)} className="w-40"><option value="">Todos</option><option value="BOLETA">Boleta</option><option value="FACTURA">Factura</option><option value="NOTA_VENTA">Nota de venta</option></Selector></Campo>
              {u.roles.includes("ADMIN") ? (
                <Campo etiqueta="Canal de venta"><Selector value={canal} onChange={(e) => setCanal(e.target.value)} className="w-48">
                  <option value="">Todas las ventas</option><option value="MOSTRADOR">Solo mostrador</option><option value="TRANSFERENCIA">Solo por transferencia</option>
                </Selector></Campo>
              ) : null}
              <label className="flex items-center gap-2 h-10 text-[13.5px] font-semibold text-ink-2"><Interruptor activo={!!f.soloCampana} alCambiar={() => fijarFiltro("soloCampana", f.soloCampana ? "" : "1")} etiqueta="Solo productos en campaña" /> Solo en campaña</label>
              {filtrosVentas ? <Boton variante="fantasma" onClick={() => { setCanal(""); setCfg((c) => ({ ...c, filtros: c.filtros?.soloCampana ? { soloCampana: c.filtros.soloCampana } : ({} as Record<string, string>) })); }}>Quitar filtros ({filtrosVentas})</Boton> : null}
            </div>
            <div className="mt-4">
              <Etiqueta>Columnas</Etiqueta>
              <div className="flex flex-wrap gap-1.5">{todas.map((m) => <Chip key={m.codigo} activo={cfg.metricas.includes(m.codigo)} onClick={() => alternarMetrica(m.codigo)}>{m.nombre}{m.tipo === "PERSONALIZADA" ? " ✦" : ""}</Chip>)}</div>
            </div>
          </>
        ) : null}

        {tipo === "especial" && esp ? (
          <>
            <div className="flex flex-wrap gap-3 items-end mt-4 pt-4 border-t border-foil">
              <Campo etiqueta="Buscar">
                <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
                  <Entrada className="w-64 pl-9" placeholder="Producto, código, lote…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar en el reporte" /></div>
              </Campo>
              {esp.filtros.filter((x) => x.tipo === "lista").map((x) => (
                <Campo key={x.codigo} etiqueta={x.nombre}><Selector value={rapidos[x.codigo] ?? ""} onChange={(e) => setRapidos({ ...rapidos, [x.codigo]: e.target.value })} className="w-52">
                  <option value="">Todos</option>{(opcionesRapidas[x.codigo] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                </Selector></Campo>
              ))}
              {filtrosEsp ? <Boton variante="fantasma" onClick={() => { setRapidos({}); setBusqueda(""); }}>Quitar filtros ({filtrosEsp})</Boton> : null}
            </div>
            {esp.filtros.filter((x) => x.tipo === "botones").map((x) => (
              <div key={x.codigo} className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-ink-3 uppercase tracking-wide mr-1">{x.nombre}</span>
                <Chip activo={!rapidos[x.codigo]} onClick={() => setRapidos({ ...rapidos, [x.codigo]: "" })}>Todos</Chip>
                {(opcionesRapidas[x.codigo] ?? []).map((v) => {
                  const n = esp.filas.filter((r) => String(r[x.codigo]) === v).length;
                  return <Chip key={v} activo={rapidos[x.codigo] === v} onClick={() => setRapidos({ ...rapidos, [x.codigo]: rapidos[x.codigo] === v ? "" : v })}>{v} <span className="text-ink-3 font-normal">{n}</span></Chip>;
                })}
              </div>
            ))}
            <div className="mt-4">
              <Etiqueta>Columnas</Etiqueta>
              <div className="flex flex-wrap gap-1.5">{columnasEsp.map((c) => <Chip key={c.codigo} activo={activas.some((a) => a.codigo === c.codigo)} onClick={() => alternarColumna(c.codigo)}>{c.nombre}</Chip>)}</div>
            </div>
          </>
        ) : null}
      </Tarjeta>

      {tipo === "cuota" ? <CumplimientoCuota /> : (
        <Tarjeta titulo={
          <span>{nombre}
            <span className="text-ink-3 font-sans font-normal text-[13px] ml-2">
              {periodo ? `${periodo === "vencimiento" ? "vence " : ""}${fechaCorta(desde)} – ${fechaCorta(hasta)}` : `al ${fechaCorta(hoyLima())}`}
              {esp ? ` · ${numero(filasEsp.length)} ${filasEsp.length === 1 ? "registro" : "registros"}${filasEsp.length !== esp.filas.length ? ` de ${numero(esp.filas.length)}` : ""}` : res ? ` · ${numero(res.filas.length)} filas` : ""}
            </span>
          </span>
        }>
          {error ? <p className="px-5 pb-5 text-rojo text-sm">{error}</p> : cargando && !res && !esp ? <div className="p-5"><Cargando /></div> : res ? (
            res.filas.length ? (
              <div className="overflow-x-auto"><table className="tabla">
                <thead><tr><th>{res.agrupar.nombre}</th>{res.columnas.map((c) => <th key={c.codigo} className="num"><button onClick={() => setCfg({ ...cfg, orden: c.codigo })} className={cfg.orden === c.codigo ? "text-ink" : ""}>{c.nombre}</button></th>)}</tr></thead>
                <tbody>
                  {res.filas.map((x) => (
                    <tr key={x.grupo}>
                      <td className="min-w-[200px]"><div className="font-semibold">{x.grupo}</div>{primera ? <div className="barra mt-1.5 max-w-[240px]"><span style={{ width: `${(Math.abs(x.valores[primera.codigo] ?? 0) / maxPrimera) * 100}%` }} /></div> : null}</td>
                      {res.columnas.map((c) => <td key={c.codigo} className="num">{fmt(x.valores[c.codigo], c.unidad)}</td>)}
                    </tr>
                  ))}
                  {res.totales && res.filas.length > 1 ? <tr className="font-semibold"><td>Total</td>{res.columnas.map((c) => <td key={c.codigo} className="num">{fmt(res.totales![c.codigo], c.unidad)}</td>)}</tr> : null}
                </tbody>
              </table></div>
            ) : <Vacio titulo="Sin ventas en el periodo">Prueba con otro periodo o quita algún filtro.</Vacio>
          ) : esp ? (
            filasEsp.length ? (
              <div className="overflow-x-auto"><table className="tabla">
                <thead><tr>
                  {activas.map((c) => (
                    <th key={c.codigo} className={esNumero(c.tipo) ? "num" : ""}>
                      <button className="inline-flex items-center gap-1 uppercase" onClick={() => setOrden(orden?.col === c.codigo ? { col: c.codigo, asc: !orden.asc } : { col: c.codigo, asc: !esNumero(c.tipo) })}>
                        {c.nombre}{orden?.col === c.codigo ? (orden.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
                      </button>
                    </th>
                  ))}
                  {sel === "cierres-caja" ? <th className="no-imprimir" /> : null}
                </tr></thead>
                <tbody>{filasEsp.map((r, i) => (
                  <tr key={i}>
                    {activas.map((c, k) => <td key={c.codigo} className={`${esNumero(c.tipo) ? "num" : ""} ${k === 0 && c.tipo === "texto" ? "font-semibold" : ""}`}>{celda(c, r[c.codigo])}</td>)}
                    {sel === "cierres-caja" ? <td className="no-imprimir text-right"><Link className="text-petroleo-3 font-semibold text-sm" href={`/caja/reporte/${r.id}`}>Ver</Link></td> : null}
                  </tr>
                ))}</tbody>
                {activas.some((c) => SUMABLES.has(c.codigo)) && filasEsp.length > 1 ? (
                  <tfoot><tr className="font-semibold">
                    {activas.map((c, k) => <td key={c.codigo} className={esNumero(c.tipo) ? "num" : ""}>{SUMABLES.has(c.codigo) ? (c.tipo === "soles" || c.tipo === "diferencia" ? soles(filasEsp.reduce((s, r) => s + Number(r[c.codigo] ?? 0), 0)) : numero(filasEsp.reduce((s, r) => s + Number(r[c.codigo] ?? 0), 0))) : k === 0 ? "Total" : ""}</td>)}
                    {sel === "cierres-caja" ? <td className="no-imprimir" /> : null}
                  </tr></tfoot>
                ) : null}
              </table></div>
            ) : <Vacio titulo={esp.filas.length ? "Ningún registro coincide con los filtros" : "No hay registros"}>{esp.filas.length ? "Quita algún filtro o cambia la búsqueda." : periodo ? "Prueba con otro periodo." : undefined}</Vacio>
          ) : null}
          {res && !sel.startsWith("g") ? (
            <div className="no-imprimir flex flex-wrap gap-2 px-5 py-4 border-t border-foil">
              <Entrada className="max-w-xs" placeholder="Nombre para guardar este reporte" value={nombreGuardar} onChange={(e) => setNombreGuardar(e.target.value)} />
              <Boton variante="borde" disabled={nombreGuardar.trim().length < 3} onClick={guardar}><Save size={15} /> Guardar en Mis reportes</Boton>
            </div>
          ) : null}
        </Tarjeta>
      )}

      {u.roles.includes("ADMIN") ? (
        <Modal abierto={metricasAbierto} alCerrar={() => setMetricasAbierto(false)} titulo="Métricas" ancho="max-w-4xl">
          <NuevaMetrica base={info.datos.metricas.base} derivadas={info.datos.metricas.derivadas} alGuardar={info.recargar} />
        </Modal>
      ) : null}
    </div>
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
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <section className="space-y-3">
        <h3 className="font-semibold text-[15px]">Nueva métrica</h3>
        <Campo etiqueta="Nombre"><Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ventas con complemento por venta" /></Campo>
        <Campo etiqueta="Fórmula" ayuda="Usa + − × ÷ y paréntesis sobre las métricas base">
          <Entrada value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="ventas / tickets" className="font-mono text-[13.5px]" />
        </Campo>
        <div className="flex flex-wrap gap-1">{base.map((b) => <button key={b.codigo} onClick={() => setFormula((x) => `${x}${x && !/[\s(]$/.test(x) ? " " : ""}${b.codigo}`)} className="h-7 px-2 rounded-lg bg-foil text-[12px] font-mono hover:bg-foil-2" title={b.nombre}>{b.codigo}</button>)}</div>
        <Campo etiqueta="Unidad"><Selector value={unidad} onChange={(e) => setUnidad(e.target.value)}><option value="SOLES">Soles</option><option value="PORCENTAJE">Porcentaje</option><option value="UNIDADES">Unidades</option><option value="NUMERO">Número</option></Selector></Campo>
        <fieldset><legend className="text-[12.5px] font-semibold text-ink-2 mb-1.5">Quién la ve</legend>
          <div className="flex flex-wrap gap-1.5">{["ADMIN", "QF", "CONTADOR", "INVENTARIADOR"].map((r) => <button key={r} onClick={() => setRoles((rs) => rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r])} aria-pressed={roles.includes(r)} className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border ${roles.includes(r) ? "bg-petroleo text-white border-petroleo" : "border-foil-3 text-ink-2"}`}>{r === "ADMIN" ? "Admin" : r === "QF" ? "QF" : r[0] + r.slice(1).toLowerCase()}</button>)}</div>
        </fieldset>
        <label className="flex items-center justify-between text-sm"><span className="font-semibold text-ink-2">Mostrar como tarjeta en el panel</span><Interruptor activo={enPanel} alCambiar={() => setEnPanel(!enPanel)} etiqueta="Mostrar en el panel" /></label>
        {error ? <p className="text-sm text-rojo">{error}</p> : null}
        <Boton className="w-full" disabled={nombre.trim().length < 3 || !formula.trim()} onClick={guardar}>Guardar métrica</Boton>
      </section>
      <section>
        <h3 className="font-semibold text-[15px] mb-3">Métricas propias</h3>
        {derivadas.length ? (
          <ul className="space-y-2.5">{derivadas.map((d) => (
            <li key={d.codigo} className="flex items-start justify-between gap-2">
              <div><p className="font-semibold text-[13.5px]">{d.nombre} {d.sensible ? <Insignia tono="ambar">con costos</Insignia> : null}</p><p className="font-mono text-[12px] text-ink-3">{d.formula}</p></div>
              <button className="text-ink-3 hover:text-rojo mt-0.5" aria-label={`Eliminar ${d.nombre}`} onClick={async () => { await api(`/api/metricas?id=${d.id}`, { metodo: "DELETE" }); alGuardar(); }}><Trash size={14} /></button>
            </li>
          ))}</ul>
        ) : <p className="text-sm text-ink-3">Aún no hay métricas propias.</p>}
      </section>
    </div>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Reportes /></Suspense>; }
