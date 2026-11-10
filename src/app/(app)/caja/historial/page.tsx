"use client";
import Link from "next/link";
import { Printer, Search, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, Insignia, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { tieneRol } from "@/lib/permisos";

type S = {
  id: number; caja: string; cajero: string; turno: string; abiertaEn: string; cerradaEn: string | null; estado: string;
  diferencia: number | null; saldoEfectivo: number; saldoVirtual: number;
};

type Cargo = { id: number; sesionId: number; monto: number; comentario: string | null; fecha: string; cajero: string; estado: string; pagadoEn: string | null; pagadoPor: string | null; registradoPor: string };

/** Faltantes de efectivo que asumió un cajero: el administrador marca cuándo los paga. */
function Cargos() {
  const u = useUsuario();
  const avisar = useAviso();
  const [verPagados, setVerPagados] = useState(false);
  const { datos, recargar } = useDatos<Cargo[]>(`/api/caja/cargos${verPagados ? "" : "?estado=PENDIENTE"}`);
  const [pagando, setPagando] = useState<number | null>(null);
  const esAdmin = u.roles.includes("ADMIN");
  if (!datos || (!datos.length && !verPagados)) return null;
  const pendiente = datos.filter((c) => c.estado === "PENDIENTE").reduce((a, c) => a + c.monto, 0);
  return (
    <Tarjeta className="mb-6" titulo={<span>Cargos a cajeros <span className="text-ink-3 font-sans font-normal text-[13px] ml-2">pendiente {soles(pendiente)}</span></span>}
      accion={<Boton tam="sm" variante="fantasma" onClick={() => setVerPagados((v) => !v)}>{verPagados ? "Solo pendientes" : "Ver también pagados"}</Boton>}>
      <p className="px-5 -mt-2 mb-2 text-[13px] text-ink-2">Faltantes de efectivo que el administrador registró a cargo del cajero al regularizar un cierre.</p>
      {datos.length ? (
        <div className="overflow-x-auto"><table className="tabla">
          <thead><tr><th>Fecha</th><th>Cajero</th><th>Cierre</th><th>Motivo</th><th className="num">Monto</th><th>Estado</th>{esAdmin ? <th /> : null}</tr></thead>
          <tbody>{datos.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">{fechaHora(c.fecha)}</td><td className="font-semibold">{c.cajero}</td>
              <td><Link href={`/caja/reporte/${c.sesionId}`} className="font-semibold text-petroleo-3 hover:underline">Sesión {String(c.sesionId).padStart(6, "0")}</Link></td>
              <td className="text-[13px]">{c.comentario ?? "—"}<span className="block text-[12px] text-ink-3">Registró {c.registradoPor}</span></td>
              <td className="num font-semibold">{soles(c.monto)}</td>
              <td>{c.estado === "PAGADO" ? <><Insignia tono="ok">Pagado</Insignia><span className="block text-[12px] text-ink-3 mt-0.5">{fechaHora(c.pagadoEn)}{c.pagadoPor ? ` · ${c.pagadoPor}` : ""}</span></> : <Insignia tono="ambar">Pendiente</Insignia>}</td>
              {esAdmin ? <td className="text-right">{c.estado === "PENDIENTE" ? <Boton tam="sm" variante="borde" cargando={pagando === c.id} onClick={async () => {
                setPagando(c.id);
                try { await api(`/api/caja/cargos/${c.id}/pagar`, { metodo: "POST" }); avisar("ok", `Cargo de ${c.cajero} marcado como pagado.`); recargar(); }
                catch (e) { avisar("error", (e as Error).message); } finally { setPagando(null); }
              }}>Marcar pagado</Boton> : null}</td> : null}
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="px-5 pb-5 text-sm text-ink-3">No hay cargos.</p>}
    </Tarjeta>
  );
}

const conSigno = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${soles(Math.abs(n))}`;
const tonoDif = (n: number) => (n < -0.004 ? "bg-rojo-claro text-rojo" : n > 0.004 ? "bg-ok-claro text-ok" : "text-ink-2");

export default function Historial() {
  const u = useUsuario();
  const { datos } = useDatos<S[]>("/api/caja/sesiones");
  return (
    <div>
      <Encabezado titulo="Cierres de caja" bajada="Saldo declarado por el cajero al cerrar y su diferencia con lo registrado en el sistema.">
        {tieneRol(u.roles, "ADMIN", "CONTADOR") ? <Link href="/caja/eliminaciones"><Boton variante="borde"><ShieldAlert size={16} /> Eliminaciones</Boton></Link> : null}
      </Encabezado>
      <Cargos />
      <Tarjeta>
        {!datos ? <div className="p-5"><Cargando /></div> : datos.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr>
              <th>Usuario</th><th>Apertura</th><th>Cierre</th>
              <th className="num">Saldo final efectivo</th><th className="num">Saldo final virtual</th><th className="num">Diferencia</th><th className="text-right">Detalle</th>
            </tr></thead>
            <tbody>{datos.map((s) => {
              const d = s.diferencia ?? 0;
              return (
                <tr key={s.id}>
                  <td><span className="font-semibold">{s.cajero}</span><span className="block text-[12px] text-ink-3">Sesión {String(s.id).padStart(6, "0")} · turno {s.turno.toLowerCase()}</span></td>
                  <td className="whitespace-nowrap">{fechaHora(s.abiertaEn)}</td>
                  <td className="whitespace-nowrap">{fechaHora(s.cerradaEn)}</td>
                  <td className="num">{soles(s.saldoEfectivo)}</td>
                  <td className="num">{soles(s.saldoVirtual)}</td>
                  <td className="num"><span className={`inline-block rounded-full px-2.5 py-0.5 font-semibold tabular-nums ${tonoDif(d)}`}>{conSigno(d)}</span></td>
                  <td className="text-right whitespace-nowrap">
                    {s.estado === "EN_CIERRE" ? <Insignia tono="ambar" className="mr-1">Por aprobar</Insignia> : null}
                    <Link href={`/caja/reporte/${s.id}`} title="Ver detalle" aria-label={`Ver detalle del cierre ${s.id}`} className="inline-grid size-8 place-items-center rounded-lg bg-petroleo text-white hover:bg-petroleo-2"><Search size={15} /></Link>
                    <Link href={`/caja/reporte/${s.id}?imprimir=1`} title="Imprimir" aria-label={`Imprimir el cierre ${s.id}`} className="ml-1.5 inline-grid size-8 place-items-center rounded-lg border border-foil-3 text-ink-2 hover:text-ink"><Printer size={15} /></Link>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Vacio titulo="Aún no hay cierres">Los cierres aparecen aquí cuando un cajero cierra su caja.</Vacio>}
      </Tarjeta>
      <p className="text-[12.5px] text-ink-3 mt-3">Diferencia en rojo: faltante. En verde: sobrante. Los pagos virtuales que el cajero no confirmó cuentan como faltante.</p>
    </div>
  );
}
