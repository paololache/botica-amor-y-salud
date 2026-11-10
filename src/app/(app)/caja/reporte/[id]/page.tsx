"use client";
import Link from "next/link";
import { Fragment, use, useEffect, useRef, useState } from "react";
import { Printer, ArrowLeft, Download, FileText, Receipt } from "lucide-react";
import { descargarCsv } from "@/lib/csv";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Cargando, Entrada, Insignia, Tarjeta, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { moduloDeRuta, tieneRol } from "@/lib/permisos";
import { Regularizar, type Pendiente } from "./regularizar";
import { RegularizarEfectivo, type EstadoEfectivo } from "./efectivo";

type Rep = {
  sesion: {
    id: number; caja: string; cajero: string; usuarioId: number; turno: string; abiertaEn: string; cerradaEn: string | null; estado: string;
    observacionApertura: string | null; observacion: string | null; validadoPor: string | null; validadoEn: string | null; observacionValidacion: string | null;
  };
  fondoInicial: number; ventas: { total: number; porComprobante: { tipo: string; cantidad: number; total: number }[] }; anuladas: { cantidad: number; total: number };
  movimientos: { tipo: string; concepto: string; medio: string; monto: number }[]; arqueo: { medio: string; esperado: number; contado: number; diferencia: number }[];
  saldoEfectivo: number; saldoVirtual: number;
  virtuales: (Pendiente & { ventaId: number | null; confirmado: boolean; recibido: number | null; regularizacion: Regularizacion | null })[];
  regularizaciones: Regularizacion[];
  vendedores: { id: number; nombre: string }[];
  observaciones: string[];
  declarado: Record<string, number> | null;
  efectivo: EstadoEfectivo;
  diferencia: number; fondoSiguiente: number; retiro: number; comisiones: number; margen?: number | null; costoVentas?: number; ganancia?: number;
  transacciones: Transaccion[];
  eliminados: { id: number; fecha: string; eliminadoPor: string; porOtraPersona: boolean; tipo: string; concepto: string; medio: string; monto: number; motivo: string | null }[];
};

type Regularizacion = {
  id: number; clave: string; origen: string; accion: string; referencia: string | null; medioAnterior: string | null; medio: string | null; monto: number;
  operacion: string | null; ventaId: number | null; comentario: string | null; fecha: string; usuario: string;
  cargoEstado: string | null; cargoPagadoEn: string | null;
};
const ACCION: Record<string, string> = {
  CONFIRMADO: "Confirmado después del cierre", CAMBIO_MEDIO: "Cambió el medio de pago", VENTA_ANULADA: "Venta anulada: no llegó el pago", CONVERTIDO_EN_VENTA: "Ingreso convertido en venta",
  REPOSICION: "Dinero completado", CARGO_CAJERO: "Cargo al cajero", SOBRANTE_DEVUELTO: "Sobrante devuelto al cliente", SOBRANTE_INGRESO: "Sobrante como ingreso de la botica", AJUSTE_CONTEO: "Recuento del efectivo",
};

type Transaccion = {
  clave: string; ventaId: number | null; fecha: string; tipo: string; numero: string | null; cliente: string | null; usuario: string | null; estado: string;
  pagos: { medio: string; monto: number }[]; total: number; ganancia?: number | null;
};
const TIPO: Record<string, string> = { BOLETA: "Boleta", FACTURA: "Factura", NOTA_VENTA: "Nota de venta", INGRESO: "Ingreso de caja", EGRESO: "Egreso de caja" };
const MEDIO: Record<string, string> = { EFECTIVO: "Efectivo", YAPE: "Yape", PLIN: "Plin", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };
const ICONO = "inline-grid size-8 place-items-center rounded-lg border border-foil-3 text-ink-2 hover:border-vino-2 hover:text-vino";
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Fecha y hora de Lima en formato que Excel reconoce: 29/10/2026 08:00. */
const fechaExcel = (f: string | null) => f ? new Date(f).toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "";

