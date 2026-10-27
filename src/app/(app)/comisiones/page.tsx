"use client";
import { useState } from "react";
import { api, useDatos, soles, fechaCorta, hoyLima } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, Entrada, Insignia, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type Mias = { hoy: number; lineasHoy: number; mes: number; mesActual: string; dias: { fecha: string; total: number; lineas: number }[]; liquidaciones: { id: number; mes: string; total: number; estado: string; pagadoEn: string | null }[] };
type Mes = { mes: string; cerrable: boolean; finDeMes: string; vendedores: { usuarioId: number; nombre: string; total: number; lineas: number; dias: number; liquidacion: { id: number; estado: string; total: number; pagadoEn: string | null } | null }[] };

const nombreMes = (m: string) => new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-15T12:00:00Z"));

export default function Comisiones() {
  const u = useUsuario();
  return u.rol === "ADMIN" || u.rol === "CONTADOR" ? <Administracion /> : <Mias />;
}

function Mias() {
  const { datos } = useDatos<Mias>("/api/comisiones/mias");
  if (!datos) return <Cargando alto="h-80" />;
  const max = Math.max(1, ...datos.dias.map((d) => d.total));
  return (
    <div>
      <Encabezado titulo="Mis comisiones" bajada="Ganas comisión al vender productos en campaña. Se acumula cada día y se paga al cierre de mes." />
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="tarjeta p-5 bg-[linear-gradient(160deg,#fff,#fdf0f5)]"><p className="text-[13px] font-semibold text-ink-2">Hoy</p><p className="cifra text-[42px] text-amor-2 leading-none mt-2">{soles(datos.hoy)}</p><p className="text-[12.5px] text-ink-3 mt-2">{datos.lineasHoy} productos en promoción vendidos</p></div>
        <div className="tarjeta p-5"><p className="text-[13px] font-semibold text-ink-2">Acumulado de {nombreMes(datos.mesActual)}</p><p className="cifra text-[42px] leading-none mt-2">{soles(datos.mes)}</p><p className="text-[12.5px] text-ink-3 mt-2">Se paga al cierre de mes</p></div>
      </div>
      <Tarjeta titulo="Día por día">
        {datos.dias.length ? (
          <ul className="px-5 pb-5 space-y-2.5">{datos.dias.map((d) => (
            <li key={d.fecha} className="grid grid-cols-[90px_1fr_90px] items-center gap-3 text-[13.5px]"><span className="text-ink-2">{fechaCorta(d.fecha)}</span><div className="barra"><span style={{ width: `${(d.total / max) * 100}%`, background: "var(--color-amor)" }} /></div><span className="text-right font-semibold">{soles(d.total)}</span></li>
          ))}</ul>
        ) : <Vacio titulo="Aún no tienes comisiones este mes">Ofrece los productos marcados «En promoción» en el punto de venta.</Vacio>}
      </Tarjeta>
      {datos.liquidaciones.length ? (
        <Tarjeta titulo="Pagos" className="mt-6">
          <table className="tabla"><tbody>{datos.liquidaciones.map((l) => <tr key={l.id}><td className="capitalize">{nombreMes(l.mes)}</td><td className="num font-semibold">{soles(l.total)}</td><td className="text-right">{l.estado === "PAGADA" ? <Insignia tono="ok">Pagada</Insignia> : <Insignia tono="ambar">Aprobada, por pagar</Insignia>}</td></tr>)}</tbody></table>
        </Tarjeta>
      ) : null}
    </div>
  );
}

