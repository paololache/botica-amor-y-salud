"use client";
import { useState } from "react";
import { Merge, Pencil, Trash } from "lucide-react";
import { api, useDatos } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Modal, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { SelectorLaboratorio } from "@/components/selector-laboratorio";

type L = { id: number; nombre: string; productos: number; parecidos: string[] };
const ICONO = "size-8 grid place-items-center rounded-lg border border-foil-3 text-ink-2 hover:border-vino-2 hover:text-vino";

export default function Laboratorios() {
  const avisar = useAviso();
  const { datos, recargar } = useDatos<L[]>("/api/laboratorios");
  const [renombrar, setRenombrar] = useState<L | null>(null);
  const [nombre, setNombre] = useState("");
  const [unificar, setUnificar] = useState<L | null>(null);
  const [destino, setDestino] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const ejecutar = async (accion: () => Promise<string>) => {
    setOcupado(true); setError(null);
    try { avisar("ok", await accion()); setRenombrar(null); setUnificar(null); recargar(); }
    catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  const guardarNombre = () => ejecutar(async () => { await api(`/api/laboratorios/${renombrar!.id}`, { metodo: "PATCH", cuerpo: { nombre } }); return "Laboratorio actualizado."; });
  const confirmarUnificar = () => ejecutar(async () => {
    const r = await api<{ productos: number }>(`/api/laboratorios/${unificar!.id}/unificar`, { cuerpo: { destinoId: Number(destino) } });
    return `Laboratorios unificados. ${r.productos} productos actualizados.`;
  });
  const eliminar = async (l: L) => {
    try { await api(`/api/laboratorios/${l.id}`, { metodo: "DELETE" }); avisar("ok", `${l.nombre} eliminado.`); recargar(); }
    catch (e) { avisar("error", (e as Error).message); }
  };

  return (
    <div>
      <Encabezado titulo="Laboratorios" bajada="Catálogo único de fabricantes. Un producto solo puede usar un laboratorio de esta lista, y el sistema no admite dos veces el mismo nombre." />
      <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
        <Tarjeta titulo="Agregar laboratorio">
          <div className="px-5 pb-5"><SelectorLaboratorio etiqueta="Nombre" laboratorios={datos ?? []} valor={null} alElegir={(l) => { if (l) { avisar("ok", `${l.nombre} está en el catálogo.`); recargar(); } }} /></div>
        </Tarjeta>
        <Tarjeta titulo="Catálogo">
          {!datos ? <div className="p-5"><Cargando /></div> : datos.length ? (
            <div className="overflow-x-auto"><table className="tabla">
              <thead><tr><th>Laboratorio</th><th className="num">Productos</th><th>Revisar</th><th className="text-right">Opciones</th></tr></thead>
              <tbody>{datos.map((l) => (
                <tr key={l.id}>
                  <td className="font-semibold">{l.nombre}</td>
                  <td className="num">{l.productos}</td>
                  <td>{l.parecidos.length ? <Insignia tono="ambar">Se parece a {l.parecidos.join(", ")}</Insignia> : null}</td>
                  <td><div className="flex justify-end gap-1">
                    <button className={ICONO} title="Corregir nombre" aria-label={`Corregir ${l.nombre}`} onClick={() => { setRenombrar(l); setNombre(l.nombre); setError(null); }}><Pencil size={16} /></button>
                    <button className={ICONO} title="Unificar con otro" aria-label={`Unificar ${l.nombre}`} onClick={() => { setUnificar(l); setDestino(""); setError(null); }}><Merge size={16} /></button>
                    {l.productos === 0 ? <button className={ICONO} title="Eliminar" aria-label={`Eliminar ${l.nombre}`} onClick={() => eliminar(l)}><Trash size={16} /></button> : null}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Vacio titulo="Aún no hay laboratorios" />}
        </Tarjeta>
      </div>
      <Modal abierto={!!renombrar} alCerrar={() => setRenombrar(null)} titulo="Corregir nombre">
        <div className="space-y-4">
          <Campo etiqueta="Nombre" ayuda="El cambio se refleja en todos sus productos."><Entrada autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
          {error ? <p className="text-sm text-rojo" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2"><Boton variante="fantasma" onClick={() => setRenombrar(null)}>Cancelar</Boton><Boton variante="amor" cargando={ocupado} disabled={!nombre.trim()} onClick={guardarNombre}>Guardar</Boton></div>
        </div>
      </Modal>
      <Modal abierto={!!unificar} alCerrar={() => setUnificar(null)} titulo={`Unificar ${unificar?.nombre ?? ""}`}>
        <div className="space-y-4">
          <Campo etiqueta="Mantener este laboratorio"><Selector value={destino} onChange={(e) => setDestino(e.target.value)}><option value="">Elige el nombre correcto</option>{datos?.filter((l) => l.id !== unificar?.id).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Selector></Campo>
          <p className="text-[13px] text-ink-2">Sus {unificar?.productos} productos pasarán al laboratorio elegido y «{unificar?.nombre}» saldrá del catálogo. Esta acción no se puede deshacer desde esta pantalla.</p>
          {error ? <p className="text-sm text-rojo" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2"><Boton variante="fantasma" onClick={() => setUnificar(null)}>Cancelar</Boton><Boton variante="peligro" cargando={ocupado} disabled={!destino} onClick={confirmarUnificar}>Unificar</Boton></div>
        </div>
      </Modal>
    </div>
  );
}
