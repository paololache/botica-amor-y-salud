"use client";
import Link from "next/link";
import { use, useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Cargando, Entrada, Insignia, Tarjeta, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type Rep = {
  sesion: { id: number; caja: string; cajero: string; turno: string; abiertaEn: string; cerradaEn: string | null; estado: string; observacionApertura: string | null; observacion: string | null; validadoPor: string | null };
  fondoInicial: number; ventas: { total: number; porComprobante: { tipo: string; cantidad: number; total: number }[] }; anuladas: { cantidad: number; total: number };
  movimientos: { tipo: string; concepto: string; medio: string; monto: number }[]; arqueo: { medio: string; esperado: number; contado: number; diferencia: number }[];
  diferencia: number; fondoSiguiente: number; retiro: number; comisiones: number; margen?: number | null; costoVentas?: number;
};

export default function ReporteCierre({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const u = useUsuario();
  const avisar = useAviso();
  const { datos, error, recargar } = useDatos<Rep>(`/api/caja/sesiones/${id}`);
  const [obs, setObs] = useState("");
  if (error) return <p className="text-rojo">{error}</p>;
  if (!datos) return <Cargando alto="h-96" />;
  const s = datos.sesion;
  const ingresos = datos.movimientos.filter((m) => m.tipo === "INGRESO").reduce((a, m) => a + m.monto, 0);
  const egresos = datos.movimientos.filter((m) => m.tipo === "EGRESO").reduce((a, m) => a + m.monto, 0);
  const fila = (t: string, v: string, fuerte = false) => <div className={`flex justify-between py-2 border-b border-foil text-[14px] ${fuerte ? "font-semibold" : ""}`}><span className={fuerte ? "" : "text-ink-2"}>{t}</span><span>{v}</span></div>;
  return (
    <div className="max-w-5xl">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link href="/caja/historial" className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> Cierres</Link>
        <Boton variante="borde" onClick={() => window.print()}><Printer size={16} /> Imprimir o guardar PDF</Boton>
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
            <p className={`cifra text-[38px] leading-none mt-1 ${Math.abs(datos.diferencia) > 5 ? "text-rojo" : "text-ok"}`}>{datos.diferencia > 0 ? "+" : ""}{soles(datos.diferencia)}</p>
            <div className="mt-2">{s.estado === "EN_CIERRE" ? <Insignia tono="ambar">Por validar</Insignia> : <Insignia tono="ok">Cerrada</Insignia>}</div>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-6 mt-8">
          <section>
            <h2 className="font-display font-semibold text-[15px] mb-2">Arqueo por medio de pago</h2>
            <table className="tabla">
              <thead><tr><th>Medio</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th></tr></thead>
              <tbody>
                {datos.arqueo.map((a) => (
                  <tr key={a.medio}><td>{a.medio[0] + a.medio.slice(1).toLowerCase()}</td><td className="num">{soles(a.esperado)}</td><td className="num">{soles(a.contado)}</td><td className={`num font-semibold ${Math.abs(a.diferencia) > 0.009 ? "text-rojo" : ""}`}>{soles(a.diferencia)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="font-display font-semibold text-[15px] mb-2">Resumen del turno</h2>
            {fila("Fondo inicial", soles(datos.fondoInicial))}
            {datos.ventas.porComprobante.map((p) => fila(`${p.tipo === "NOTA_VENTA" ? "Notas de venta" : p.tipo === "BOLETA" ? "Boletas" : "Facturas"} (${p.cantidad})`, soles(p.total)))}
            {fila("Ingresos de caja", soles(ingresos))}
            {fila("Egresos de caja", `− ${soles(egresos)}`)}
            {fila(`Anulaciones (${datos.anuladas.cantidad})`, soles(datos.anuladas.total))}
            {fila("Fondo que queda / retiro", `${soles(datos.fondoSiguiente)} / ${soles(datos.retiro)}`)}
            {fila("Comisiones del turno", soles(datos.comisiones))}
            {u.verCostos && datos.margen !== undefined ? fila("Margen bruto del turno", datos.margen === null ? "—" : `${datos.margen.toFixed(1)}%`, true) : null}
          </section>
        </div>
        {datos.movimientos.length ? (
          <section className="mt-8">
            <h2 className="font-display font-semibold text-[15px] mb-2">Ingresos y egresos</h2>
            <table className="tabla"><thead><tr><th>Tipo</th><th>Concepto</th><th>Medio</th><th className="num">Monto</th></tr></thead>
              <tbody>{datos.movimientos.map((m, i) => <tr key={i}><td>{m.tipo}</td><td>{m.concepto}</td><td>{m.medio}</td><td className="num">{soles(m.monto)}</td></tr>)}</tbody></table>
          </section>
        ) : null}
        <section className="mt-8 grid md:grid-cols-2 gap-6 text-[14px]">
          <div><p className="text-ink-2 font-semibold text-[12.5px]">Observación</p><p className="mt-1">{s.observacion ?? "—"}</p>{s.observacionApertura ? <p className="text-ink-2 mt-1">Apertura: {s.observacionApertura}</p> : null}</div>
          <div><p className="text-ink-2 font-semibold text-[12.5px]">Validado por</p><p className="mt-1">{s.validadoPor ?? "No requirió validación"}</p></div>
        </section>
        <div className="hidden print:flex gap-16 mt-16 text-sm text-ink-2"><div className="border-t border-ink-3 pt-2 w-56 text-center">Firma del cajero</div><div className="border-t border-ink-3 pt-2 w-56 text-center">Firma del administrador</div></div>
        {s.estado === "EN_CIERRE" && u.rol === "ADMIN" ? (
          <div className="no-imprimir mt-8 rounded-2xl bg-ambar-claro p-5">
            <p className="font-semibold text-[#8a5b00]">Este cierre espera tu validación</p>
            <div className="flex gap-2 mt-3">
              <Entrada placeholder="Observación de la diferencia" value={obs} onChange={(e) => setObs(e.target.value)} />
              <Boton disabled={obs.trim().length < 5} onClick={async () => { try { await api("/api/caja/validar", { cuerpo: { sesionId: s.id, observacion: obs } }); avisar("ok", "Cierre validado."); recargar(); } catch (e) { avisar("error", (e as Error).message); } }}>Validar</Boton>
            </div>
          </div>
        ) : null}
      </Tarjeta>
    </div>
  );
}
