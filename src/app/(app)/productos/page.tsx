"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, useDatos, soles, vence, fechaCorta } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, Entrada, Insignia, Interruptor, Modal, Pestanas, Sello, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type P = {
  id: number; codigo: string; nombre: string; principioActivo: string | null; laboratorio: string | null; categoria: string | null; condicionVenta: string; ubicacion: string | null;
  stock: number; stockVigente: number; stockMinimo: number; proximoVencimiento: string | null; costoPromedio?: number; porcentajeUtilidad?: number;
  enPromocion: boolean; campana: { id: number; porcentaje: number; estado: string; inicio: string; fin: string; nombre: string } | null; presentaciones: { id: number; nombre: string; factor: number; pvp: number }[];
};
type Lista = { productos: P[]; total: number; pagina: number; categorias: { id: number; nombre: string }[] };
type Ficha = P & { lotes: { id: number; numero: string; vencimiento: string; cantidad: number; estado: string; costoUnitario?: number }[] };

export default function Productos() {
  const u = useUsuario();
  const avisar = useAviso();
  const [q, setQ] = useState("");
  const [qq, setQq] = useState("");
  const [cat, setCat] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "promocion" | "bajo">("todos");
  const [pagina, setPagina] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setQq(q); setPagina(1); }, 250); return () => clearTimeout(h); }, [q]);
  const { datos, recargar, setDatos } = useDatos<Lista>(`/api/productos?q=${encodeURIComponent(qq)}&categoria=${cat}&filtro=${filtro === "todos" ? "" : filtro}&pagina=${pagina}`);
  const [ficha, setFicha] = useState<Ficha | null>(null);

  const alternar = async (p: P) => {
    try {
      const r = await api<{ estado: string }>(`/api/productos/${p.id}/campana`, { metodo: "POST" });
      avisar("ok", r.estado === "ACTIVA" ? `Campaña activa: ${p.nombre} comisiona ${p.campana?.porcentaje}%.` : `Campaña de ${p.nombre} en pausa.`);
      setDatos((d) => d ? { ...d, productos: d.productos.map((x) => x.id === p.id && x.campana ? { ...x, enPromocion: r.estado === "ACTIVA", campana: { ...x.campana, estado: r.estado } } : x) } : d);
    } catch (e) { avisar("error", (e as Error).message); recargar(); }
  };

  return (
    <div>
      <Encabezado titulo="Productos y stock" bajada={u.verCostos ? "Stock vigente por producto. El interruptor activa o pausa la campaña de promoción." : "Stock vigente y precios de venta."}>
        {u.rol === "ADMIN" ? <Link href="/campanas"><Boton variante="amor">Nueva campaña</Boton></Link> : null}
      </Encabezado>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Entrada className="pl-9" placeholder="Nombre, principio activo o código" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Selector className="w-52" value={cat} onChange={(e) => { setCat(e.target.value); setPagina(1); }} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {datos?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </Selector>
        <Pestanas valor={filtro} alCambiar={(v) => { setFiltro(v); setPagina(1); }} opciones={[{ valor: "todos", texto: "Todos" }, { valor: "promocion", texto: "En promoción" }, { valor: "bajo", texto: "Bajo mínimo" }]} />
      </div>
      <Tarjeta>
        {!datos ? <div className="p-5"><Cargando /></div> : datos.productos.length ? (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Categoría</th><th className="num">Stock</th><th className="num">PVP unidad</th><th>Vence primero</th>{u.verCostos ? <th className="num">Costo prom.</th> : null}<th>Campaña</th></tr></thead>
              <tbody>
                {datos.productos.map((p) => {
                  const bajo = p.stockVigente <= p.stockMinimo;
                  return (
                    <tr key={p.id}>
                      <td><button className="text-left" onClick={async () => setFicha(await api<Ficha>(`/api/productos/${p.id}`))}>
                        <span className="font-semibold hover:text-petroleo-3">{p.nombre}</span>
                        <span className="block text-[12px] text-ink-3">{p.codigo}{p.principioActivo ? ` · ${p.principioActivo}` : ""}</span>
                      </button></td>
                      <td className="text-ink-2">{p.categoria}</td>
                      <td className={`num font-semibold ${bajo ? "text-rojo" : ""}`}>{p.stockVigente}<span className="block text-[11.5px] font-normal text-ink-3">mín. {p.stockMinimo}</span></td>
                      <td className="num">{soles(p.presentaciones[0]?.pvp)}</td>
                      <td>{p.proximoVencimiento ? <Sello vence={vence(p.proximoVencimiento)} /> : <span className="text-ink-3">—</span>}</td>
                      {u.verCostos ? <td className="num text-ink-2">{soles(p.costoPromedio)}</td> : null}
                      <td>
                        {u.rol === "ADMIN" ? (
                          p.campana ? (
                            <div className="flex items-center gap-2.5">
                              <Interruptor activo={p.campana.estado === "ACTIVA"} alCambiar={() => alternar(p)} etiqueta={`Campaña de ${p.nombre}`} />
                              <span className="text-[12.5px]"><b>{p.campana.porcentaje}%</b> <span className="text-ink-3">· {p.campana.estado === "PROGRAMADA" ? `desde ${fechaCorta(p.campana.inicio)}` : `hasta ${fechaCorta(p.campana.fin)}`}</span></span>
                            </div>
                          ) : <Link href={`/campanas?codigo=${p.codigo}`} className="text-[13px] font-semibold text-petroleo-3">Crear campaña</Link>
                        ) : p.enPromocion ? <Insignia tono="amor">En promoción</Insignia> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-5 py-3 text-sm text-ink-2">
              <span>{datos.total} productos</span>
              <div className="flex gap-2">
                <Boton tam="sm" variante="borde" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</Boton>
                <Boton tam="sm" variante="borde" disabled={pagina * 50 >= datos.total} onClick={() => setPagina(pagina + 1)}>Siguiente</Boton>
              </div>
            </div>
          </div>
        ) : <Vacio titulo="No hay productos con esos filtros" />}
      </Tarjeta>
      <Modal abierto={!!ficha} alCerrar={() => setFicha(null)} titulo={ficha?.nombre ?? ""} ancho="max-w-2xl">
        {ficha ? (
          <div>
            <p className="text-sm text-ink-2">{[ficha.codigo, ficha.principioActivo, ficha.laboratorio, ficha.ubicacion && `Ubicación ${ficha.ubicacion}`].filter(Boolean).join(" · ")}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {ficha.presentaciones.map((p) => <div key={p.id} className="rounded-xl border border-foil-2 px-3 py-2"><p className="text-[12px] text-ink-3">{p.nombre}</p><p className="font-semibold">{soles(p.pvp)}</p></div>)}
              {u.verCostos ? <div className="rounded-xl bg-foil px-3 py-2"><p className="text-[12px] text-ink-3">Costo promedio · utilidad</p><p className="font-semibold">{soles(ficha.costoPromedio)} · {ficha.porcentajeUtilidad}%</p></div> : null}
            </div>
            <h3 className="font-display font-semibold text-[15px] mt-6 mb-2">Lotes</h3>
            <table className="tabla"><thead><tr><th>Lote y vencimiento</th><th>Estado</th><th className="num">Unidades</th>{u.verCostos ? <th className="num">Costo</th> : null}</tr></thead>
              <tbody>{ficha.lotes.map((l) => <tr key={l.id}><td><Sello lote={l.numero} vence={vence(l.vencimiento)} sev={l.estado === "VENCIDO" ? "CRITICA" : undefined} /></td><td>{l.estado === "ACTIVO" ? <Insignia tono="ok">Vigente</Insignia> : <Insignia tono="rojo">{l.estado[0] + l.estado.slice(1).toLowerCase()}</Insignia>}</td><td className="num">{l.cantidad}</td>{u.verCostos ? <td className="num">{soles(l.costoUnitario)}</td> : null}</tr>)}</tbody></table>
            {["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"].includes(u.rol) ? <div className="mt-5 flex justify-end"><Link href={`/kardex?productoId=${ficha.id}`}><Boton variante="borde">Ver kardex</Boton></Link></div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