/** Exporta el detalle de transacciones del cierre a Excel (CSV con tildes). La ganancia solo va si el usuario la puede ver. */
function exportarExcel(d: Rep, conGanancia: boolean) {
  const s = d.sesion;
  const cab = ["Fecha y hora", "Tipo", "Comprobante", "Estado", "Cliente / concepto", "Usuario", "Tipo de pago", "Detalle del pago", "Total", ...(conGanancia ? ["Ganancia (sin IGV)"] : [])];
  const filas = d.transacciones.map((t) => [
    fechaExcel(t.fecha), TIPO[t.tipo] ?? t.tipo, t.numero ?? "", t.estado === "ANULADA" ? "Anulada" : t.ventaId ? "Emitida" : "Registrado",
    t.cliente ?? "Cliente varios", t.usuario ?? "", t.pagos.map((p) => MEDIO[p.medio] ?? p.medio).join(" + "),
    t.pagos.length > 1 ? t.pagos.map((p) => `${MEDIO[p.medio] ?? p.medio} ${p.monto.toFixed(2)}`).join(" / ") : "",
    t.total, ...(conGanancia ? [t.ganancia ?? ""] : []),
  ]);
  const emitidas = d.transacciones.filter((t) => t.ventaId && t.estado === "EMITIDA");
  const total = r2(emitidas.reduce((a, t) => a + t.total, 0));
  const pie = [
    [],
    ["Total vendido (ventas emitidas)", "", "", "", "", "", "", "", total, ...(conGanancia ? [d.ganancia ?? ""] : [])],
    [],
    ["Sesión", String(s.id).padStart(6, "0")], ["Caja", s.caja], ["Cajero", s.cajero], ["Turno", s.turno.toLowerCase()],
    ["Apertura", fechaExcel(s.abiertaEn)], ["Cierre", fechaExcel(s.cerradaEn)],
    ["Saldo final efectivo", d.saldoEfectivo], ["Saldo final virtual", d.saldoVirtual], ["Diferencia", d.diferencia],
  ];
  const fecha = (s.cerradaEn ?? s.abiertaEn).slice(0, 10);
  descargarCsv(`cierre-caja-${String(s.id).padStart(6, "0")}-${fecha}.csv`, cab, [...filas, ...pie]);
}

const TONO_TIPO: Record<string, "azul" | "petroleo" | "gris" | "ok" | "ambar"> = { BOLETA: "azul", FACTURA: "petroleo", NOTA_VENTA: "gris", INGRESO: "ok", EGRESO: "ambar" };

