"use client";
import Link from "next/link";
import { useState } from "react";
import { Download } from "lucide-react";
import { useDatos, soles, fechaHora } from "@/lib/cliente";
import { descargarCsv } from "@/lib/csv";
import { Boton, Cargando, Encabezado, Insignia, Selector, Tarjeta, Vacio } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type E = {
  id: number; fecha: string; eliminadoPor: string; sesionId: number | null; caja: string | null; cajero: string | null; estadoSesion: string | null; porOtraPersona: boolean;
  tipo: string; concepto: string; medio: string; monto: number; comprobante: string | null; motivo: string | null; registradoEn: string | null;
};

export default function Eliminaciones() {
  const u = useUsuario();
  const [dias, setDias] = useState(30);
  const { datos, error } = useDatos<E[]>(u.rol === "ADMIN" || u.rol === "CONTADOR" ? `/api/caja/eliminaciones?dias=${dias}` : null);
  if (u.rol !== "ADMIN" && u.rol !== "CONTADOR") return <Tarjeta><Vacio titulo="Sin acceso">Este registro solo lo ven el administrador y el contador.</Vacio></Tarjeta>;
  const lista = datos ?? [];
  const total = lista.reduce((a, e) => a + e.monto, 0);
  const exportar = () => descargarCsv(`eliminaciones-caja-${dias}d.csv`,
    ["Eliminado", "Eliminado por", "Caja", "Sesión", "Cajero", "Tipo", "Concepto", "Medio", "Monto", "Comprobante", "Registrado", "Motivo"],
    lista.map((e) => [fechaHora(e.fecha), e.eliminadoPor, e.caja ?? "", e.sesionId ?? "", e.cajero ?? "", e.tipo, e.concepto, e.medio, e.monto, e.comprobante ?? "", e.registradoEn ? fechaHora(e.registradoEn) : "", e.motivo ?? ""]));
  return (
    <div>
      <Encabezado titulo="Eliminaciones de caja" bajada={`Ingresos y egresos que se borraron de una caja abierta · ${lista.length} en el periodo · ${soles(total)}`}>
        <Selector value={dias} onChange={(e) => setDias(Number(e.target.value))} className="w-44" aria-label="Periodo"><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option></Selector>
        <Boton variante="borde" onClick={exportar} disabled={!lista.length}><Download size={16} /> Excel</Boton>
      </Encabezado>
      <Tarjeta>
        {error ? <p className="p-5 text-rojo">{error}</p> : !datos ? <div className="p-5"><Cargando /></div> : lista.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Eliminado</th><th>Por</th><th>Caja · sesión</th><th>Cajero</th><th>Movimiento</th><th className="num">Monto</th><th>Motivo</th></tr></thead>
            <tbody>{lista.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{fechaHora(e.fecha)}</td>
                <td>{e.eliminadoPor}{e.porOtraPersona ? <Insignia tono="ambar" className="ml-2">No es el cajero</Insignia> : null}</td>
                <td className="whitespace-nowrap">{e.caja ?? "—"}{e.sesionId ? <> · {e.estadoSesion === "ABIERTA" ? <span className="sello">{String(e.sesionId).padStart(6, "0")}</span> : <Link className="font-semibold text-vino-2" href={`/caja/reporte/${e.sesionId}`}>{String(e.sesionId).padStart(6, "0")}</Link>}</> : null}</td>
                <td>{e.cajero ?? "—"}</td>
                <td><Insignia tono={e.tipo === "INGRESO" ? "ok" : "ambar"}>{e.tipo === "INGRESO" ? "Ingreso" : "Egreso"}</Insignia> <span className="ml-1">{e.concepto}</span><span className="block text-[12px] text-ink-3">{e.medio[0] + e.medio.slice(1).toLowerCase()}{e.comprobante ? ` · ${e.comprobante}` : ""}{e.registradoEn ? ` · registrado ${fechaHora(e.registradoEn)}` : ""}</span></td>
                <td className="num font-semibold">{soles(e.monto)}</td>
                <td className={e.motivo ? "" : "text-ink-3"}>{e.motivo ?? "Sin motivo"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Vacio titulo="Sin eliminaciones en este periodo">Cada vez que alguien borre un ingreso o egreso de una caja aparecerá aquí, con su motivo.</Vacio>}
      </Tarjeta>
    </div>
  );
}
