"use client";
import Link from "next/link";
import { useState } from "react";
import { Download, Target } from "lucide-react";
import { useDatos, soles } from "@/lib/cliente";
import { descargarCsv } from "@/lib/csv";
import { Boton, Campo, Cargando, Insignia, Selector, Tarjeta, Vacio } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import type { AvanceMes } from "@/lib/services/metas";

type Mes = AvanceMes & { diferencia: number | null; estado: "CUMPLIDA" | "NO_CUMPLIDA" | "EN_CURSO" | "SIN_CUOTA" | "PENDIENTE" };
type Datos = {
  anio: number; usuarioId: number | null; opciones: { usuarioId: number | null; nombre: string }[]; meses: Mes[];
  resumen: { mesesConCuota: number; cumplidos: number; meta: number; vendido: number; porcentaje: number | null };
};

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const ESTADO: Record<Mes["estado"], { texto: string; tono: "ok" | "rojo" | "azul" | "gris" }> = {
  CUMPLIDA: { texto: "Cumplida", tono: "ok" }, NO_CUMPLIDA: { texto: "No cumplida", tono: "rojo" }, EN_CURSO: { texto: "En curso", tono: "azul" },
  SIN_CUOTA: { texto: "Sin cuota", tono: "gris" }, PENDIENTE: { texto: "Por venir", tono: "gris" },
};
const BARRA: Record<Mes["estado"], string> = { CUMPLIDA: "bg-ok", NO_CUMPLIDA: "bg-rojo/80", EN_CURSO: "bg-petroleo-3", SIN_CUOTA: "bg-foil-3", PENDIENTE: "bg-foil-3" };
const conSigno = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${soles(Math.abs(n))}`;

/** Reporte de cumplimiento de cuota: avance mes a mes de un año, para la botica o un vendedor. */
export function CumplimientoCuota() {
  const u = useUsuario();
  const anioActual = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 4));
  const [anio, setAnio] = useState(anioActual);
  const [quien, setQuien] = useState("");
  const { datos, error } = useDatos<Datos>(`/api/reportes/cuotas?anio=${anio}${quien ? `&usuario=${quien}` : ""}`);
  const listo = datos && datos.anio === anio && String(datos.usuarioId ?? "") === quien;
  const nombre = datos?.opciones.find((o) => String(o.usuarioId ?? "") === quien)?.nombre ?? "Botica";
  const tope = listo ? Math.max(1, ...datos.meses.map((m) => Math.max(m.vendido, m.meta ?? 0))) : 1;

  const exportar = () => {
    if (!listo) return;
    descargarCsv(`cumplimiento-cuota-${anio}-${nombre.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-")}.csv`,
      ["Mes", "Cuota", "Vendido", "Cumplimiento %", "Diferencia", "Estado"],
      [
        ...datos.meses.map((m, i) => [`${MESES_LARGO[i]} ${anio}`, m.meta ?? "", m.vendido, m.porcentaje ?? "", m.diferencia ?? "", ESTADO[m.estado].texto]),
        [], ["Total a la fecha (meses con cuota)", datos.resumen.meta, datos.resumen.vendido, datos.resumen.porcentaje ?? "", r2(datos.resumen.vendido - datos.resumen.meta), `${datos.resumen.cumplidos} de ${datos.resumen.mesesConCuota} cumplidos`],
      ]);
  };

  return (
    <div className="space-y-4">
      <Tarjeta className="no-imprimir p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Campo etiqueta="Año"><Selector value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="w-28">
            {[anioActual + 1, anioActual, anioActual - 1, anioActual - 2, anioActual - 3].map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector></Campo>
          <Campo etiqueta="Cuota de"><Selector value={quien} onChange={(e) => setQuien(e.target.value)} className="w-64">
            {(datos?.opciones ?? [{ usuarioId: null, nombre: "Botica (cuota general)" }]).map((o) => <option key={o.usuarioId ?? "b"} value={o.usuarioId ?? ""}>{o.nombre}</option>)}
          </Selector></Campo>
          <div className="flex gap-2 ml-auto">
            <Boton variante="borde" onClick={exportar} disabled={!listo}><Download size={16} /> Excel</Boton>
            {u.roles.includes("ADMIN") ? <Link href="/metas"><Boton variante="borde"><Target size={16} /> Fijar metas</Boton></Link> : null}
          </div>
        </div>
      </Tarjeta>

      <Tarjeta titulo={<span>Cumplimiento de cuota · {nombre} <span className="text-ink-3 font-sans font-normal text-[13px] ml-2">{anio}</span></span>}>
        {error ? <p className="px-5 pb-5 text-rojo text-sm">{error}</p> : !listo ? <div className="p-5"><Cargando /></div> : (
          <>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-5">
              {[
                ["Meses cumplidos", datos.resumen.mesesConCuota ? `${datos.resumen.cumplidos} de ${datos.resumen.mesesConCuota}` : "—"],
                ["Cuota acumulada", soles(datos.resumen.meta)],
                ["Vendido en esos meses", soles(datos.resumen.vendido)],
                ["Cumplimiento del año", datos.resumen.porcentaje !== null ? `${datos.resumen.porcentaje.toFixed(1)}%` : "—"],
              ].map(([t, v]) => <div key={t} className="rounded-2xl bg-foil px-4 py-3"><dt className="text-[12px] text-ink-2 font-semibold">{t}</dt><dd className="font-semibold text-[17px] tabular-nums mt-0.5">{v}</dd></div>)}
            </dl>

            {datos.resumen.mesesConCuota || datos.meses.some((m) => m.vendido) ? (
              <div className="px-5 pt-6 pb-2">
                <div className="flex items-end gap-1.5 sm:gap-3 h-48" role="img" aria-label={`Vendido frente a la cuota por mes de ${anio}`}>
                  {datos.meses.map((m, i) => (
                    <div key={m.mes} className="relative flex-1 h-full flex flex-col justify-end" title={`${MESES_LARGO[i]}: vendido ${soles(m.vendido)}${m.meta ? ` de ${soles(m.meta)} (${Math.round(m.porcentaje ?? 0)}%)` : ""}`}>
                      <div className={`w-full rounded-t-md ${BARRA[m.estado]}`} style={{ height: `${(m.vendido / tope) * 100}%`, minHeight: m.vendido ? 2 : 0 }} />
                      {m.meta ? <div className="absolute inset-x-[-3px] border-t-2 border-dashed border-ink" style={{ bottom: `${(m.meta / tope) * 100}%` }} /> : null}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 sm:gap-3 mt-1.5">{MESES.map((m) => <span key={m} className="flex-1 text-center text-[11.5px] text-ink-3">{m}</span>)}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[12px] text-ink-2">
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ok" /> Cumplida</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-rojo/80" /> No cumplida</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-petroleo-3" /> En curso</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink" /> Cuota</span>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto mt-4">
              <table className="tabla">
                <thead><tr><th>Mes</th><th className="num">Cuota</th><th className="num">Vendido</th><th className="num">Cumplimiento</th><th className="num">Diferencia</th><th>Estado</th></tr></thead>
                <tbody>{datos.meses.map((m, i) => (
                  <tr key={m.mes} className={m.estado === "PENDIENTE" ? "text-ink-3" : ""}>
                    <td className="font-semibold">{MESES_LARGO[i]}</td>
                    <td className="num">{m.meta ? soles(m.meta) : "—"}</td>
                    <td className="num">{m.estado === "PENDIENTE" ? "—" : soles(m.vendido)}</td>
                    <td className={`num font-semibold ${m.estado === "CUMPLIDA" ? "text-ok" : m.estado === "NO_CUMPLIDA" ? "text-rojo" : ""}`}>{m.porcentaje !== null && m.estado !== "PENDIENTE" ? `${m.porcentaje.toFixed(1)}%` : "—"}</td>
                    <td className={`num ${m.diferencia !== null && m.diferencia < 0 && m.estado !== "PENDIENTE" ? "text-rojo" : m.diferencia !== null && m.diferencia >= 0 ? "text-ok" : ""}`}>{m.diferencia !== null && m.estado !== "PENDIENTE" ? conSigno(m.diferencia) : "—"}</td>
                    <td><Insignia tono={ESTADO[m.estado].tono}>{ESTADO[m.estado].texto}</Insignia>{m.estado === "EN_CURSO" && m.porDia ? <span className="block text-[12px] text-ink-3 mt-1">{soles(m.porDia)} por día para llegar</span> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {!datos.resumen.mesesConCuota ? <Vacio titulo={`Sin cuotas fijadas en ${anio}`}>{u.roles.includes("ADMIN") ? "Fíjalas en Gestión › Metas de venta para ver el cumplimiento mes a mes." : "El administrador aún no fijó cuotas para este año."}</Vacio> : null}
          </>
        )}
      </Tarjeta>
    </div>
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;