function ListaTransacciones({ filas, conGanancia, ganancia }: { filas: Transaccion[]; conGanancia: boolean; ganancia?: number }) {
  const emitidas = filas.filter((t) => t.ventaId && t.estado === "EMITIDA");
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="font-display font-semibold text-[15px]">Detalle de transacciones ({filas.length})</h2>
        <span className="text-[12.5px] text-ink-2">{emitidas.length} {emitidas.length === 1 ? "venta emitida" : "ventas emitidas"}{conGanancia ? " · ganancia sin IGV" : ""}</span>
      </div>
      {filas.length ? (
        <div className="overflow-x-auto rounded-2xl border border-foil-2">
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr>
              <th>Fecha y hora</th><th>Comprobante</th><th>Cliente / concepto</th><th>Usuario</th><th>Tipo de pago</th><th className="num">Total</th>
              {conGanancia ? <th className="num">Ganancia</th> : null}
              <th className="no-imprimir num">Ver</th>
            </tr></thead>
            <tbody>{filas.map((t) => {
              const anulada = t.estado === "ANULADA";
              return (
                <tr key={t.clave} className={anulada ? "text-ink-3" : ""}>
                  <td className="whitespace-nowrap tabular-nums">{fechaHora(t.fecha)}</td>
                  <td className="whitespace-nowrap">
                    <Insignia tono={TONO_TIPO[t.tipo] ?? "gris"}>{TIPO[t.tipo] ?? t.tipo}</Insignia>
                    {t.numero && t.ventaId ? <a href={`/comprobante/${t.ventaId}?formato=ticket`} target="_blank" rel="noopener" className="block text-[12.5px] mt-1 tabular-nums font-semibold text-petroleo-3 hover:underline" title="Abrir comprobante">{t.numero}</a>
                      : t.numero ? <span className="block text-[12.5px] mt-1 tabular-nums">{t.numero}</span> : null}
                    {anulada ? <Insignia tono="rojo" className="mt-1">Anulada</Insignia> : null}
                  </td>
                  <td>{t.cliente ?? <span className="text-ink-3">Cliente varios</span>}</td>
                  <td>{t.usuario ?? "—"}</td>
                  <td className="whitespace-nowrap">{t.pagos.map((p, i) => <span key={i} className="block">{MEDIO[p.medio] ?? p.medio}{t.pagos.length > 1 ? <span className="text-ink-2"> {soles(p.monto)}</span> : null}</span>)}</td>
                  <td className={`num font-semibold ${anulada ? "line-through" : t.total < 0 ? "text-[#8a5b00]" : ""}`}>{t.total < 0 ? `− ${soles(-t.total)}` : soles(t.total)}</td>
                  {conGanancia ? <td className={`num ${t.ganancia == null ? "text-ink-3" : t.ganancia < 0 ? "text-rojo font-semibold" : "text-ok font-semibold"}`}>{t.ganancia == null ? "—" : soles(t.ganancia)}</td> : null}
                  <td className="no-imprimir text-right whitespace-nowrap">{t.ventaId ? (
                    <>
                      <a href={`/comprobante/${t.ventaId}?formato=ticket`} target="_blank" rel="noopener" className={ICONO} title="Ver comprobante 80 mm" aria-label={`Ver comprobante ${t.numero} en 80 mm`}><Receipt size={15} /></a>
                      <a href={`/comprobante/${t.ventaId}?formato=a4`} target="_blank" rel="noopener" className={`${ICONO} ml-1.5`} title="Ver en A4" aria-label={`Ver ${t.numero} en A4`}><FileText size={15} /></a>
                    </>
                  ) : null}</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr className="font-semibold">
              <td colSpan={5}>Total vendido (ventas emitidas)</td>
              <td className="num">{soles(emitidas.reduce((a, t) => a + t.total, 0))}</td>
              {conGanancia ? <td className="num text-ok">{soles(ganancia ?? 0)}</td> : null}
              <td className="no-imprimir" />
            </tr></tfoot>
          </table></div>
        </div>
      ) : <p className="text-sm text-ink-3">No hubo transacciones en este turno.</p>}
    </section>
  );
}

export default function ReporteCierre({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const u = useUsuario();
  // Quien no usa la caja (p. ej. el contador) llega desde Reportes: vuelve ahí y no a una pantalla sin acceso.
  const volver = tieneRol(u.roles, ...(moduloDeRuta("/caja/historial")?.roles ?? [])) ? { href: "/caja/historial", texto: "Cierres" } : { href: "/reportes?r=cierres-caja", texto: "Reporte de cierres" };
  const avisar = useAviso();
  const { datos, error, recargar } = useDatos<Rep>(`/api/caja/sesiones/${id}`);
  const [obs, setObs] = useState("");
  const [regularizar, setRegularizar] = useState<Pendiente | null>(null);
  const [aprobando, setAprobando] = useState(false);
  const impreso = useRef(false);
  useEffect(() => {
    if (!datos || impreso.current || new URLSearchParams(window.location.search).get("imprimir") !== "1") return;
    impreso.current = true;
    setTimeout(() => window.print(), 300);
  }, [datos]);
  if (error) return (
    <div className="tarjeta p-10 text-center max-w-xl mx-auto">
      <p className="font-display font-semibold text-[20px]">No se puede mostrar este cierre</p>
      <p className="text-ink-2 mt-2 text-sm">{error}</p>
      <Link href={volver.href} className="inline-flex items-center gap-2 mt-4 font-semibold text-vino-2"><ArrowLeft size={16} /> {volver.texto}</Link>
    </div>
  );
  if (!datos) return <Cargando alto="h-96" />;
  const s = datos.sesion;
  const conAjuste = !!datos.declarado && datos.arqueo.some((a) => Math.abs((datos.declarado?.[a.medio] ?? 0) - a.contado) > 0.004);
  const ingresos = datos.movimientos.filter((m) => m.tipo === "INGRESO").reduce((a, m) => a + m.monto, 0);
  const egresos = datos.movimientos.filter((m) => m.tipo === "EGRESO").reduce((a, m) => a + m.monto, 0);
  const fila = (t: string, v: string, fuerte = false) => <div className={`flex justify-between py-2 border-b border-foil text-[14px] ${fuerte ? "font-semibold" : ""}`}><span className={fuerte ? "" : "text-ink-2"}>{t}</span><span>{v}</span></div>;
  return (
    <div className="max-w-5xl">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link href={volver.href} className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {volver.texto}</Link>
        <div className="flex flex-wrap gap-2">
          <Boton variante="borde" onClick={() => exportarExcel(datos, u.verCostos && datos.ganancia !== undefined)}><Download size={16} /> Exportar a Excel</Boton>
          <Boton variante="borde" onClick={() => window.print()}><Printer size={16} /> Imprimir o guardar PDF</Boton>
        </div>
      </div>
      <Tarjeta className="p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="sello">SESIÓN {String(s.id).padStart(6, "0")} · {s.caja}</p>
            <h1 className="font-display font-semibold text-[26px] mt-3">Reporte de cierre de caja</h1>
            <p className="text-ink-2 mt-1">{s.cajero} · turno {s.turno.toLowerCase()} · {fechaHora(s.abiertaEn)} → {fechaHora(s.cerradaEn)}</p>
          </div>
          <div className="text-right">
            <p className="text-[12.5px] text-ink-2 font-semibold">Diferencia</p>
            <p className={`cifra text-[38px] leading-none mt-1 ${datos.diferencia < -0.004 ? "text-rojo" : "text-ok"}`}>{datos.diferencia > 0.004 ? "+" : datos.diferencia < -0.004 ? "−" : ""}{soles(Math.abs(datos.diferencia))}</p>
            <div className="mt-2">{s.estado === "EN_CIERRE" ? <Insignia tono="ambar">Por aprobar</Insignia> : <Insignia tono="ok">Cerrada</Insignia>}</div>
          </div>
        </div>
        {s.estado === "EN_CIERRE" ? (
          <div className="no-imprimir mt-5 rounded-2xl bg-ambar-claro px-4 py-3 text-[13.5px]">
            <p className="font-semibold text-[#8a5b00]">Cierre con observaciones: espera la aprobación del administrador</p>
            {datos.observaciones.length ? <ul className="mt-1 list-disc pl-5 text-ink-2">{datos.observaciones.map((o) => <li key={o}>{o}</li>)}</ul> : <p className="mt-1 text-ink-2">Ya no quedan observaciones pendientes; falta la aprobación.</p>}
          </div>
        ) : null}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {[["Apertura", fechaHora(s.abiertaEn)], ["Cierre", fechaHora(s.cerradaEn)], ["Saldo final efectivo", soles(datos.saldoEfectivo)], ["Saldo final virtual", soles(datos.saldoVirtual)]].map(([t, v]) => (
            <div key={t} className="rounded-2xl bg-foil px-4 py-3"><dt className="text-[12px] text-ink-2 font-semibold">{t}</dt><dd className="font-semibold text-[15px] mt-0.5 tabular-nums">{v}</dd></div>
          ))}
        </dl>
        <ListaTransacciones filas={datos.transacciones ?? []} conGanancia={u.verCostos && datos.ganancia !== undefined} ganancia={datos.ganancia} />
        <div className="grid md:grid-cols-2 gap-6 mt-8 [&>*]:min-w-0">
          <section>
            <h2 className="font-display font-semibold text-[15px] mb-2">Cierre de caja por medio de pago</h2>
            <div className="overflow-x-auto"><table className="tabla">
              <thead><tr><th>Medio</th><th className="num">Sistema</th>{conAjuste ? <th className="num">Declaró el cajero</th> : null}<th className="num">{conAjuste ? "Con regularización" : "Declarado"}</th><th className="num">Diferencia</th></tr></thead>
              <tbody>
                {datos.arqueo.map((a) => (
                  <tr key={a.medio}><td>{a.medio[0] + a.medio.slice(1).toLowerCase()}</td><td className="num">{soles(a.esperado)}</td>{conAjuste ? <td className="num text-ink-2">{soles(datos.declarado?.[a.medio] ?? 0)}</td> : null}<td className="num">{soles(a.contado)}</td><td className={`num font-semibold ${Math.abs(a.diferencia) > 0.009 ? "text-rojo" : ""}`}>{soles(a.diferencia)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <section>
            <h2 className="font-display font-semibold text-[15px] mb-2">Resumen del turno</h2>
            {fila("Efectivo de apertura", soles(datos.fondoInicial))}
            {datos.ventas.porComprobante.map((p) => <Fragment key={p.tipo}>{fila(`${p.tipo === "NOTA_VENTA" ? "Notas de venta" : p.tipo === "BOLETA" ? "Boletas" : "Facturas"} (${p.cantidad})`, soles(p.total))}</Fragment>)}
            {fila("Ingresos de caja", soles(ingresos))}
            {fila("Egresos de caja", `− ${soles(egresos)}`)}
            {fila(`Anulaciones (${datos.anuladas.cantidad})`, soles(datos.anuladas.total))}
            {fila("Comisiones del turno", soles(datos.comisiones))}
            {u.verCostos && datos.ganancia !== undefined ? fila("Ganancia del turno (sin IGV)", soles(datos.ganancia)) : null}
            {u.verCostos && datos.margen !== undefined ? fila("Margen bruto del turno", datos.margen === null ? "—" : `${datos.margen.toFixed(1)}%`, true) : null}
          </section>
        </div>
        {datos.virtuales?.length ? (
          <section className="mt-8">
            <h2 className="font-display font-semibold text-[15px] mb-1">Validación de pagos virtuales</h2>
            <p className="text-[13px] text-ink-2 mb-2">
              {datos.virtuales.filter((v) => v.confirmado).length} de {datos.virtuales.length} conformes. Los que no cuadran cuentan por el monto que registró el cajero
              {u.roles.includes("ADMIN") ? "; regularízalos cuando verifiques qué pasó con cada uno." : " hasta que el administrador los regularice."}
            </p>
            <div className="overflow-x-auto"><table className="tabla"><thead><tr><th>Hora</th><th>Comprobante</th><th>Medio</th><th className="num">Monto</th><th className="num">Recibido</th><th>Estado</th><th className="no-imprimir" /></tr></thead>
              <tbody>{datos.virtuales.map((v) => (
                <tr key={v.clave}><td className="whitespace-nowrap">{fechaHora(v.fecha)}</td><td>{v.referencia}{v.origen === "Ingreso" ? " · ingreso" : ""}</td><td>{MEDIO[v.medio] ?? v.medio}</td><td className="num">{soles(v.monto)}</td>
                  <td className={`num font-semibold ${v.recibido !== null && Math.abs(v.recibido - v.monto) >= 0.005 ? (v.recibido < v.monto ? "text-rojo" : "text-ok") : ""}`}>{v.recibido !== null ? soles(v.recibido) : "—"}</td>
                  <td>{v.regularizacion ? (
                    <><Insignia tono="azul">Regularizado</Insignia><span className="block text-[12px] text-ink-2 mt-1">{ACCION[v.regularizacion.accion] ?? v.regularizacion.accion}{v.regularizacion.operacion ? ` · op. ${v.regularizacion.operacion}` : ""}</span></>
                  ) : v.confirmado ? <Insignia tono="ok">Conforme</Insignia> : <Insignia tono="rojo">{v.recibido ? "No cuadra" : "No llegó"}</Insignia>}</td>
                  <td className="no-imprimir text-right">{!v.confirmado && u.roles.includes("ADMIN") ? <Boton tam="sm" variante="borde" onClick={() => setRegularizar(v)}>Regularizar</Boton> : null}</td></tr>
              ))}</tbody></table></div>
          </section>
        ) : null}
        {u.roles.includes("ADMIN") && s.estado !== "ABIERTA" && datos.efectivo && (Math.abs(datos.efectivo.porRegularizar) > 0.004 || datos.regularizaciones.some((g) => g.origen === "Efectivo")) ? (
          <RegularizarEfectivo sesionId={s.id} efectivo={datos.efectivo} cajero={s.cajero} alTerminar={(m) => { avisar("ok", m); recargar(); }} />
        ) : null}
        {datos.regularizaciones?.length ? (
          <section className="mt-8">
            <h2 className="font-display font-semibold text-[15px] mb-1">Regularizaciones después del cierre ({datos.regularizaciones.length})</h2>
            <p className="text-[13px] text-ink-2 mb-2">Lo que el administrador completó después del cierre (pagos que no cuadraron y diferencias de efectivo). El cierre se recalculó con cada una.</p>
            <div className="overflow-x-auto"><table className="tabla"><thead><tr><th>Fecha</th><th>Por</th><th>Pago</th><th>Qué se hizo</th><th className="num">Monto</th><th>Detalle</th></tr></thead>
              <tbody>{datos.regularizaciones.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{fechaHora(g.fecha)}</td><td>{g.usuario}</td>
                  <td>{g.origen === "Efectivo" ? "Efectivo" : g.referencia ?? g.clave}{g.origen === "Ingreso" ? " · ingreso" : ""}</td>
                  <td>{ACCION[g.accion] ?? g.accion}{g.accion === "CAMBIO_MEDIO" && g.medioAnterior && g.medio ? <span className="block text-[12px] text-ink-2">{MEDIO[g.medioAnterior]} → {MEDIO[g.medio]}</span> : null}
                    {g.accion === "CARGO_CAJERO" ? <span className="block mt-0.5">{g.cargoEstado === "PAGADO" ? <Insignia tono="ok">Pagado</Insignia> : <Insignia tono="ambar">Pendiente de pago</Insignia>}</span> : null}
                    {g.accion === "CONVERTIDO_EN_VENTA" && g.ventaId ? <a href={`/comprobante/${g.ventaId}?formato=ticket`} target="_blank" rel="noopener" className="block text-[12px] font-semibold text-petroleo-3 hover:underline">Ver comprobante</a> : null}</td>
                  <td className={`num ${g.monto < 0 ? "text-rojo" : ""}`}>{g.monto < 0 ? `− ${soles(-g.monto)}` : soles(g.monto)}</td>
                  <td className="text-[13px]">{[g.operacion ? `Op. ${g.operacion}` : null, g.comentario].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}</tbody></table></div>
          </section>
        ) : null}
        {datos.eliminados?.length ? (
          <section className="mt-8">
            <h2 className="font-display font-semibold text-[15px] mb-1 text-rojo">Movimientos eliminados en este turno ({datos.eliminados.length})</h2>
            <p className="text-[13px] text-ink-2 mb-2">No suman en el cierre de caja. Revisa que cada eliminación tenga un motivo válido.</p>
            <div className="overflow-x-auto"><table className="tabla"><thead><tr><th>Eliminado</th><th>Por</th><th>Tipo</th><th>Concepto</th><th>Medio</th><th className="num">Monto</th><th>Motivo</th></tr></thead>
              <tbody>{datos.eliminados.map((e) => <tr key={e.id}><td>{fechaHora(e.fecha)}</td><td>{e.eliminadoPor}{e.porOtraPersona ? " (no es el cajero)" : ""}</td><td>{e.tipo}</td><td>{e.concepto}</td><td>{e.medio}</td><td className="num">{soles(e.monto)}</td><td>{e.motivo ?? "—"}</td></tr>)}</tbody></table></div>
          </section>
        ) : null}
        <section className="mt-8 grid md:grid-cols-2 gap-6 text-[14px]">
          <div><p className="text-ink-2 font-semibold text-[12.5px]">Observación del cajero</p><p className="mt-1">{s.observacion ?? "—"}</p>{s.observacionApertura ? <p className="text-ink-2 mt-1">Apertura: {s.observacionApertura}</p> : null}</div>
          <div><p className="text-ink-2 font-semibold text-[12.5px]">Aprobado por</p>
            {s.validadoPor ? <><p className="mt-1">{s.validadoPor}{s.validadoEn ? <span className="text-ink-2"> · {fechaHora(s.validadoEn)}</span> : null}</p>{s.observacionValidacion ? <p className="mt-1 text-ink-2">{s.observacionValidacion}</p> : null}</>
              : <p className="mt-1">{s.estado === "EN_CIERRE" ? "Pendiente de aprobación" : "No requirió aprobación"}</p>}</div>
        </section>
        <div className="hidden print:flex gap-16 mt-16 text-sm text-ink-2"><div className="border-t border-ink-3 pt-2 w-56 text-center">Firma del cajero</div><div className="border-t border-ink-3 pt-2 w-56 text-center">Firma del administrador</div></div>
        {s.estado === "EN_CIERRE" && u.roles.includes("ADMIN") ? (
          <div className="no-imprimir mt-8 rounded-2xl bg-ambar-claro p-5">
            <p className="font-semibold text-[#8a5b00]">Aprueba este cierre para terminar de cerrar la caja</p>
            <p className="text-[13px] text-ink-2 mt-1">
              Detalla qué pasó con la diferencia y qué se hizo (por ejemplo, si se descontó al cajero o se encontró el error).
              {datos.virtuales.some((v) => !v.confirmado) ? ` Aún hay ${datos.virtuales.filter((v) => !v.confirmado).length} pagos sin regularizar: si apruebas así, quedan como faltante.` : ""}
            </p>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={500} placeholder="Ej.: faltante de S/ 6 por vuelto mal dado; se conversó con el cajero y se descontará en su pago"
              className="mt-3 w-full rounded-xl border border-foil-3 bg-papel px-3 py-2 text-[14px] outline-none focus:border-petroleo" aria-label="Observación de la aprobación" />
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <span className="text-[12.5px] text-ink-2">{obs.trim().length < 10 ? `Escribe al menos 10 caracteres (${obs.trim().length}/10)` : "Listo para aprobar"}</span>
              <Boton cargando={aprobando} disabled={obs.trim().length < 10} onClick={async () => {
                setAprobando(true);
                try { await api("/api/caja/validar", { cuerpo: { sesionId: s.id, observacion: obs } }); avisar("ok", "Cierre aprobado: la caja quedó cerrada."); setObs(""); recargar(); }
                catch (e) { avisar("error", (e as Error).message); } finally { setAprobando(false); }
              }}>Aprobar cierre</Boton>
            </div>
          </div>
        ) : null}
      </Tarjeta>
      <Regularizar sesionId={s.id} item={regularizar} vendedores={datos.vendedores ?? []} cajeroId={s.usuarioId} alCerrar={() => setRegularizar(null)}
        alTerminar={(m) => { setRegularizar(null); avisar("ok", m); recargar(); }} />
    </div>
  );
}
