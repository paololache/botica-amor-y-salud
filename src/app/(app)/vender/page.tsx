"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Minus, Plus, Trash, Sparkles, Printer, FileText, Eye, TrendingUp } from "lucide-react";
import { api, useDatos, soles, vence } from "@/lib/cliente";
import { Boton, Entrada, EntradaNumero, Insignia, Modal, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { BarraMeta } from "@/components/meta-dia";
import { mensajeMotivacional } from "@/lib/motivacion";
import type { MetaDia } from "@/lib/services/metas";

type Pres = { id: number; nombre: string; factor: number; pvp: number; pvpCampana?: number | null };
/** Precio que se cobra: el de campaña si la presentación lo tiene, si no el de lista. */
const precioDe = (p?: Pres) => (p ? p.pvpCampana ?? p.pvp : 0);
type Prod = {
  id: number; codigo: string; nombre: string; principioActivo: string | null; laboratorio: string | null; condicionVenta: string; ubicacion: string | null;
  stockVigente: number; proximoVencimiento: string | null; enPromocion: boolean; campana: { porcentaje: number } | null; presentaciones: Pres[]; presentacionEscaneadaId?: number; mensaje?: string | null;
};
type Item = { prod: Prod; presId: number; cantidad: number; origen: "DIRECTA" | "SUGERENCIA" };
type Medio = "EFECTIVO" | "YAPE" | "PLIN" | "TARJETA" | "TRANSFERENCIA";
type Resultado = { id: number; ref: string; total: number; vuelto: number; cpeEstado: string; comisionVenta: number; comisionHoy: number; comisionMes: number; tipoComprobante: string; subtotal: number; igv: number; meta: MetaDia | null };

const MEDIOS: { v: Medio; t: string }[] = [{ v: "EFECTIVO", t: "Efectivo" }, { v: "YAPE", t: "Yape" }, { v: "PLIN", t: "Plin" }, { v: "TARJETA", t: "Tarjeta" }, { v: "TRANSFERENCIA", t: "Transferencia" }];

/** Precio con el de lista tachado cuando hay precio de campaña. */
function Precio({ p, className = "" }: { p?: Pres; className?: string }) {
  if (!p) return null;
  if (p.pvpCampana == null) return <span className={className}>{soles(p.pvp)}</span>;
  return <span className={className}><s className="font-normal text-ink-3 text-[0.85em] mr-1">{soles(p.pvp)}</s><span className="text-amor-2">{soles(p.pvpCampana)}</span></span>;
}

function Tecla({ k }: { k: string }) {
  return <kbd className="inline-grid place-items-center min-w-6 h-5 px-1 rounded-md border border-foil-3 bg-papel text-[11px] font-semibold text-ink-2">{k}</kbd>;
}

export default function Vender() {
  const u = useUsuario();
  const avisar = useAviso();
  const caja = useDatos<{ sesion: { id: number; caja: string; estado: string } | null }>("/api/caja");
  const top = useDatos<(Prod & { tickets: number })[]>("/api/productos/mas-vendidos");
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Prod[]>([]);
  const [activo, setActivo] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [sugerencias, setSugerencias] = useState<Prod[]>([]);
  const [tipo, setTipo] = useState<"BOLETA" | "FACTURA" | "NOTA_VENTA">("BOLETA");
  const [cliente, setCliente] = useState({ numero: "", nombre: "" });
  const [conCliente, setConCliente] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [pagos, setPagos] = useState<{ medio: Medio; monto: string }[]>([{ medio: "EFECTIVO", monto: "" }]);
  const [enviando, setEnviando] = useState(false);
  const [errorCobro, setErrorCobro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const consulta = useRef("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const ultimoMensaje = useRef<string | null>(null);

  // Desde la alerta de campaña se llega con ?q=producto: se deja buscado para agregarlo de un toque.
  useEffect(() => {
    const inicial = new URLSearchParams(window.location.search).get("q");
    if (inicial) { setQ(inicial); window.history.replaceState(null, "", "/vender"); }
    // El recordatorio de campañas, estando ya en esta pantalla, pide la búsqueda por evento.
    const alBuscar = (e: Event) => setQ((e as CustomEvent<string>).detail);
    window.addEventListener("botica:buscar-producto", alBuscar);
    return () => window.removeEventListener("botica:buscar-producto", alBuscar);
  }, []);

  // Búsqueda con espera corta
  useEffect(() => {
    const t = q.trim();
    if (!t) { setResultados([]); return; }
    let vigente = true;
    const h = setTimeout(async () => {
      try {
        const r = await api<Prod[]>(`/api/productos?buscar=${encodeURIComponent(t)}`);
        if (vigente) { consulta.current = t; setResultados(r); setActivo(0); }
      } catch { /* sin resultados */ }
    }, 160);
    return () => { vigente = false; clearTimeout(h); };
  }, [q]);

  // Sugerencias complementarias según el carrito
  const idsCarrito = items.map((i) => i.prod.id).join(",");
  useEffect(() => {
    if (!idsCarrito) { setSugerencias([]); return; }
    api<Prod[]>("/api/productos/sugerencias", { cuerpo: { ids: idsCarrito.split(",").map(Number) } }).then(setSugerencias).catch(() => setSugerencias([]));
  }, [idsCarrito]);

  const sumarAlCarrito = useCallback((prod: Prod, presId?: number, origen: "DIRECTA" | "SUGERENCIA" = "DIRECTA") => {
    const pid = presId ?? prod.presentaciones[0]?.id;
    if (!pid) return;
    setItems((xs) => {
      const i = xs.findIndex((x) => x.prod.id === prod.id && x.presId === pid);
      if (i >= 0) return xs.map((x, k) => (k === i ? { ...x, cantidad: x.cantidad + 1 } : x));
      return [...xs, { prod, presId: pid, cantidad: 1, origen }];
    });
  }, []);

  const agregar = useCallback((prod: Prod, presId?: number, origen: "DIRECTA" | "SUGERENCIA" = "DIRECTA") => {
    sumarAlCarrito(prod, presId, origen);
    setQ(""); setResultados([]);
    buscador.current?.focus();
  }, [sumarAlCarrito]);

  // El lector envía Enter antes de que termine la búsqueda: el campo se libera ya para el siguiente escaneo
  // y solo un código exacto entra al carrito; un texto a medio buscar vuelve al campo.
  const escanear = async (t: string) => {
    setQ(""); setResultados([]);
    try {
      const r = await api<Prod[]>(`/api/productos?buscar=${encodeURIComponent(t)}`);
      const exacto = r.find((x) => x.codigo === t || x.presentacionEscaneadaId);
      if (exacto) sumarAlCarrito(exacto, exacto.presentacionEscaneadaId);
      else setQ((actual) => actual || t);
    } catch { setQ((actual) => actual || t); }
  };

  const lineas = useMemo(() => items.map((it) => {
    const p = it.prod.presentaciones.find((x) => x.id === it.presId)!;
    return { ...it, pres: p, subtotal: Math.round(precioDe(p) * it.cantidad * 100) / 100, unidades: it.cantidad * p.factor };
  }), [items]);
  const total = Math.round(lineas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
  const esAdmin = u.roles.includes("ADMIN");
  const requiereDoc = tipo === "FACTURA" || (tipo === "BOLETA" && total > 700);
  const pagado = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const vuelto = Math.max(0, Math.round((pagado - total) * 100) / 100);

  const nueva = useCallback(() => {
    setItems([]); setQ(""); setTipo("BOLETA"); setCliente({ numero: "", nombre: "" }); setConCliente(false); setResultado(null); setCobrando(false);
    setErrorCobro(null);
    setTimeout(() => buscador.current?.focus(), 50);
  }, []);

  const abrirCobro = useCallback(() => {
    if (!items.length) return;
    setPagos([{ medio: "EFECTIVO", monto: "" }]); setErrorCobro(null); setCobrando(true);
  }, [items.length]);

  const cobrar = async () => {
    setEnviando(true); setErrorCobro(null);
    try {
      const pagosOk = pagos.filter((p) => Number(p.monto) > 0).map((p) => ({ medio: p.medio, monto: Number(p.monto) }));
      // Un solo medio sin monto escrito: se cobra el total con el medio elegido (Yape, Plin, tarjeta…), no en efectivo.
      if (!pagosOk.length) pagosOk.push({ medio: pagos.length === 1 ? pagos[0].medio : "EFECTIVO", monto: total });
      const r = await api<Resultado>("/api/ventas", { cuerpo: {
        items: items.map((i) => ({ presentacionId: i.presId, cantidad: i.cantidad, descuentoPct: 0, origen: i.origen })),
        tipoComprobante: tipo, pagos: pagosOk,
        cliente: requiereDoc || cliente.numero.trim() ? { tipoDoc: cliente.numero.length === 11 ? "RUC" : "DNI", numero: cliente.numero, nombre: cliente.nombre || "Cliente" } : undefined,
      } });
      const m = mensajeMotivacional(r.meta, u.nombre, r.total, ultimoMensaje.current);
      ultimoMensaje.current = m; setMensaje(m);
      setResultado(r); setCobrando(false);
      if (r.comisionVenta > 0) avisar("ok", `Ganaste ${soles(r.comisionVenta)} de comisión con esta venta.`);
    } catch (e) {
      setErrorCobro((e as Error).message);
    } finally { setEnviando(false); }
  };

  // Atajos de teclado del punto de venta
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); nueva(); }
      else if (e.key === "F3") { e.preventDefault(); buscador.current?.focus(); }
      else if (e.key === "F7") { e.preventDefault(); if (sugerencias[0]) agregar(sugerencias[0], undefined, "SUGERENCIA"); }
      else if (e.key === "F8") { e.preventDefault(); if (cobrando) cobrar(); else abrirCobro(); }
      else if (e.key === "F9") { e.preventDefault(); const pa = items[items.length - 1]?.prod.principioActivo; if (pa) { setQ(pa); buscador.current?.focus(); } }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const sinCaja = caja.datos && (!caja.datos.sesion || caja.datos.sesion.estado !== "ABIERTA");

  if (sinCaja) {
    return (
      <div className="max-w-xl mx-auto mt-10 tarjeta">
        <Vacio titulo="Abre tu caja para vender" accion={<Link href="/caja"><Boton variante="amor">Abrir caja</Boton></Link>}>
          {caja.datos?.sesion?.estado === "EN_CIERRE" ? "Tu cierre espera la validación del administrador." : "Cada venta se registra en tu sesión de caja, así el cierre de caja cuadra al final del turno."}
        </Vacio>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-semibold text-[26px]">Vender</h1>
          {caja.datos?.sesion ? <Insignia tono="ok">{caja.datos.sesion.caja} abierta</Insignia> : null}
        </div>
        <div className="hidden md:flex items-center gap-3 text-[12.5px] text-ink-2">
          <span className="flex items-center gap-1.5"><Tecla k="F2" /> Nueva</span>
          <span className="flex items-center gap-1.5"><Tecla k="F3" /> Buscar</span>
          <span className="flex items-center gap-1.5"><Tecla k="F7" /> Complemento</span>
          <span className="flex items-center gap-1.5"><Tecla k="F8" /> Cobrar</span>
          <span className="flex items-center gap-1.5"><Tecla k="F9" /> Sustitutos</span>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="min-w-0 space-y-4">
          <div className="relative">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
            <input ref={buscador} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(a + 1, resultados.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
                if (e.key === "Enter" && q.trim()) {
                  e.preventDefault();
                  if (resultados[activo] && consulta.current === q.trim()) agregar(resultados[activo], resultados[activo].presentacionEscaneadaId);
                  else escanear(q.trim());
                }
                if (e.key === "Escape") { setQ(""); setResultados([]); }
              }}
              placeholder="Buscar producto por nombre, código o principio activo"
              aria-label="Buscar producto" role="combobox" aria-expanded={resultados.length > 0} aria-controls="resultados"
              className="w-full h-14 pl-12 pr-4 rounded-2xl border-2 border-foil-3 bg-papel text-[16px] focus:border-vino-2 focus:outline-none focus:ring-4 focus:ring-rosado/40" />
            {resultados.length ? (
              <ul id="resultados" role="listbox" className="aparecer absolute z-20 left-0 right-0 mt-2 tarjeta shadow-2xl max-h-[min(560px,65vh)] overflow-y-auto">
                {resultados.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === activo} onMouseEnter={() => setActivo(i)}
                    className={`px-4 sm:px-5 py-3.5 ${i ? "border-t border-foil" : ""} ${i === activo ? "bg-foil/60" : ""}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[15px] leading-snug">{r.nombre}</div>
                        <div className="text-[12.5px] text-ink-2 mt-0.5 truncate">{[r.principioActivo, r.laboratorio, r.ubicacion].filter(Boolean).join(" · ") || r.codigo}</div>
                        {r.enPromocion ? <div className="flex flex-wrap gap-1.5 mt-1.5"><Insignia tono="amor">En promoción</Insignia></div> : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-[13.5px] font-semibold ${r.stockVigente ? "text-ink" : "text-rojo"}`}>{r.stockVigente ? `${r.stockVigente} und.` : "Sin stock"}</div>
                        {r.proximoVencimiento ? <div className="text-[12px] text-ink-3 mt-0.5">Vence {vence(r.proximoVencimiento)}</div> : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 mt-3">
                      {r.presentaciones.map((p) => (
                        <button key={p.id} disabled={r.stockVigente < p.factor} onClick={() => agregar(r, p.id)}
                          className="h-11 px-3 rounded-xl border border-foil-3 bg-papel hover:border-vino-2 hover:bg-foil/50 flex items-center justify-between gap-2 disabled:opacity-35 disabled:hover:border-foil-3">
                          <span className="text-[12.5px] text-ink-2 truncate">{p.nombre}</span>
                          <Precio p={p} className="text-[14px] font-semibold tabular-nums" />
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {top.datos?.length ? (
            <section className="tarjeta p-4" aria-labelledby="t-top">
              <h2 id="t-top" className="flex items-center gap-2 font-display font-semibold text-[14.5px]"><TrendingUp size={16} className="text-amor" /> Más vendidos</h2>
              <p className="text-[12px] text-ink-3 mt-0.5">Últimos 30 días. Toca uno para agregarlo.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-2 mt-3">
                {top.datos.map((p) => {
                  const enCarrito = items.filter((x) => x.prod.id === p.id).reduce((s, x) => s + x.cantidad, 0);
                  return (
                    <button key={p.id} onClick={() => agregar(p)} title={p.nombre}
                      className={`relative min-w-0 text-left rounded-xl border px-3 py-2 transition hover:border-vino-2 hover:bg-foil/50 ${enCarrito ? "border-amor/50 bg-amor-claro/40" : "border-foil-3 bg-papel"}`}>
                      <span className="block font-semibold text-[13px] leading-snug line-clamp-2">{p.nombre}</span>
                      <span className="flex items-center justify-between gap-2 mt-1 text-[12px]">
                        <span className="font-semibold tabular-nums"><Precio p={p.presentaciones[0]} /><span className="font-normal text-ink-3"> · {p.presentaciones[0].nombre}</span></span>
                        <span className="text-ink-3 shrink-0">{p.stockVigente} und.</span>
                      </span>
                      {enCarrito ? <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 grid place-items-center rounded-full bg-amor text-white text-[11px] font-semibold">{enCarrito}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="tarjeta overflow-x-auto">
            {lineas.length ? (
              <table className="tabla">
                <thead><tr><th className="min-w-[200px] w-full">Producto</th><th>Presentación</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Subtotal</th><th /></tr></thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={`${l.prod.id}-${l.presId}`} className="aparecer">
                      <td>
                        <div className="font-semibold">{l.prod.nombre}</div>
                        <div className="flex gap-1.5 mt-1">
                          {l.origen === "SUGERENCIA" ? <Insignia tono="azul">Complemento</Insignia> : null}
                          {l.prod.enPromocion ? <Insignia tono="amor">{esAdmin ? "Campaña" : "Comisiona"}</Insignia> : null}
                        </div>
                      </td>
                      <td>
                        <select value={l.presId} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, presId: Number(e.target.value) } : x)))} className="h-9 rounded-lg border border-foil-3 bg-papel px-2 text-[13.5px]" aria-label="Presentación">
                          {l.prod.presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
                      <td className="num">
                        <div className="inline-flex items-center gap-1">
                          <button className="size-8 grid place-items-center rounded-lg hover:bg-foil" aria-label="Menos" onClick={() => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x)))}><Minus size={15} /></button>
                          <EntradaNumero crudo value={l.cantidad} inputMode="numeric" aria-label="Cantidad" onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, cantidad: Math.max(1, parseInt(e.target.value) || 1) } : x)))} className="w-12 h-8 text-center rounded-lg border border-foil-3 font-semibold" />
                          <button className="size-8 grid place-items-center rounded-lg hover:bg-foil" aria-label="Más" onClick={() => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, cantidad: x.cantidad + 1 } : x)))}><Plus size={15} /></button>
                        </div>
                        {l.unidades > l.prod.stockVigente ? <div className="text-[11.5px] text-rojo mt-1">Solo hay {l.prod.stockVigente} und.</div> : null}
                      </td>
                      <td className="num whitespace-nowrap"><Precio p={l.pres} /></td>
                      <td className="num font-semibold">{soles(l.subtotal)}</td>
                      <td><button onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))} className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-rojo hover:bg-rojo-claro" aria-label="Quitar"><Trash size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-16 text-center">
                <Search size={36} className="mx-auto text-foil-3" />
                <p className="font-display font-semibold mt-4">Busca o elige el primer producto</p>
                <p className="text-sm text-ink-2 mt-1">El lote se asigna solo: primero el que vence antes.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6">
          {sugerencias.length ? (
            <section className="rounded-[18px] border border-amor/25 bg-[linear-gradient(170deg,#fff6f9,#fff)] p-4 aparecer" aria-labelledby="t-sug">
              <h2 id="t-sug" className="flex items-center gap-2 font-display font-semibold text-[14.5px] text-amor-2"><Sparkles size={16} /> Complementa la compra</h2>
              <ul className="mt-3 space-y-2">
                {sugerencias.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl bg-papel border border-foil-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[13.5px] truncate">{s.nombre}</div>
                      <div className="text-[12px] text-ink-3">{s.mensaje ?? "Sugerido"}{s.enPromocion ? " · en promoción" : ""}</div>
                    </div>
                    <Boton tam="sm" variante={i === 0 ? "amor" : "borde"} onClick={() => agregar(s, undefined, "SUGERENCIA")}>{i === 0 ? "F7 · " : ""}{soles(precioDe(s.presentaciones[0]))}</Boton>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="tarjeta p-5">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-foil" role="radiogroup" aria-label="Comprobante">
              {(["BOLETA", "FACTURA", "NOTA_VENTA"] as const).map((t) => (
                <button key={t} role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={`h-9 rounded-lg text-[13px] font-semibold ${tipo === t ? "bg-papel shadow-sm" : "text-ink-2"}`}>{t === "NOTA_VENTA" ? "Nota de venta" : t[0] + t.slice(1).toLowerCase()}</button>
              ))}
            </div>
            {requiereDoc || conCliente ? (
              <div className="grid grid-cols-[1fr_1.4fr] gap-2 mt-3">
                <EntradaNumero placeholder={tipo === "FACTURA" ? "RUC" : "DNI"} inputMode="numeric" value={cliente.numero} onChange={(e) => setCliente({ ...cliente, numero: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
                <Entrada placeholder={tipo === "FACTURA" ? "Razón social" : "Nombre"} value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} />
              </div>
            ) : (
              <button className="mt-3 text-[13px] text-petroleo-3 font-semibold" onClick={() => setConCliente(true)}>+ Agregar DNI del cliente</button>
            )}
            {requiereDoc ? <p className="text-[12px] text-ink-3 mt-1.5">{tipo === "FACTURA" ? "La factura exige RUC de 11 dígitos." : "Boleta mayor a S/ 700: se requiere DNI."}</p> : null}
            <div className="mt-5 pt-4 border-t border-foil space-y-1.5 text-[13.5px]">
              <div className="flex justify-between text-ink-2"><span>Op. gravada</span><span>{soles(total / 1.18)}</span></div>
              <div className="flex justify-between text-ink-2"><span>IGV 18%</span><span>{soles(total - total / 1.18)}</span></div>
            </div>
            <div className="flex items-end justify-between mt-3">
              <span className="font-semibold text-ink-2">Total</span>
              <span className="cifra text-[40px] leading-none">{soles(total)}</span>
            </div>
            <Boton variante="amor" tam="lg" className="w-full mt-5" disabled={!items.length} onClick={abrirCobro}>Cobrar <Tecla k="F8" /></Boton>
          </section>
        </aside>
      </div>

      <Modal abierto={cobrando} alCerrar={() => setCobrando(false)} titulo={`Cobrar ${soles(total)}`} ancho="max-w-2xl">
        <div className="space-y-3">
          {pagos.map((p, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <div className="flex gap-1 flex-wrap">
                {MEDIOS.map((m) => (
                  <button key={m.v} onClick={() => setPagos((ps) => ps.length === 1
                    // Un solo medio: Yape, Plin, tarjeta o transferencia se llenan con el total (no dan vuelto); en efectivo se deja libre para calcular el vuelto.
                    ? [{ medio: m.v, monto: m.v === "EFECTIVO" ? "" : total.toFixed(2) }]
                    : ps.map((x, k) => (k === i ? { ...x, medio: m.v } : x)))}
                    className={`h-9 px-3 rounded-xl text-[13px] font-semibold border ${p.medio === m.v ? "bg-petroleo text-white border-petroleo" : "bg-papel border-foil-3 text-ink-2"}`}>{m.t}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
              <EntradaNumero autoFocus={i === 0} inputMode="decimal" placeholder={i === 0 ? total.toFixed(2) : "0.00"} value={p.monto} onChange={(e) => setPagos((ps) => ps.map((x, k) => (k === i ? { ...x, monto: e.target.value.replace(",", ".") } : x)))} className="w-32 text-right font-semibold" aria-label="Monto" />
              {pagos.length > 1 ? (
                <button onClick={() => setPagos((ps) => ps.filter((_, k) => k !== i))} className="size-10 grid place-items-center rounded-xl text-ink-3 hover:text-rojo hover:bg-rojo-claro" aria-label={`Quitar pago ${i + 1}`} title="Quitar este pago"><Trash size={16} /></button>
              ) : null}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {pagos[0]?.medio === "EFECTIVO" ? [total, 10, 20, 50, 100, 200].filter((v, i) => i === 0 || v > total).slice(0, 4).map((v, i) => (
              <button key={i} onClick={() => setPagos((ps) => ps.map((x, k) => (k === 0 ? { ...x, monto: v.toFixed(2) } : x)))} className="h-8 px-3 rounded-full bg-foil text-[13px] font-semibold hover:bg-foil-2">{i === 0 ? "Exacto" : soles(v)}</button>
            )) : null}
            {pagos.length < 3 ? <button onClick={() => setPagos((ps) => [...ps, { medio: "YAPE", monto: Math.max(0, total - pagado).toFixed(2) }])} className="h-8 px-3 rounded-full border border-dashed border-foil-3 text-[13px] text-ink-2">+ Pago mixto</button> : null}
          </div>
          <div className="flex items-end justify-between rounded-2xl bg-foil px-4 py-3">
            <div><p className="text-[12.5px] text-ink-2">Recibido</p><p className="font-semibold">{soles(pagado || total)}</p></div>
            <div className="text-right"><p className="text-[12.5px] text-ink-2">Vuelto</p><p className="cifra text-[28px] leading-none text-petroleo">{soles(vuelto)}</p></div>
          </div>
          {errorCobro ? <p className="text-sm text-rojo" role="alert">{errorCobro}</p> : null}
          <Boton variante="amor" tam="lg" className="w-full" cargando={enviando} onClick={cobrar}>Emitir {tipo === "NOTA_VENTA" ? "nota de venta" : tipo.toLowerCase()} <Tecla k="F8" /></Boton>
        </div>
      </Modal>

      <Modal abierto={!!resultado} alCerrar={nueva} titulo="Venta registrada">
        {resultado ? (
          <div>
            <div className="rounded-2xl border border-dashed border-foil-3 p-5 text-center">
              <p className="sello mx-auto">{resultado.ref}</p>
              <p className="cifra text-[42px] mt-3">{soles(resultado.total)}</p>
              <p className="text-ink-2 text-sm">Vuelto: <b>{soles(resultado.vuelto)}</b></p>
            </div>
            {mensaje ? (
              <div className="mt-4 rounded-2xl bg-[linear-gradient(160deg,#fff6f9,#fff)] border border-amor/20 px-4 py-3.5" aria-live="polite">
                <p className="font-display font-semibold text-[15px] text-amor-2 leading-snug">{mensaje}</p>
                {resultado.meta ? <div className="mt-3"><BarraMeta meta={resultado.meta} compacta /></div> : null}
              </div>
            ) : null}
            {resultado.comisionVenta > 0 ? (
              <div className="mt-4 rounded-2xl bg-amor-claro px-4 py-3 flex justify-between items-center text-sm">
                <span className="text-amor-2 font-semibold">+{soles(resultado.comisionVenta)} de comisión</span>
                <span className="text-ink-2">Hoy {soles(resultado.comisionHoy)} · Mes {soles(resultado.comisionMes)}</span>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2 mt-5">
              <Boton variante="borde" onClick={() => window.open(`/comprobante/${resultado.id}?formato=ticket`, "_blank")}><Eye size={16} /> Ver</Boton>
              <Boton variante="borde" onClick={() => window.open(`/comprobante/${resultado.id}?formato=ticket&imprimir=1`, "_blank")}><Printer size={16} /> Imprimir</Boton>
              <Boton variante="borde" onClick={() => window.open(`/comprobante/${resultado.id}?formato=a4&imprimir=1`, "_blank")}><FileText size={16} /> A4</Boton>
            </div>
            <Boton variante="amor" className="w-full mt-2" autoFocus onClick={nueva}>Nueva venta <Tecla k="F2" /></Boton>
            <p className="text-[12px] text-ink-3 text-center mt-3">Esta venta también queda en Ventas, donde puedes volver a ver o imprimir el comprobante.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
