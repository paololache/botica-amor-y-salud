"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpenText, Eye, Pencil, Plus, Search } from "lucide-react";
import { api, useDatos, soles, vence, fechaCorta, hoyLima } from "@/lib/cliente";
import { Boton, Cargando, Encabezado, Entrada, Insignia, Interruptor, Modal, Pestanas, Sello, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { FormProducto, type ProductoEditable } from "@/components/form-producto";
import { useUsuario } from "@/components/shell";

type P = {
  id: number; codigo: string; nombre: string; principioActivo: string | null; concentracion: string | null; formaFarmaceutica: string | null; registroSanitario: string | null; registroVence: string | null;
  laboratorio: string | null; categoria: string | null; condicionVenta: string; ubicacion: string | null;
  stock: number; stockVigente: number; stockMinimo: number; proximoVencimiento: string | null; costoPromedio?: number; porcentajeUtilidad?: number;
  enPromocion: boolean; campana: { id: number; porcentaje: number; estado: string; inicio: string; fin: string; nombre: string } | null; presentaciones: { id: number; nombre: string; factor: number; pvp: number; codigo: string | null }[];
};
type Lista = { productos: P[]; total: number; pagina: number; categorias: { id: number; nombre: string }[] };
type Ficha = P & { categoriaId: number | null; tieneKardex: boolean; lotes: { id: number; numero: string; vencimiento: string; cantidad: number; estado: string; costoUnitario?: number }[] };

const ICONO = "size-8 grid place-items-center rounded-lg border border-foil-3 text-ink-2 hover:border-vino-2 hover:text-vino";

/** Stock expresado en el empaque más grande: "2 cajas + 3 und." */
function desglose(unidades: number, presentaciones: P["presentaciones"]) {
  const mayor = presentaciones[presentaciones.length - 1];
  if (!mayor || mayor.factor <= 1 || unidades < mayor.factor) return null;
  const n = Math.floor(unidades / mayor.factor);
  const resto = unidades % mayor.factor;
  const empaque = mayor.nombre.split(" ")[0].toLowerCase();
  return `${n} ${empaque}${n > 1 ? "s" : ""}${resto ? ` + ${resto} und.` : ""}`;
}

export default function Productos() {
  const u = useUsuario();
  const avisar = useAviso();
  const [q, setQ] = useState("");
  const [qq, setQq] = useState("");
  const [cat, setCat] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "promocion" | "bajo" | "vencer">("todos");
  const [pagina, setPagina] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setQq(q); setPagina(1); }, 250); return () => clearTimeout(h); }, [q]);
  const { datos, recargar, setDatos } = useDatos<Lista>(`/api/productos?q=${encodeURIComponent(qq)}&categoria=${cat}&filtro=${filtro === "todos" ? "" : filtro}&pagina=${pagina}`);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [form, setForm] = useState<{ producto: ProductoEditable | null } | null>(null);
  const puedeKardex = ["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"].includes(u.rol);
  const verFicha = async (id: number) => { try { setFicha(await api<Ficha>(`/api/productos/${id}`)); } catch (e) { avisar("error", (e as Error).message); } };
  const editar = async (id: number) => { try { setForm({ producto: await api<Ficha>(`/api/productos/${id}`) }); } catch (e) { avisar("error", (e as Error).message); } };
  const pvpDe = (p: P, factor: (f: number) => boolean) => p.presentaciones.find((x) => factor(x.factor));

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
        {u.rol === "ADMIN" ? <Link href="/campanas"><Boton variante="borde">Nueva campaña</Boton></Link> : null}
        {u.rol === "ADMIN" ? <Boton variante="amor" onClick={() => setForm({ producto: null })}><Plus size={16} /> Agregar producto</Boton> : null}
      </Encabezado>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Entrada className="pl-9" placeholder="Nombre, principio activo, laboratorio o código" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Selector className="w-52" value={cat} onChange={(e) => { setCat(e.target.value); setPagina(1); }} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {datos?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </Selector>
        <Pestanas valor={filtro} alCambiar={(v) => { setFiltro(v); setPagina(1); }} opciones={[{ valor: "todos", texto: "Todos" }, { valor: "promocion", texto: "En promoción" }, { valor: "bajo", texto: "Bajo mínimo" }, { valor: "vencer", texto: "Por vencer (90 días)" }]} />
      </div>
      <Tarjeta>
        {!datos ? <div className="p-5"><Cargando /></div> : datos.productos.length ? (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Código de barras</th><th className="min-w-[220px]">Producto</th><th>Laboratorio</th>{u.verCostos ? <th className="num">Costo unit.</th> : null}<th className="num">P. unidad</th><th className="num">P. blíster</th><th className="num">P. caja</th><th className="num">Stock</th><th>Vence</th><th>Campaña</th><th className="text-right">Opciones</th></tr></thead>
              <tbody>
                {datos.productos.map((p) => {
                  const bajo = p.stockVigente <= p.stockMinimo;
                  const blister = p.presentaciones.find((x) => x.nombre.startsWith("Blíster"));
                  const caja = p.presentaciones.find((x) => x.nombre.startsWith("Caja"));
                  const empaques = desglose(p.stockVigente, p.presentaciones);
                  const noVendibles = p.stock - p.stockVigente;
                  return (
                    <tr key={p.id}>
                      <td className="text-[12.5px] text-ink-2 tabular-nums whitespace-nowrap">{p.codigo}</td>
                      <td>
                        <span className="font-semibold">{p.nombre}</span>
                        <span className="block text-[12px] text-ink-3">{[p.principioActivo, p.concentracion, p.formaFarmaceutica, p.categoria].filter(Boolean).join(" · ")}</span>
                        {p.condicionVenta !== "LIBRE" ? <Insignia tono="ambar" className="mt-1">{p.condicionVenta === "RECETA" ? "Con receta" : "Receta retenida"}</Insignia> : null}
                        {p.registroVence && p.registroVence < hoyLima() ? <Insignia tono="rojo" className="mt-1">Registro vencido</Insignia> : null}
                      </td>
                      <td className="text-ink-2">{p.laboratorio ?? "—"}</td>
                      {u.verCostos ? <td className="num text-ink-2">{soles(p.costoPromedio)}</td> : null}
                      <td className="num">{soles(pvpDe(p, (f) => f === 1)?.pvp)}</td>
                      <td className="num">{blister ? <>{soles(blister.pvp)}<span className="block text-[11.5px] text-ink-3">x{blister.factor}</span></> : <span className="text-ink-3">—</span>}</td>
                      <td className="num">{caja ? <>{soles(caja.pvp)}<span className="block text-[11.5px] text-ink-3">x{caja.factor}</span></> : <span className="text-ink-3">—</span>}</td>
                      <td className={`num font-semibold ${bajo ? "text-rojo" : ""}`}>{p.stockVigente}{empaques ? <span className="block text-[11.5px] font-normal text-ink-2 whitespace-nowrap">{empaques}</span> : null}<span className="block text-[11.5px] font-normal text-ink-3">mín. {p.stockMinimo}</span>{noVendibles > 0 ? <span className="block text-[11.5px] font-semibold text-rojo whitespace-nowrap">{noVendibles} no vendibles</span> : null}</td>
                      <td>{p.proximoVencimiento ? <Sello vence={vence(p.proximoVencimiento)} /> : <span className="text-ink-3">—</span>}</td>
                      <td>
                        {u.rol === "ADMIN" ? (
                          p.campana ? (
                            <div className="flex items-center gap-2.5">
                              <Interruptor activo={p.campana.estado === "ACTIVA"} alCambiar={() => alternar(p)} etiqueta={`Campaña de ${p.nombre}`} />
                              <span className="text-[12.5px] whitespace-nowrap"><b>{p.campana.porcentaje}%</b> <span className="text-ink-3">· {p.campana.estado === "PROGRAMADA" ? `desde ${fechaCorta(p.campana.inicio)}` : `hasta ${fechaCorta(p.campana.fin)}`}</span></span>
                            </div>
                          ) : <Link href={`/campanas?codigo=${p.codigo}`} className="text-[13px] font-semibold text-vino-2 whitespace-nowrap">Crear campaña</Link>
                        ) : p.enPromocion ? <Insignia tono="amor">En promoción</Insignia> : null}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button className={ICONO} onClick={() => verFicha(p.id)} title="Ver lotes y detalle" aria-label={`Ver ${p.nombre}`}><Eye size={16} /></button>
                          {puedeKardex ? <Link className={ICONO} href={`/kardex?productoId=${p.id}`} title="Ver kardex" aria-label={`Kardex de ${p.nombre}`}><BookOpenText size={16} /></Link> : null}
                          {u.rol === "ADMIN" ? <button className={ICONO} onClick={() => editar(p.id)} title="Editar producto" aria-label={`Editar ${p.nombre}`}><Pencil size={16} /></button> : null}
                        </div>
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
            <p className="text-sm text-ink-2">{[ficha.codigo, ficha.principioActivo, ficha.concentracion, ficha.formaFarmaceutica, ficha.laboratorio, ficha.ubicacion && `Ubicación ${ficha.ubicacion}`].filter(Boolean).join(" · ")}</p>
            {ficha.registroSanitario ? <p className="text-sm text-ink-2 mt-1">Registro sanitario {ficha.registroSanitario}{ficha.registroVence ? ` · vence ${vence(ficha.registroVence)}` : ""}</p> : null}
            <div className="flex flex-wrap gap-2 mt-4">
              {ficha.presentaciones.map((p) => <div key={p.id} className="rounded-xl border border-foil-2 px-3 py-2"><p className="text-[12px] text-ink-3">{p.nombre}</p><p className="font-semibold">{soles(p.pvp)}</p>{p.codigo ? <p className="text-[11.5px] text-ink-3 tabular-nums">{p.codigo}</p> : null}</div>)}
              {u.verCostos ? <div className="rounded-xl bg-foil px-3 py-2"><p className="text-[12px] text-ink-3">Costo promedio · utilidad</p><p className="font-semibold">{soles(ficha.costoPromedio)} · {ficha.porcentajeUtilidad}%</p></div> : null}
            </div>
            <h3 className="font-display font-semibold text-[15px] mt-6 mb-2">Lotes</h3>
            <table className="tabla"><thead><tr><th>Lote y vencimiento</th><th>Estado</th><th className="num">Unidades</th>{u.verCostos ? <th className="num">Costo</th> : null}</tr></thead>
              <tbody>{ficha.lotes.map((l) => <tr key={l.id}><td><Sello lote={l.numero} vence={vence(l.vencimiento)} sev={l.estado === "VENCIDO" ? "CRITICA" : undefined} /></td><td>{l.estado === "ACTIVO" ? <Insignia tono="ok">Vigente</Insignia> : <Insignia tono="rojo">{l.estado[0] + l.estado.slice(1).toLowerCase()}</Insignia>}</td><td className="num">{l.cantidad}</td>{u.verCostos ? <td className="num">{soles(l.costoUnitario)}</td> : null}</tr>)}</tbody></table>
            {puedeKardex ? <div className="mt-5 flex justify-end"><Link href={`/kardex?productoId=${ficha.id}`}><Boton variante="borde">Ver kardex</Boton></Link></div> : null}
          </div>
        ) : null}
      </Modal>
      {form ? <FormProducto producto={form.producto} categorias={datos?.categorias ?? []} alCerrar={() => setForm(null)} alGuardar={() => { setForm(null); recargar(); }} /> : null}
    </div>
  );
}
