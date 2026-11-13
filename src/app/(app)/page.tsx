"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { api, useDatos, soles, numero, fechaHora } from "@/lib/cliente";
import { Blister, type Conteo } from "@/components/blister";
import { Boton, Cargando, Insignia, Modal, Entrada, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { ICONOS, useUsuario } from "@/components/shell";
import { BarraCuotaMes, BarraMeta } from "@/components/meta-dia";
import type { AvanceMes, MetaDia } from "@/lib/services/metas";
import { HistoricoVentas } from "@/components/historico-ventas";
import { ProductosMasVendidos, VentasMensuales } from "@/components/reportes-panel";
import { puede, tieneRol } from "@/lib/permisos";

type Alerta = { id: number; tipo: string; severidad: string; titulo: string; detalle: string; referenciaTipo: string | null; referenciaId: number | null; creadaEn: string };
type Panel = {
  hoy: string;
  ventas: { dia: { total: number; tickets: number }; mes: { total: number; tickets: number }; ayer: number; propias: boolean };
  alertas: { conteos: Conteo[] };
  caja: { sesion: { id: number; caja: string; turno: string; abiertaEn: string; estado: string } | null; resumen: { tickets: number } | null } | null;
  comisiones: { hoy: number; mes: number; lineasHoy: number } | null;
  tarjetas: { codigo: string; nombre: string; unidad: string; valor: number | null }[];
  accesos: { href: string; texto: string; visitas: number }[];
  meta: MetaDia | null;
  cuota: (AvanceMes & { deBotica: boolean }) | null;
};

const ACCIONES: Record<string, { texto: string; accion?: string; enlace?: (a: Alerta) => string }[]> = {
  AGOTADO: [{ texto: "Marcar pedido", accion: "ORDEN_COMPRA" }, { texto: "Ver sugerido", enlace: () => "/reportes?r=stock-critico" }],
  POR_TERMINARSE: [{ texto: "Marcar pedido", accion: "ORDEN_COMPRA" }, { texto: "Ver sugerido", enlace: () => "/reportes?r=stock-critico" }],
  BAJO_MINIMO: [{ texto: "Marcar pedido", accion: "ORDEN_COMPRA" }],
  POR_VENCER: [{ texto: "Devolver", accion: "DEVOLVER_PROVEEDOR" }, { texto: "Revisado", accion: "REVISADO" }],
  VENCIDO: [{ texto: "Crear baja", accion: "BAJA_VENCIMIENTO" }],
  DIF_CAJA: [{ texto: "Ver cierre", enlace: (a) => `/caja/reporte/${a.referenciaId}` }, { texto: "Revisado", accion: "REVISADO" }],
  CAJA_ABIERTA: [{ texto: "Revisado", accion: "REVISADO" }],
  CPE_PENDIENTE: [{ texto: "Ver ventas", enlace: () => "/ventas" }],
  CAMPANA_POR_VENCER: [{ texto: "Ver campañas", enlace: () => "/campanas" }],
  CAMPANA_ACTIVA: [{ texto: "Vender", enlace: (a) => `/vender?q=${encodeURIComponent(a.titulo)}` }],
  SALIDA_PENDIENTE: [{ texto: "Revisar", enlace: () => "/movimientos" }],
  TRANSFERENCIA_PENDIENTE: [{ texto: "Aprobar", enlace: () => "/transferencias" }],
  SIN_ROTACION: [{ texto: "Revisado", accion: "REVISADO" }],
};

function saludo() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "2-digit", hour12: false }).format(new Date())) % 24;
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function PanelPrincipal() {
  const u = useUsuario();
  const avisar = useAviso();
  const { datos, cargando, recargar, error } = useDatos<Panel>("/api/panel");
  const [tipo, setTipo] = useState<string | null>(null);
  const [posponer, setPosponer] = useState<Alerta | null>(null);
  const [todas, setTodas] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const conteos = datos?.alertas.conteos ?? [];
  const hayAlertas = conteos.some((c) => c.total > 0);
  // Si se atendió la última alerta del tipo, su tarjeta queda deshabilitada: se vuelve a ver todo.
  const tipoActivo = conteos.some((c) => c.tipo === tipo && c.total > 0) ? tipo : null;
  const total = conteos.filter((c) => !tipoActivo || c.tipo === tipoActivo).reduce((s, c) => s + c.total, 0);
  // La lista se pide después del panel, que es quien recalcula las alertas.
  const lista = useDatos<{ alertas: Alerta[] }>(datos ? `/api/alertas${tipoActivo ? `?tipo=${tipoActivo}` : ""}` : null);
  const esStock = !!tipoActivo && ["AGOTADO", "POR_TERMINARSE", "BAJO_MINIMO"].includes(tipoActivo);
  const texto = esStock ? busqueda.trim().toLowerCase() : "";
  const alertas = useMemo(() => (lista.datos?.alertas ?? []).filter((a) => (!tipoActivo || a.tipo === tipoActivo) && (!texto || `${a.titulo} ${a.detalle}`.toLowerCase().includes(texto))), [lista.datos, tipoActivo, texto]);

  const atender = async (a: Alerta, accion: string, comentario?: string) => {
    try {
      const r = await api<{ documento: { id: number } | null }>(`/api/alertas/${a.id}/atender`, { cuerpo: { accion, comentario } });
      avisar("ok", r.documento ? `Borrador MOV-${String(r.documento.id).padStart(5, "0")} enviado a aprobación.` : accion === "POSPONER" ? "Alerta pospuesta 24 horas." : "Alerta atendida.");
      await recargar();
      await lista.recargar();
    } catch (e) { avisar("error", (e as Error).message); }
  };

  const nombre = u.nombre.replace(/^Q\.F\.\s*/, "").split(" ")[0];
  const variacion = datos && datos.ventas.ayer > 0 ? ((datos.ventas.dia.total - datos.ventas.ayer) / datos.ventas.ayer) * 100 : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-ink-3 text-sm first-letter:uppercase">{new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
          <h1 className="font-display font-semibold text-[28px] md:text-[34px] leading-tight mt-1">{saludo()}, {nombre}</h1>
        </div>
      </div>

      {datos?.accesos.length ? (
        <nav aria-label="Accesos rápidos" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
          {datos.accesos.map((a, i) => {
            const I = ICONOS[a.href];
            return (
              <Link key={a.href} href={a.href}
                className={`flex items-center gap-3 h-16 px-4 rounded-2xl font-semibold text-[15px] transition active:translate-y-px ${i === 0 ? "bg-amor text-white hover:bg-amor-2 shadow-[0_8px_18px_-10px_rgba(226,69,122,.9)]" : "bg-papel border border-foil-3 text-ink hover:border-vino-2"}`}>
                {I ? <I size={22} className={i === 0 ? "" : "text-amor"} aria-hidden /> : null}
                <span className="truncate">{a.texto}</span>
              </Link>
            );
          })}
        </nav>
      ) : cargando ? <div className="mb-7"><Cargando alto="h-16" /></div> : null}

      {error ? <p className="text-rojo">{error}</p> : null}
      <div className="grid xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] gap-6">
        <div className="space-y-6 min-w-0">
          {hayAlertas ? (
            <section aria-labelledby="t-alertas">
              <div className="flex items-baseline justify-between mb-3">
                <h2 id="t-alertas" className="font-display font-semibold text-[17px]">Lo que necesita atención</h2>
                <span className="text-[12.5px] text-ink-3">Se actualiza al abrir el panel</span>
              </div>
              <Blister conteos={conteos} seleccion={tipoActivo} alElegir={(t) => { setTipo(t); setTodas(false); }} />
            </section>
          ) : cargando ? <Cargando alto="h-72" /> : null}

          {hayAlertas ? (
            <Tarjeta titulo={tipoActivo ? conteos.find((c) => c.tipo === tipoActivo)?.nombre : "Todas las alertas"} accion={<span className="text-[12.5px] text-ink-3">{total} {total === 1 ? "alerta" : "alertas"}</span>}>
              {lista.error ? <p className="px-5 pb-5 text-sm text-rojo">{lista.error}</p> : null}
              {esStock ? <div className="px-5 pb-3"><Entrada aria-label="Buscar por código o nombre" placeholder="Buscar por código o nombre de producto" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setTodas(false); }} /></div> : null}
              {alertas.length ? (
                <ul className="divide-y divide-foil">
                  {(todas ? alertas : alertas.slice(0, 8)).map((a) => (
                    <li key={a.id} className="aparecer flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <span className={`size-2.5 rounded-full shrink-0 ${a.severidad === "CRITICA" ? "bg-rojo" : a.severidad === "ALTA" ? "bg-ambar" : "bg-[#5a9bc0]"}`} aria-label={a.severidad} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[14.5px] truncate">{a.titulo}</div>
                        <div className="text-[13px] text-ink-2">{a.detalle}</div>
                      </div>
                      <div className="flex gap-1.5">
                        {(ACCIONES[a.tipo] ?? []).map((ac) => ac.enlace
                          ? <Link key={ac.texto} href={ac.enlace(a)}><Boton tam="sm" variante="borde">{ac.texto}</Boton></Link>
                          : <Boton key={ac.texto} tam="sm" variante="borde" onClick={() => atender(a, ac.accion!)}>{ac.texto}</Boton>)}
                        {a.tipo !== "CAMPANA_ACTIVA" ? <Boton tam="sm" variante="fantasma" onClick={() => { setPosponer(a); setMotivo(""); }}>Posponer</Boton> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {alertas.length > 8 ? (
                <div className="px-5 py-3 border-t border-foil flex flex-wrap items-center justify-between gap-2">
                  <Boton tam="sm" variante="fantasma" onClick={() => setTodas(!todas)}>{todas ? "Ver menos" : `Ver ${alertas.length - 8} más`}</Boton>
                  {todas && total > alertas.length ? <span className="text-[12.5px] text-ink-3">Se muestran las {alertas.length} más urgentes de {total}</span> : null}
                </div>
              ) : null}
              {alertas.length ? null : lista.error ? null : texto ? <Vacio titulo="Ningún producto coincide con la búsqueda" /> : total > 0 ? <div className="px-5 pb-5"><Cargando /></div> : <Vacio titulo="Nada pendiente aquí">Cuando aparezca algo urgente lo verás en el resumen de arriba.</Vacio>}
            </Tarjeta>
          ) : null}

          {puede(u.roles, "ventas.ver") ? <HistoricoVentas /> : null}
        </div>

        <div className="space-y-6">
          {datos ? (
            <Tarjeta className="p-5">
              <p className="text-[13px] font-semibold text-ink-2">{datos.ventas.propias ? "Tus ventas de hoy" : "Ventas de hoy"}</p>
              <p className="cifra text-[44px] leading-none mt-2">{soles(datos.ventas.dia.total)}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3 text-[13px] text-ink-2">
                <span>{numero(datos.ventas.dia.tickets)} {datos.ventas.dia.tickets === 1 ? "venta" : "ventas"}</span>
                {variacion !== null ? <Insignia tono={variacion >= 0 ? "ok" : "ambar"}>{variacion >= 0 ? "+" : ""}{variacion.toFixed(0)}% vs. ayer</Insignia> : null}
              </div>
              {datos.meta?.objetivo ? <div className="mt-4"><BarraMeta meta={datos.meta} /></div> : null}
              {datos.cuota ? <div className="mt-4"><BarraCuotaMes cuota={datos.cuota} titulo={datos.cuota.deBotica ? "Cuota del mes de la botica" : "Tu cuota del mes"} /></div> : null}
              <div className="mt-5 pt-4 border-t border-foil flex justify-between text-[13.5px]">
                <span className="text-ink-2">En el mes</span><span className="font-semibold">{soles(datos.ventas.mes.total)}</span>
              </div>
            </Tarjeta>
          ) : <Cargando />}

          {datos?.comisiones ? (
            <Tarjeta className="p-5 bg-[linear-gradient(160deg,#fff,#fdf0f5)]">
              <p className="text-[13px] font-semibold text-ink-2">Tu comisión</p>
              <div className="flex items-end justify-between gap-3 mt-2">
                <div><p className="cifra text-[34px] leading-none text-amor-2">{soles(datos.comisiones.hoy)}</p><p className="text-[12.5px] text-ink-3 mt-1.5">hoy · {datos.comisiones.lineasHoy} productos en promoción</p></div>
                <div className="text-right"><p className="font-semibold">{soles(datos.comisiones.mes)}</p><p className="text-[12px] text-ink-3">acumulado del mes</p></div>
              </div>
              <p className="text-[12.5px] text-ink-2 mt-4">Se paga al cierre de mes.</p>
            </Tarjeta>
          ) : null}

          {datos?.caja ? (
            <Tarjeta className="p-5">
              <div className="flex items-center gap-3">
                <span className={`size-10 rounded-xl grid place-items-center ${datos.caja.sesion ? "bg-ok-claro text-ok" : "bg-foil text-ink-3"}`}><Wallet size={19} /></span>
                <div className="flex-1">
                  <p className="font-semibold">{datos.caja.sesion ? `${datos.caja.sesion.caja} abierta` : "Caja cerrada"}</p>
                  <p className="text-[13px] text-ink-2">{datos.caja.sesion ? `Turno ${datos.caja.sesion.turno.toLowerCase()} · desde ${fechaHora(datos.caja.sesion.abiertaEn)} · ${datos.caja.resumen?.tickets ?? 0} ${(datos.caja.resumen?.tickets ?? 0) === 1 ? "venta" : "ventas"}` : "Ábrela para empezar a vender"}</p>
                </div>
                <Link href="/caja"><Boton tam="sm" variante={datos.caja.sesion ? "borde" : "petroleo"}>{datos.caja.sesion ? "Ver" : "Abrir caja"}</Boton></Link>
              </div>
            </Tarjeta>
          ) : null}

          {datos?.tarjetas.length ? (
            <div className="grid grid-cols-2 gap-3">
              {datos.tarjetas.map((t) => (
                <div key={t.codigo} className="tarjeta p-4">
                  <p className="text-[12.5px] text-ink-2 font-semibold">{t.nombre}</p>
                  <p className="cifra text-[24px] mt-1.5">{t.valor === null ? "—" : t.unidad === "SOLES" ? soles(t.valor) : t.unidad === "PORCENTAJE" ? `${numero(t.valor, 1)}%` : numero(t.valor, 1)}</p>
                  <p className="text-[11.5px] text-ink-3">hoy</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Reportes al pie: el administrador ve la botica completa; quien vende, lo suyo y su cuota. */}
      {puede(u.roles, "ventas.ver") ? (
        <section aria-label="Reportes de ventas" className="grid xl:grid-cols-2 gap-6 mt-6 [&>*]:min-w-0">
          <VentasMensuales />
          <ProductosMasVendidos />
        </section>
      ) : null}

      <Modal abierto={!!posponer} alCerrar={() => setPosponer(null)} titulo="Posponer alerta">
        <p className="text-sm text-ink-2 mb-4">{posponer?.titulo} volverá a aparecer en 24 horas.</p>
        <Entrada autoFocus placeholder="¿Por qué la pospones?" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div className="flex justify-end gap-2 mt-5">
          <Boton variante="fantasma" onClick={() => setPosponer(null)}>Cancelar</Boton>
          <Boton disabled={motivo.trim().length < 3} onClick={async () => { if (posponer) await atender(posponer, "POSPONER", motivo); setPosponer(null); }}>Posponer 24 horas</Boton>
        </div>
      </Modal>
    </div>
  );
}
