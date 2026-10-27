"use client";
import Link from "next/link";
import { useDatos, soles, fechaHora } from "@/lib/cliente";
import { Cargando, Encabezado, Insignia, Tarjeta, Vacio } from "@/components/ui";

type S = { id: number; caja: string; cajero: string; turno: string; abiertaEn: string; cerradaEn: string | null; estado: string; diferencia: number | null };

export default function Historial() {
  const { datos } = useDatos<S[]>("/api/caja/sesiones");
  return (
    <div>
      <Encabezado titulo="Cierres de caja" bajada="Cada cierre tiene su reporte con el arqueo por medio de pago." />
      <Tarjeta>
        {!datos ? <div className="p-5"><Cargando /></div> : datos.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Sesión</th><th>Caja</th><th>Cajero</th><th>Turno</th><th>Cierre</th><th className="num">Diferencia</th><th /></tr></thead>
            <tbody>{datos.map((s) => (
              <tr key={s.id}>
                <td><span className="sello">{String(s.id).padStart(6, "0")}</span></td><td>{s.caja}</td><td>{s.cajero}</td><td className="capitalize">{s.turno.toLowerCase()}</td><td>{fechaHora(s.cerradaEn)}</td>
                <td className={`num font-semibold ${Math.abs(s.diferencia ?? 0) > 5 ? "text-rojo" : ""}`}>{soles(s.diferencia)}</td>
                <td className="text-right">{s.estado === "EN_CIERRE" ? <Insignia tono="ambar">Por validar</Insignia> : null} <Link className="text-petroleo-3 font-semibold text-sm ml-2" href={`/caja/reporte/${s.id}`}>Ver reporte</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Vacio titulo="Aún no hay cierres">Los cierres aparecen aquí cuando un cajero cierra su caja.</Vacio>}
      </Tarjeta>
    </div>
  );
}
