"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { useDatos, soles, fechaCorta, numero } from "@/lib/cliente";
import { descargarCsv } from "@/lib/csv";
import { Boton, Cargando, Encabezado, Insignia, Tarjeta, Vacio } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { tieneRol } from "@/lib/permisos";

type Linea = { id: number; fecha: string; origen: string; porcentaje: number; base: number; monto: number; tipoComprobante: string; serie: string; numero: number; producto: string | null; presentacion: string | null; lote: string | null; cantidad: number | null; vendido: number | null };
type Detalle = { vendedor: string; mes: string; total: number; vendido: number; lineas: Linea[] };

const nombreMes = (m: string) => new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-15T12:00:00Z"));
const comprobante = (l: Linea) => `${l.serie}-${String(l.numero).padStart(8, "0")}`;
const AJUSTE = "Ajuste por venta anulada";

function DetalleComisiones() {
  const u = useUsuario();
  const sp = useSearchParams();
  const usuario = sp.get("usuario");
  const mes = sp.get("mes");
  const permitido = tieneRol(u.roles, "ADMIN", "CONTADOR");
  const { datos, error } = useDatos<Detalle>(permitido && usuario && mes ? `/api/comisiones/detalle?usuario=${usuario}&mes=${mes}` : null);
  if (!permitido) return <Tarjeta><Vacio titulo="Sin acceso">Este detalle solo lo ven el administrador y el contador.</Vacio></Tarjeta>;
  if (!usuario || !mes) return <Tarjeta><Vacio titulo="Elige un vendedor"><Link className="font-semibold text-vino-2" href="/comisiones">Volver a comisiones</Link></Vacio></Tarjeta>;
  if (error) return <p className="text-rojo">{error}</p>;
  if (!datos) return <Cargando alto="h-80" />;
  const exportar = () => descargarCsv(`comisiones-${datos.vendedor}-${datos.mes}.csv`,
    ["Fecha", "Comprobante", "Producto", "Presentación", "Lote", "Cantidad", "Vendido", "Base sin IGV", "Comisión %", "Comisión", "Origen"],
    datos.lineas.map((l) => [fechaCorta(l.fecha), comprobante(l), l.producto ?? AJUSTE, l.presentacion ?? "", l.lote ?? "", l.cantidad ?? "", l.vendido ?? "", l.base, l.porcentaje, l.monto, l.origen === "SUGERENCIA" ? "Complemento" : l.origen === "AJUSTE" ? "Ajuste" : "Directa"]));
  return (
    <div>
      <Link href="/comisiones" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 mb-3"><ArrowLeft size={15} /> Comisiones</Link>
      <Encabezado titulo={datos.vendedor} bajada={<>Lo que vendió con comisión en <span className="capitalize">{nombreMes(datos.mes)}</span></>}>
        <Boton variante="borde" onClick={exportar} disabled={!datos.lineas.length}><Download size={16} /> Excel</Boton>
      </Encabezado>
      <Tarjeta>
        {datos.lineas.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Fecha</th><th>Comprobante</th><th>Producto</th><th className="num">Cantidad</th><th className="num">Vendido</th><th className="num">%</th><th className="num">Comisión</th></tr></thead>
            <tbody>{datos.lineas.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{fechaCorta(l.fecha)}</td>
                <td className="whitespace-nowrap"><span className="sello">{comprobante(l)}</span></td>
                <td>
                  <span className="font-semibold">{l.producto ?? AJUSTE}</span>
                  {l.origen === "SUGERENCIA" ? <Insignia tono="azul" className="ml-2">Complemento</Insignia> : null}
                  {l.producto ? <span className="block text-[12px] text-ink-3">{l.presentacion} · lote {l.lote}</span> : null}
                </td>
                <td className="num">{numero(l.cantidad, 2)}</td>
                <td className="num">{l.vendido === null ? "—" : soles(l.vendido)}</td>
                <td className="num">{numero(l.porcentaje, 2)}%</td>
                <td className="num font-semibold">{soles(l.monto)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="font-semibold"><td colSpan={4}>Total</td><td className="num">{soles(datos.vendido)}</td><td /><td className="num">{soles(datos.total)}</td></tr></tfoot>
          </table></div>
        ) : <Vacio titulo="Sin ventas con comisión en este mes" />}
      </Tarjeta>
    </div>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><DetalleComisiones /></Suspense>; }