function Administracion() {
  const u = useUsuario();
  const avisar = useAviso();
  const [mes, setMes] = useState(hoyLima().slice(0, 7));
  const { datos, recargar } = useDatos<Mes>(`/api/comisiones/mes?mes=${mes}`);
  const [ocupado, setOcupado] = useState(false);
  const total = (datos?.vendedores ?? []).reduce((s, v) => s + v.total, 0);
  const pendientesLiq = (datos?.vendedores ?? []).filter((v) => !v.liquidacion && v.total !== 0).length;
  const cerrar = async () => {
    setOcupado(true);
    try { const r = await api<{ liquidaciones: unknown[]; omitidas: { motivo: string }[] }>("/api/comisiones/cerrar-mes", { cuerpo: { mes } }); avisar("ok", `Mes cerrado: ${r.liquidaciones.length} liquidaciones aprobadas.${r.omitidas.length ? " " + r.omitidas[0].motivo : ""}`); recargar(); }
    catch (e) { avisar("error", (e as Error).message); } finally { setOcupado(false); }
  };
  return (
    <div>
      <Encabezado titulo="Comisiones por vendedor" bajada="El sistema consolida las comisiones cada día; al cierre de mes apruebas el acumulado y registras el pago.">
        <Entrada type="month" value={mes} max={hoyLima().slice(0, 7)} onChange={(e) => setMes(e.target.value)} className="w-44" aria-label="Mes" />
        {u.rol === "ADMIN" ? <Boton variante="amor" cargando={ocupado} disabled={!datos?.cerrable || !pendientesLiq} onClick={cerrar} title={datos && !datos.cerrable ? `Disponible desde el ${fechaCorta(datos.finDeMes)}` : undefined}>Cerrar mes</Boton> : null}
      </Encabezado>
      {!datos ? <Cargando /> : (
        <>
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div className="tarjeta p-5"><p className="text-[13px] font-semibold text-ink-2">Total de {nombreMes(mes)}</p><p className="cifra text-[34px] mt-1.5">{soles(total)}</p></div>
            <div className="tarjeta p-5"><p className="text-[13px] font-semibold text-ink-2">Vendedores con comisión</p><p className="cifra text-[34px] mt-1.5">{datos.vendedores.length}</p></div>
            <div className="tarjeta p-5"><p className="text-[13px] font-semibold text-ink-2">Cierre de mes</p><p className="mt-2.5">{datos.cerrable ? (pendientesLiq ? <Insignia tono="ambar">{pendientesLiq} por aprobar</Insignia> : <Insignia tono="ok">Cerrado</Insignia>) : <span className="text-sm text-ink-2">Disponible desde el {fechaCorta(datos.finDeMes)}</span>}</p></div>
          </div>
          <Tarjeta>
            {datos.vendedores.length ? (
              <table className="tabla"><thead><tr><th>Vendedor</th><th className="num">Días con comisión</th><th className="num">Productos</th><th className="num">Acumulado</th><th>Estado</th><th /></tr></thead>
                <tbody>{datos.vendedores.map((v) => (
                  <tr key={v.usuarioId}><td className="font-semibold">{v.nombre}</td><td className="num">{v.dias}</td><td className="num">{v.lineas}</td><td className="num cifra text-[17px]">{soles(v.total)}</td>
                    <td>{v.liquidacion ? (v.liquidacion.estado === "PAGADA" ? <Insignia tono="ok">Pagada {fechaCorta(v.liquidacion.pagadoEn)}</Insignia> : <Insignia tono="azul">Aprobada</Insignia>) : <Insignia>Acumulando</Insignia>}</td>
                    <td className="text-right">{u.rol === "ADMIN" && v.liquidacion?.estado === "APROBADA" ? <Boton tam="sm" onClick={async () => { try { await api(`/api/comisiones/liquidaciones/${v.liquidacion!.id}/pagar`, { metodo: "POST" }); avisar("ok", `Pago registrado para ${v.nombre}.`); recargar(); } catch (e) { avisar("error", (e as Error).message); } }}>Registrar pago</Boton> : null}</td></tr>
                ))}</tbody></table>
            ) : <Vacio titulo="Sin comisiones en este mes" />}
          </Tarjeta>
        </>
      )}
    </div>
  );
}
