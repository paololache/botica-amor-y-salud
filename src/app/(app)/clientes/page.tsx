"use client";
import { useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { api, useDatos, soles, fechaHora, numero } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Modal, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { puede } from "@/lib/permisos";

type Nivel = "NUEVO" | "OCASIONAL" | "FRECUENTE" | "PREFERENTE";
type Cliente = { id: number; tipoDoc: string; numero: string; nombre: string; telefono: string | null; email: string | null; notas: string | null; compras: number; total: number; ultima: string | null; servicios: number; nivel: Nivel };
type Lista = { umbralOfertas: number; conteo: Record<Nivel, number>; clientes: Cliente[] };
type Detalle = {
  encontrado: true; cliente: { id: number; numero: string; nombre: string; telefono: string | null; notas: string | null };
  compras: number;
  historial: { id: number; fecha: string; serie: string; numero: number; total: number; tipo: string; vendedor: string; productos: string }[];
  nivelNombre: string; nivel: Nivel; faltanParaOfertas: number; total: number; servicios: number;
  ofertas: { productoId: number; producto: string; porcentaje: number; precio: { presentacion: string; campana: number; lista: number } | null; yaLoCompro: boolean }[];
  habituales: { productoId: number; nombre: string; veces: number }[];
};

const NIVEL: Record<Nivel, { texto: string; tono: "gris" | "azul" | "petroleo" | "amor"; ayuda: string }> = {
  NUEVO: { texto: "Nuevo", tono: "gris", ayuda: "1 compra o ninguna" },
  OCASIONAL: { texto: "Ocasional", tono: "azul", ayuda: "2 a 4 compras" },
  FRECUENTE: { texto: "Frecuente", tono: "petroleo", ayuda: "5 compras o más" },
  PREFERENTE: { texto: "Preferente", tono: "amor", ayuda: "recibe ofertas" },
};
const vacio = { tipoDoc: "DNI", numero: "", nombre: "", telefono: "", email: "", notas: "" };

export default function Clientes() {
  const u = useUsuario();
  const avisar = useAviso();
  const [buscar, setBuscar] = useState("");
  const [nivel, setNivel] = useState<Nivel | "">("");
  const q = new URLSearchParams({ ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(nivel ? { nivel } : {}) });
  const { datos, recargar, cargando } = useDatos<Lista>(`/api/clientes?${q}`);
  const [ver, setVer] = useState<number | null>(null);
  const detalle = useDatos<Detalle>(ver ? `/api/clientes/${ver}` : null);
  const [form, setForm] = useState<{ id?: number; datos: typeof vacio } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const edita = puede(u.roles, "clientes");

  const guardar = async () => {
    if (!form) return;
    setOcupado(true); setError(null);
    try {
      await api(form.id ? `/api/clientes/${form.id}` : "/api/clientes", { metodo: form.id ? "PUT" : "POST", cuerpo: form.datos });
      avisar("ok", form.id ? "Cliente actualizado." : "Cliente registrado.");
      setForm(null); recargar(); if (ver) detalle.recargar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  return (
    <div>
      <Encabezado titulo="Clientes" bajada={`Se registran solos al vender con DNI o RUC. Con más de ${datos?.umbralOfertas ?? 10} compras pasan a preferentes y en Vender se les ofrecen los productos en promoción.`}>
        {edita ? <Boton variante="amor" onClick={() => { setError(null); setForm({ datos: { ...vacio } }); }}><Plus size={16} /> Agregar cliente</Boton> : null}
      </Encabezado>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {(Object.keys(NIVEL) as Nivel[]).map((n) => (
          <button key={n} onClick={() => setNivel(nivel === n ? "" : n)} aria-pressed={nivel === n}
            className={`tarjeta p-4 text-left transition ${nivel === n ? "ring-2 ring-petroleo" : "hover:border-foil-3"}`}>
            <Insignia tono={NIVEL[n].tono}>{NIVEL[n].texto}</Insignia>
            <p className="cifra text-[28px] mt-2 leading-none">{datos ? numero(datos.conteo[n]) : "—"}</p>
            <p className="text-[12px] text-ink-3 mt-1">{n === "PREFERENTE" ? `más de ${datos?.umbralOfertas ?? 10} compras · ${NIVEL[n].ayuda}` : NIVEL[n].ayuda}</p>
          </button>
        ))}
      </div>
      <Tarjeta>
        <div className="p-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" /><Entrada value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, DNI/RUC o teléfono" className="pl-9" /></div>
          <Selector value={nivel} onChange={(e) => setNivel(e.target.value as Nivel | "")} className="w-48" aria-label="Nivel"><option value="">Todos los niveles</option>{(Object.keys(NIVEL) as Nivel[]).map((n) => <option key={n} value={n}>{NIVEL[n].texto}</option>)}</Selector>
        </div>
        {!datos ? <div className="p-5"><Cargando /></div> : datos.clientes.length ? (
          <div className={`overflow-x-auto ${cargando ? "opacity-60" : ""}`}><table className="tabla">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Nivel</th><th className="num">Compras</th><th className="num">Total comprado</th><th>Última compra</th><th className="num">Servicios</th><th /></tr></thead>
            <tbody>{datos.clientes.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => setVer(c.id)}>
                <td><span className="font-semibold">{c.nombre}</span>{c.telefono ? <span className="block text-[12px] text-ink-3">{c.telefono}</span> : null}</td>
                <td className="tabular-nums whitespace-nowrap">{c.tipoDoc} {c.numero}</td>
                <td><Insignia tono={NIVEL[c.nivel].tono}>{NIVEL[c.nivel].texto}</Insignia></td>
                <td className="num font-semibold">{numero(c.compras)}</td>
                <td className="num">{soles(c.total)}</td>
                <td className="whitespace-nowrap">{c.ultima ? fechaHora(c.ultima) : "—"}</td>
                <td className="num">{c.servicios || "—"}</td>
                <td className="text-right">{edita ? <button onClick={(e) => { e.stopPropagation(); setError(null); setForm({ id: c.id, datos: { tipoDoc: c.tipoDoc, numero: c.numero, nombre: c.nombre, telefono: c.telefono ?? "", email: c.email ?? "", notas: c.notas ?? "" } }); }} className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-foil" aria-label={`Editar ${c.nombre}`}><Pencil size={15} /></button> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Vacio titulo="Sin clientes con estos filtros">Los clientes se registran al vender con su DNI o RUC.</Vacio>}
      </Tarjeta>

      <Modal abierto={!!ver} alCerrar={() => setVer(null)} titulo={detalle.datos?.cliente.nombre ?? "Cliente"} ancho="max-w-3xl">
        {!detalle.datos ? <Cargando /> : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Insignia tono={NIVEL[detalle.datos.nivel].tono}>{detalle.datos.nivelNombre}</Insignia>
              <span className="text-[13px] text-ink-2">{detalle.datos.compras} {detalle.datos.compras === 1 ? "compra" : "compras"} · {soles(detalle.datos.total)} en total{detalle.datos.servicios ? ` · ${detalle.datos.servicios} servicios` : ""}</span>
              {detalle.datos.nivel !== "PREFERENTE" ? <span className="text-[12.5px] text-ink-3">· le faltan {detalle.datos.faltanParaOfertas} compras para recibir ofertas</span> : null}
            </div>
            {detalle.datos.cliente.notas ? <p className="rounded-xl bg-ambar-claro px-3 py-2 text-[13px] text-[#8a5b00]">Nota: {detalle.datos.cliente.notas}</p> : null}
            {detalle.datos.nivel === "PREFERENTE" ? (
              <section>
                <h3 className="font-semibold text-[14px] mb-1.5">Ofertas para ofrecerle (productos en promoción)</h3>
                {detalle.datos.ofertas.length ? <ul className="grid sm:grid-cols-2 gap-2">{detalle.datos.ofertas.map((o) => (
                  <li key={o.productoId} className="rounded-xl border border-amor/25 bg-amor-claro/40 px-3 py-2 text-[13px]"><b>{o.producto}</b><span className="block text-ink-2">{o.precio ? `${o.precio.presentacion} a ${soles(o.precio.campana)} (antes ${soles(o.precio.lista)})` : "En promoción"}{o.yaLoCompro ? " · ya lo compró" : ""}</span></li>
                ))}</ul> : <p className="text-[13px] text-ink-3">No hay productos en promoción vigentes.</p>}
              </section>
            ) : null}
            {detalle.datos.habituales.length ? <p className="text-[13px]"><span className="font-semibold">Suele llevar:</span> {detalle.datos.habituales.map((h) => `${h.nombre} (${h.veces})`).join(", ")}</p> : null}
            <section>
              <h3 className="font-semibold text-[14px] mb-1.5">Últimas compras</h3>
              {detalle.datos.historial.length ? <div className="overflow-x-auto max-h-72 overflow-y-auto"><table className="tabla">
                <thead><tr><th>Fecha</th><th>Comprobante</th><th>Productos</th><th>Atendió</th><th className="num">Total</th></tr></thead>
                <tbody>{detalle.datos.historial.map((v) => (
                  <tr key={v.id}><td className="whitespace-nowrap">{fechaHora(v.fecha)}</td><td className="whitespace-nowrap"><a href={`/comprobante/${v.id}?formato=ticket`} target="_blank" rel="noopener" className="font-semibold text-petroleo-3 hover:underline">{v.serie}-{v.numero}</a></td><td className="text-[12.5px]">{v.productos}</td><td>{v.vendedor}</td><td className="num">{soles(v.total)}</td></tr>
                ))}</tbody>
              </table></div> : <p className="text-[13px] text-ink-3">Aún no tiene compras.</p>}
            </section>
          </div>
        )}
      </Modal>

      <Modal abierto={!!form} alCerrar={() => setForm(null)} titulo={form?.id ? "Editar cliente" : "Agregar cliente"}>
        {form ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <Campo etiqueta="Documento"><Selector value={form.datos.tipoDoc} onChange={(e) => setForm({ ...form, datos: { ...form.datos, tipoDoc: e.target.value } })}><option value="DNI">DNI</option><option value="RUC">RUC</option><option value="CE">C. E.</option></Selector></Campo>
              <Campo etiqueta="Número"><Entrada value={form.datos.numero} onChange={(e) => setForm({ ...form, datos: { ...form.datos, numero: e.target.value.trim().toUpperCase().slice(0, 12) } })} inputMode={form.datos.tipoDoc === "CE" ? "text" : "numeric"} /></Campo>
            </div>
            <Campo etiqueta={form.datos.tipoDoc === "RUC" ? "Razón social" : "Nombre completo"}><Entrada value={form.datos.nombre} maxLength={120} onChange={(e) => setForm({ ...form, datos: { ...form.datos, nombre: e.target.value } })} /></Campo>
            <div className="grid sm:grid-cols-2 gap-2">
              <Campo etiqueta="Teléfono (opcional)"><Entrada value={form.datos.telefono} inputMode="numeric" onChange={(e) => setForm({ ...form, datos: { ...form.datos, telefono: e.target.value.replace(/\D/g, "").slice(0, 9) } })} placeholder="987654321" /></Campo>
              <Campo etiqueta="Correo (opcional)"><Entrada type="email" value={form.datos.email} onChange={(e) => setForm({ ...form, datos: { ...form.datos, email: e.target.value } })} /></Campo>
            </div>
            <Campo etiqueta="Notas (opcional)" ayuda="Alergias, preferencias u otra indicación útil al atenderlo; se muestra en Vender"><Entrada value={form.datos.notas} maxLength={500} onChange={(e) => setForm({ ...form, datos: { ...form.datos, notas: e.target.value } })} placeholder="Alérgico a la penicilina" /></Campo>
            {error ? <p className="text-sm text-rojo" role="alert">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Boton variante="fantasma" onClick={() => setForm(null)}>Cancelar</Boton>
              <Boton cargando={ocupado} disabled={form.datos.nombre.trim().length < 3 || !form.datos.numero} onClick={guardar}>Guardar</Boton>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
