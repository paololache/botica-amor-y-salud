"use client";
import Link from "next/link";
import { Printer, X } from "lucide-react";
import { useDatos } from "@/lib/cliente";
import { textoResultado, type TipoServicio } from "@/lib/servicios-texto";

type Detalle = {
  referencia: string; fecha: string; servicio: string; tipo: TipoServicio; viaNombre: string | null; atendio: string; estado: string;
  pacienteNombre: string; pacienteDoc: string | null; pacienteEdad: number | null; pacienteSexo: string | null;
  resultados: Record<string, number | string | null> | null; clasificacion: string | null; derivar: boolean;
  receta: { medico: string; cmp: string; fecha: string } | null; productoTexto: string | null; loteTexto: string | null; vencimientoProducto: string | null;
  productoOrigen: string | null; dosis: string | null; sitioAplicacion: string | null; reaccionAdversa: string | null; observacion: string | null; precio: number;
  empresa: { razonSocial: string; nombreComercial: string; ruc: string; direccion: string; telefono: string };
};

const fecha = (f: string) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" }).format(new Date(f));

/** Constancia de la atención para el paciente (A5): resultado, recomendación y, si es inyectable, receta y producto aplicado. */
export function Constancia({ id }: { id: number }) {
  const { datos: d, error } = useDatos<Detalle>(`/api/servicios/atenciones/${id}`);
  if (error) return <p className="p-10 text-center text-rojo">{error} <Link href="/servicios" className="underline">Volver</Link></p>;
  if (!d) return <p className="p-10 text-center text-ink-2">Cargando…</p>;
  const fila = (t: string, v: string | null | undefined) => (v ? <><dt className="font-semibold">{t}</dt><dd>{v}</dd></> : null);
  return (
    <div className="min-h-screen bg-foil py-6 print:bg-white print:py-0">
      <style>{"@page { size: A5; margin: 10mm; }"}</style>
      <div className="no-imprimir mx-auto mb-4 flex max-w-[148mm] justify-between gap-2 px-2">
        <Link href="/servicios" className="inline-flex h-9 items-center gap-2 rounded-xl border border-foil-3 bg-papel px-3 text-[13.5px] font-semibold text-ink-2"><X size={16} /> Cerrar</Link>
        <button onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-vino px-3 text-[13.5px] font-semibold text-white"><Printer size={16} /> Imprimir</button>
      </div>
      <article className="relative mx-auto w-[148mm] bg-white px-[10mm] py-[10mm] text-[12px] leading-snug text-black shadow-lg print:shadow-none">
        {d.estado === "ANULADA" ? <p className="mb-3 rounded border-2 border-rojo px-2 py-1 text-center font-bold text-rojo">ATENCIÓN ANULADA</p> : null}
        <header className="flex items-start justify-between gap-4 border-b border-black/30 pb-3">
          <div><p className="text-[15px] font-bold">{d.empresa.nombreComercial}</p><p>{d.empresa.direccion}</p>{d.empresa.telefono ? <p>Tel. {d.empresa.telefono}</p> : null}</div>
          <div className="text-right"><p className="font-bold uppercase">Constancia de servicio</p><p className="font-semibold">{d.referencia}</p><p>{fecha(d.fecha)}</p></div>
        </header>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {fila("Paciente", `${d.pacienteNombre}${d.pacienteEdad ? `, ${d.pacienteEdad} años` : ""}${d.pacienteSexo ? ` (${d.pacienteSexo === "F" ? "F" : "M"})` : ""}`)}
          {fila("DNI", d.pacienteDoc)}
          {fila("Servicio", `${d.servicio}${d.viaNombre ? ` · vía ${d.viaNombre.toLowerCase()}` : ""}`)}
        </dl>
        {d.tipo !== "INYECTABLE" ? (
          <section className="mt-4 rounded-lg border border-black/30 px-4 py-3 text-center">
            <p className="text-[18px] font-bold">{textoResultado(d.tipo, d.resultados)}</p>
            {d.clasificacion ? <p className="mt-1 text-[13px]">Clasificación: <b>{d.clasificacion}</b></p> : null}
          </section>
        ) : (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-black/30 px-4 py-3">
            {fila("Medicamento", d.productoTexto)}
            {fila("Lote / venc.", [d.loteTexto, d.vencimientoProducto].filter(Boolean).join(" · "))}
            {fila("Origen", d.productoOrigen === "EXTERNO" ? "Traído por el paciente" : "Dispensado en la botica")}
            {fila("Dosis", d.dosis)}
            {fila("Sitio", d.sitioAplicacion)}
            {d.receta ? fila("Receta", `${d.receta.medico} · CMP ${d.receta.cmp} · ${d.receta.fecha}`) : null}
            {fila("Reacción adversa", d.reaccionAdversa)}
          </dl>
        )}
        {d.derivar ? <p className="mt-3 rounded border border-black px-3 py-2 font-semibold">Recomendación: el resultado está fuera de rango. Consulte con su médico{d.tipo === "INYECTABLE" ? " y reporte cualquier molestia" : ""}.</p> : null}
        {d.observacion ? <p className="mt-3"><b>Observación:</b> {d.observacion}</p> : null}
        <p className="mt-4 text-[10.5px] text-black/70">Resultado referencial obtenido en la botica. No constituye diagnóstico ni reemplaza la consulta médica.</p>
        <footer className="mt-10 flex justify-between gap-6 text-[11px]">
          <div className="w-1/2 border-t border-black pt-1 text-center">Atendido por: {d.atendio}</div>
          {d.tipo === "INYECTABLE" ? <div className="w-1/2 border-t border-black pt-1 text-center">Firma del paciente (consentimiento)</div> : null}
        </footer>
      </article>
    </div>
  );
}
