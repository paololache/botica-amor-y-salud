"use client";
import Link from "next/link";
import { Printer, Search, ShieldAlert } from "lucide-react";
import { useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, Insignia, Tarjeta, Vacio } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { tieneRol } from "@/lib/permisos";

type S = {
  id: number; caja: string; cajero: string; turno: string; abiertaEn: string; cerradaEn: string | null; estado: string;
  diferencia: number | null; saldoEfectivo: number; saldoVirtual: number;
};

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
                    {s.estado === "EN_CIERRE" ? <Insignia tono="ambar" className="mr-1">Por validar</Insignia> : null}
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
