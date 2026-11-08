"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChartColumn, Copy, Save } from "lucide-react";
import { api, useDatos, soles } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, EntradaNumero, Insignia, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { BarraCuotaMes } from "@/components/meta-dia";
import { ROL_NOMBRE, type Rol } from "@/lib/permisos";
import type { AvanceMes } from "@/lib/services/metas";

type Vendedor = AvanceMes & { usuarioId: number; nombre: string; roles: Rol[]; metaDiaria: number | null };
type Datos = { mes: string; sumaVendedores: number; botica: AvanceMes; vendedores: Vendedor[] };
type Form = { botica: string; vendedores: Record<number, { mes: string; dia: string }> };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const moverMes = (m: string, d: number) => { const [a, n] = m.split("-").map(Number); const t = a * 12 + (n - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 7);
const txt = (n: number | null | undefined) => (n ? String(n) : "");
const num = (s: string) => (s.trim() ? Number(s) : null);
const valido = (s: string) => !s.trim() || Number(s) > 0;

function formDe(d: Datos): Form {
  return { botica: txt(d.botica.meta), vendedores: Object.fromEntries(d.vendedores.map((v) => [v.usuarioId, { mes: txt(v.meta), dia: txt(v.metaDiaria) }])) };
}

export default function Metas() {
  const avisar = useAviso();
  const [mes, setMes] = useState(mesActual);
  const { datos, recargar } = useDatos<Datos>(`/api/metas?mes=${mes}`);
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [copiando, setCopiando] = useState(false);

  useEffect(() => { if (datos && datos.mes === mes) setForm(formDe(datos)); }, [datos, mes]);

  const listo = datos && form && datos.mes === mes;
  const cambiado = listo ? JSON.stringify(form) !== JSON.stringify(formDe(datos)) : false;
  const errores = listo ? [form.botica, ...Object.values(form.vendedores).flatMap((v) => [v.mes, v.dia])].some((s) => !valido(s)) : false;
  const sumaForm = listo ? Object.values(form.vendedores).reduce((a, v) => a + (Number(v.mes) || 0), 0) : 0;

  const cambiarMes = (m: string) => {
    if (cambiado && !window.confirm("Tienes cambios sin guardar en este mes. ¿Cambiar de mes y descartarlos?")) return;
    setForm(null); setMes(m);
  };

  const copiarAnterior = async () => {
    if (!form) return;
    setCopiando(true);
    try {
      const prev = await api<Datos>(`/api/metas?mes=${moverMes(mes, -1)}`);
      const copiadas = prev.vendedores.filter((v) => v.meta).length + (prev.botica.meta ? 1 : 0);
      if (!copiadas) { avisar("error", `${nombreMes(moverMes(mes, -1))} no tiene cuotas para copiar.`); return; }
      setForm({
        botica: txt(prev.botica.meta) || form.botica,
        vendedores: Object.fromEntries(Object.entries(form.vendedores).map(([id, v]) => [id, { ...v, mes: txt(prev.vendedores.find((p) => p.usuarioId === Number(id))?.meta) || v.mes }])),
      });
      avisar("ok", `Se copiaron las cuotas de ${nombreMes(moverMes(mes, -1))}. Revisa y guarda.`);
    } catch (e) { avisar("error", (e as Error).message); } finally { setCopiando(false); }
  };

  const guardar = async () => {
    if (!form || !datos) return;
    setGuardando(true);
    try {
      await api("/api/metas", { metodo: "PUT", cuerpo: {
        mes, botica: num(form.botica),
        vendedores: datos.vendedores.map((v) => ({ usuarioId: v.usuarioId, metaMes: num(form.vendedores[v.usuarioId]?.mes ?? ""), metaDiaria: num(form.vendedores[v.usuarioId]?.dia ?? "") })),
      } });
      avisar("ok", `Metas de ${nombreMes(mes)} guardadas.`);
      recargar();
    } catch (e) { avisar("error", (e as Error).message); } finally { setGuardando(false); }
  };

  const fijarVendedor = (id: number, campo: "mes" | "dia", valor: string) =>
    setForm((f) => (f ? { ...f, vendedores: { ...f.vendedores, [id]: { ...f.vendedores[id], [campo]: valor } } } : f));

  return (
    <div>
      <Encabezado titulo="Metas de venta" bajada="Fija la cuota del mes de la botica y de cada vendedor, y su meta diaria. El avance se actualiza con cada venta.">
        <Link href="/reportes?r=cumplimiento-cuota"><Boton variante="borde"><ChartColumn size={16} /> Cumplimiento mes a mes</Boton></Link>
      </Encabezado>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Boton variante="borde" tam="sm" onClick={() => cambiarMes(moverMes(mes, -1))} aria-label="Mes anterior"><ChevronLeft size={16} /></Boton>
        <input type="month" value={mes} onChange={(e) => e.target.value && cambiarMes(e.target.value)} aria-label="Mes"
          className="h-8 rounded-lg border border-foil-3 bg-papel px-2 text-[14px] font-semibold capitalize" />
        <Boton variante="borde" tam="sm" onClick={() => cambiarMes(moverMes(mes, 1))} aria-label="Mes siguiente"><ChevronRight size={16} /></Boton>
        <span className="font-display font-semibold text-[17px] capitalize ml-1">{nombreMes(mes)}</span>
        {mes !== mesActual() ? <Boton variante="fantasma" tam="sm" onClick={() => cambiarMes(mesActual())}>Ir al mes actual</Boton> : null}
      </div>

      {!listo ? <Cargando alto="h-96" /> : (
        <div className="space-y-6">
          <Tarjeta className="p-5">
            <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-6 items-start">
              <label className="block">
                <span className="block text-[12.5px] font-semibold text-ink-2 mb-1.5">Cuota del mes de la botica</span>
                <EntradaNumero inputMode="decimal" value={form.botica} onChange={(e) => setForm({ ...form, botica: e.target.value })} placeholder="Sin cuota" className="h-12 text-[20px] font-semibold" aria-invalid={!valido(form.botica)} />
                <span className="block text-[12px] text-ink-3 mt-1">Cuenta todas las ventas emitidas, de mostrador y por transferencia.</span>
                {sumaForm > 0 ? (
                  <span className="block text-[12px] mt-1.5">
                    Suma de cuotas de vendedores: <b>{soles(sumaForm)}</b>
                    {num(form.botica) && Math.abs(sumaForm - Number(form.botica)) > 0.009 ? <span className="text-ink-3"> ({sumaForm > Number(form.botica) ? "mayor" : "menor"} que la de la botica)</span> : null}
                  </span>
                ) : null}
              </label>
              <div>
                {datos.botica.meta ? <BarraCuotaMes cuota={datos.botica} titulo="Avance de la botica" /> : (
                  <p className="text-sm text-ink-3 md:pt-7">Escribe la cuota y guarda para ver el avance. Vendido en {nombreMes(mes)}: <b className="text-ink">{soles(datos.botica.vendido)}</b>.</p>
                )}
                {datos.botica.meta ? (
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-[13px]">
                    {[["Vendido", soles(datos.botica.vendido)], ["Falta", soles(datos.botica.faltante ?? 0)], ["Por día para llegar", datos.botica.porDia ? soles(datos.botica.porDia) : "—"], ["Proyección del mes", datos.botica.proyeccion !== null ? soles(datos.botica.proyeccion) : "—"]].map(([t, v]) => (
                      <div key={t} className="rounded-xl bg-foil px-3 py-2"><dt className="text-ink-2 text-[12px] font-semibold">{t}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </div>
          </Tarjeta>

          <Tarjeta titulo="Metas por vendedor" accion={<Boton tam="sm" variante="borde" cargando={copiando} onClick={copiarAnterior}><Copy size={14} /> Copiar cuotas del mes anterior</Boton>}>
            {datos.vendedores.length ? (
              <div className="overflow-x-auto">
                <table className="tabla">
                  <thead><tr>
                    <th>Vendedor</th><th className="num">Meta diaria</th><th className="num">Cuota del mes</th>
                    <th className="num">Vendido</th><th className="min-w-[160px]">Avance</th><th className="num">Falta</th><th className="num">Por día</th>
                  </tr></thead>
                  <tbody>{datos.vendedores.map((v) => {
                    const f = form.vendedores[v.usuarioId] ?? { mes: "", dia: "" };
                    const pct = v.porcentaje;
                    return (
                      <tr key={v.usuarioId}>
                        <td><span className="font-semibold">{v.nombre}</span><span className="block text-[12px] text-ink-3">{v.roles.map((r) => ROL_NOMBRE[r]).join(" · ")}</span></td>
                        <td className="num"><EntradaNumero crudo inputMode="decimal" value={f.dia} onChange={(e) => fijarVendedor(v.usuarioId, "dia", e.target.value)} placeholder="Automática" aria-label={`Meta diaria de ${v.nombre}`} aria-invalid={!valido(f.dia)}
                          className="h-9 w-28 rounded-lg border border-foil-3 bg-papel px-2 text-right tabular-nums placeholder:text-ink-3 placeholder:text-[12.5px] aria-[invalid=true]:border-rojo" /></td>
                        <td className="num"><EntradaNumero crudo inputMode="decimal" value={f.mes} onChange={(e) => fijarVendedor(v.usuarioId, "mes", e.target.value)} placeholder="Sin cuota" aria-label={`Cuota del mes de ${v.nombre}`} aria-invalid={!valido(f.mes)}
                          className="h-9 w-32 rounded-lg border border-foil-3 bg-papel px-2 text-right font-semibold tabular-nums placeholder:text-ink-3 placeholder:font-normal placeholder:text-[12.5px] aria-[invalid=true]:border-rojo" /></td>
                        <td className="num">{soles(v.vendido)}</td>
                        <td>{pct !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-foil-2 overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-ok" : "bg-petroleo-3"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                            <span className={`tabular-nums text-[13px] font-semibold w-12 text-right ${pct >= 100 ? "text-ok" : ""}`}>{Math.round(pct)}%</span>
                          </div>
                        ) : <span className="text-[12.5px] text-ink-3">Sin cuota</span>}</td>
                        <td className="num">{v.faltante !== null ? (v.faltante > 0 ? soles(v.faltante) : <Insignia tono="ok">Cumplida</Insignia>) : "—"}</td>
                        <td className="num">{v.porDia ? soles(v.porDia) : "—"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ) : <Vacio titulo="No hay vendedores activos">Crea usuarios con perfil de cajero, vendedor o químico farmacéutico en Usuarios.</Vacio>}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-foil">
              <p className="text-[12.5px] text-ink-3 max-w-2xl">Cada vendedor suma sus ventas de mostrador. La meta diaria vacía se calcula sola con su promedio de los últimos 30 días + 10 %. El avance se recalcula al guardar.</p>
              <Boton variante="amor" cargando={guardando} disabled={!cambiado || errores} onClick={guardar}><Save size={16} /> Guardar metas</Boton>
            </div>
            {errores ? <p className="px-5 pb-4 -mt-2 text-[12.5px] text-rojo" role="alert">Las metas deben ser mayores a 0. Déjalas vacías para no fijar una.</p> : null}
          </Tarjeta>
        </div>
      )}
    </div>
  );
}
