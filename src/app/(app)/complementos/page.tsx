"use client";
import { useState } from "react";
import { Trash } from "lucide-react";
import { api, useDatos } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { BuscadorProducto, type ProdBusqueda } from "@/components/buscador-producto";

type C = { id: number; origenTipo: string; origenValor: string; productoId: number; producto: string; mensaje: string | null; prioridad: number };
const ORIGEN: Record<string, string> = { PRINCIPIO_ACTIVO: "Principio activo", PRODUCTO: "Producto", CATEGORIA: "Categoría" };

export default function Complementos() {
  const avisar = useAviso();
  const { datos, recargar } = useDatos<C[]>("/api/complementos");
  const [tipo, setTipo] = useState("PRINCIPIO_ACTIVO");
  const [valor, setValor] = useState("");
  const [origenProd, setOrigenProd] = useState<ProdBusqueda | null>(null);
  const [destino, setDestino] = useState<ProdBusqueda | null>(null);
  const [mensaje, setMensaje] = useState("");
  const guardar = async () => {
    try {
      await api("/api/complementos", { cuerpo: { origenTipo: tipo, origenValor: tipo === "PRODUCTO" ? String(origenProd!.id) : valor, productoId: destino!.id, mensaje: mensaje || undefined, prioridad: 5 } });
      avisar("ok", "Complemento guardado."); setValor(""); setDestino(null); setMensaje(""); setOrigenProd(null); recargar();
    } catch (e) { avisar("error", (e as Error).message); }
  };
  return (
    <div>
      <Encabezado titulo="Productos complementarios" bajada="Qué sugerir en el punto de venta cuando el cliente lleva cierto producto. Las sugerencias nunca bloquean la venta ni reemplazan la indicación médica." />
      <div className="grid xl:grid-cols-[400px_minmax(0,1fr)] gap-6 items-start">
        <Tarjeta titulo="Nueva asociación">
          <div className="px-5 pb-5 space-y-3">
            <Campo etiqueta="Cuando el cliente lleva"><Selector value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="PRINCIPIO_ACTIVO">Un principio activo</option><option value="PRODUCTO">Un producto específico</option></Selector></Campo>
            {tipo === "PRODUCTO" ? (origenProd ? <div className="flex justify-between items-center rounded-xl bg-foil px-3 py-2 text-sm"><b>{origenProd.nombre}</b><button className="text-ink-3" onClick={() => setOrigenProd(null)}>Cambiar</button></div> : <BuscadorProducto alElegir={setOrigenProd} />)
              : <Entrada value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Amoxicilina" />}
            <Campo etiqueta="Sugerir">{destino ? <div className="flex justify-between items-center rounded-xl bg-amor-claro px-3 py-2 text-sm"><b>{destino.nombre}</b><button className="text-ink-3" onClick={() => setDestino(null)}>Cambiar</button></div> : <BuscadorProducto alElegir={setDestino} placeholder="Producto a sugerir" />}</Campo>
            <Campo etiqueta="Mensaje para el vendedor (opcional)"><Entrada value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Sugerido con antibióticos" /></Campo>
            <Boton className="w-full" disabled={!destino || (tipo === "PRODUCTO" ? !origenProd : !valor.trim())} onClick={guardar}>Guardar asociación</Boton>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Asociaciones">
          {!datos ? <div className="p-5"><Cargando /></div> : datos.length ? (
            <table className="tabla"><thead><tr><th>Cuando lleva</th><th>Sugerir</th><th>Mensaje</th><th /></tr></thead>
              <tbody>{datos.map((c) => <tr key={c.id}><td><Insignia>{ORIGEN[c.origenTipo]}</Insignia> <b className="ml-1">{c.origenValor}</b></td><td>{c.producto}</td><td className="text-ink-2">{c.mensaje}</td>
                <td><button className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-rojo" aria-label="Eliminar" onClick={async () => { await api(`/api/complementos?id=${c.id}`, { metodo: "DELETE" }); recargar(); }}><Trash size={15} /></button></td></tr>)}</tbody></table>
          ) : <Vacio titulo="Sin asociaciones" />}
        </Tarjeta>
      </div>
    </div>
  );
}
