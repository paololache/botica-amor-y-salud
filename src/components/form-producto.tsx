"use client";
import { useState } from "react";
import { api, soles } from "@/lib/cliente";
import { IGV, precioSugerido } from "@/lib/util";
import { Boton, Campo, Entrada, Modal, Selector, useAviso } from "@/components/ui";

export type ProductoEditable = {
  id: number; codigo: string; nombre: string; principioActivo: string | null; concentracion: string | null; formaFarmaceutica: string | null; registroSanitario: string | null; registroVence: string | null;
  laboratorio: string | null; categoriaId: number | null; condicionVenta: string; stockMinimo: number; costoPromedio?: number; porcentajeUtilidad?: number; tieneKardex: boolean;
  presentaciones: { nombre: string; factor: number; pvp: number; codigo: string | null }[];
};

const FORMAS = ["Tableta", "Cápsula", "Jarabe", "Suspensión", "Solución", "Inyectable", "Crema", "Ungüento", "Gel", "Gotas", "Supositorio", "Óvulo", "Inhalador", "Polvo", "Otra"];
const decimal = (v: string) => v.replace(",", ".");
const num = (v: string) => Number(v) || 0;

function margen(costo: number, pvp: number) {
  const neto = pvp / IGV;
  return neto > 0 ? ((neto - costo) / neto) * 100 : 0;
}

export function FormProducto({ producto: p, categorias, alCerrar, alGuardar }: { producto: ProductoEditable | null; categorias: { id: number; nombre: string }[]; alCerrar: () => void; alGuardar: () => void }) {
  const avisar = useAviso();
  const b0 = p?.presentaciones.find((x) => x.nombre.startsWith("Blíster"));
  const c0 = p?.presentaciones.find((x) => x.nombre.startsWith("Caja"));
  const [f, setF] = useState({
    codigo: p?.codigo ?? "", nombre: p?.nombre ?? "", laboratorio: p?.laboratorio ?? "", principioActivo: p?.principioActivo ?? "",
    concentracion: p?.concentracion ?? "", formaFarmaceutica: p?.formaFarmaceutica ?? "", registroSanitario: p?.registroSanitario ?? "", registroVence: p?.registroVence ?? "",
    categoriaId: p?.categoriaId ? String(p.categoriaId) : "", condicionVenta: p?.condicionVenta ?? "LIBRE", stockMinimo: String(p?.stockMinimo ?? 0),
    costo: p?.costoPromedio !== undefined ? String(p.costoPromedio) : "", utilidad: String(p?.porcentajeUtilidad ?? 30), pvp: p ? String(p.presentaciones.find((x) => x.factor === 1)?.pvp ?? "") : "",
    bFactor: b0 ? String(b0.factor) : "", bPvp: b0 ? String(b0.pvp) : "", bCodigo: b0?.codigo ?? "", cFactor: c0 ? String(c0.factor) : "", cPvp: c0 ? String(c0.pvp) : "", cCodigo: c0?.codigo ?? "",
  });
  // Un precio sigue al sugerido hasta que se escribe a mano; los que ya existen no se tocan solos.
  const [manual, setManual] = useState({ pvp: !!p, bPvp: !!b0, cPvp: !!c0 });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cambiar = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const costo = num(f.costo);
  const sugerido = (factor: number) => (costo && factor ? String(precioSugerido(costo, factor, num(f.utilidad))) : "");
  const precio = (k: keyof typeof manual, factor: number) => (manual[k] ? f[k] : sugerido(factor));
  const escribirPrecio = (k: keyof typeof manual, v: string) => { setManual((x) => ({ ...x, [k]: true })); cambiar(k, decimal(v)); };
  const pvp = precio("pvp", 1), bPvp = precio("bPvp", num(f.bFactor)), cPvp = precio("cPvp", num(f.cFactor));

  const ayudaPrecio = (k: keyof typeof manual, valor: string, factor: number) => {
    const s = sugerido(factor);
    const usar = manual[k] && s && num(s) !== num(valor) ? <button type="button" className="font-semibold text-vino-2" onClick={() => setManual((x) => ({ ...x, [k]: false }))}>Usar sugerido {soles(num(s))}</button> : null;
    if (!num(valor) || !costo || !factor) return usar ?? (factor > 1 ? `Por unidad: ${num(valor) ? soles(num(valor) / factor) : "—"}` : undefined);
    const m = margen(costo * factor, num(valor));
    return <><span className={m < 0 ? "text-rojo font-semibold" : ""}>{manual[k] ? "" : "Sugerido · "}Margen {m.toFixed(1)}%{m < 0 ? " · por debajo del costo" : ""}</span>{usar ? <> · {usar}</> : null}</>;
  };

  const guardar = async () => {
    setOcupado(true); setError(null);
    const empaque = (factor: string, precio: string, codigo: string) => (factor.trim() || precio.trim() || codigo ? { factor: num(factor), pvp: num(precio), codigo: codigo || null } : null);
    try {
      const cuerpo = {
        codigo: f.codigo, nombre: f.nombre, laboratorio: f.laboratorio, principioActivo: f.principioActivo || null, concentracion: f.concentracion || null, formaFarmaceutica: f.formaFarmaceutica || null,
        registroSanitario: f.registroSanitario || null, registroVence: f.registroVence || null, categoriaId: f.categoriaId ? Number(f.categoriaId) : null,
        condicionVenta: f.condicionVenta, stockMinimo: Math.trunc(num(f.stockMinimo)), costoUnitario: costo, porcentajeUtilidad: num(f.utilidad), precioUnidad: num(pvp),
        blister: empaque(f.bFactor, bPvp, f.bCodigo), caja: empaque(f.cFactor, cPvp, f.cCodigo),
      };
      if (p) await api(`/api/productos/${p.id}`, { metodo: "PATCH", cuerpo });
      else await api("/api/productos", { cuerpo });
      avisar("ok", p ? "Producto actualizado." : `${f.nombre} creado. El stock entra al registrar su primera compra.`);
      alGuardar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  return (
    <Modal abierto alCerrar={alCerrar} titulo={p ? "Editar producto" : "Agregar producto"} ancho="max-w-2xl">
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo etiqueta="Código de barras" ayuda="Al escanearlo se vende por unidad"><Entrada autoFocus value={f.codigo} onChange={(e) => cambiar("codigo", e.target.value.trim())} placeholder="7750000000011" /></Campo>
          <Campo etiqueta="Laboratorio"><Entrada value={f.laboratorio} onChange={(e) => cambiar("laboratorio", e.target.value)} placeholder="IQ Farma" /></Campo>
          <Campo etiqueta="Nombre del producto" className="sm:col-span-2"><Entrada value={f.nombre} onChange={(e) => cambiar("nombre", e.target.value)} placeholder="Dolofenex Forte cápsula" /></Campo>
          <Campo etiqueta="Principio activo (opcional)" ayuda="Permite buscar sustitutos con F9 en Vender"><Entrada value={f.principioActivo} onChange={(e) => cambiar("principioActivo", e.target.value)} /></Campo>
          <Campo etiqueta="Concentración (opcional)"><Entrada value={f.concentracion} onChange={(e) => cambiar("concentracion", e.target.value)} placeholder="500 mg" /></Campo>
          <Campo etiqueta="Forma farmacéutica (opcional)"><Selector value={f.formaFarmaceutica} onChange={(e) => cambiar("formaFarmaceutica", e.target.value)}><option value="">Sin especificar</option>{FORMAS.map((x) => <option key={x} value={x}>{x}</option>)}</Selector></Campo>
          <Campo etiqueta="Registro sanitario (opcional)"><Entrada value={f.registroSanitario} onChange={(e) => cambiar("registroSanitario", e.target.value)} placeholder="EE-01234" /></Campo>
          <Campo etiqueta="Vencimiento del registro (opcional)"><Entrada type="date" value={f.registroVence} onChange={(e) => cambiar("registroVence", e.target.value)} /></Campo>
          <Campo etiqueta="Categoría (opcional)"><Selector value={f.categoriaId} onChange={(e) => cambiar("categoriaId", e.target.value)}><option value="">Sin categoría</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Condición de venta"><Selector value={f.condicionVenta} onChange={(e) => cambiar("condicionVenta", e.target.value)}><option value="LIBRE">Venta libre</option><option value="RECETA">Con receta</option><option value="RECETA_RETENIDA">Receta retenida</option></Selector></Campo>
          <Campo etiqueta="Stock mínimo (unidades)"><Entrada inputMode="numeric" value={f.stockMinimo} onChange={(e) => cambiar("stockMinimo", e.target.value.replace(/\D/g, ""))} /></Campo>
        </div>
        <fieldset className="rounded-2xl border border-foil-2 p-4">
          <legend className="px-1 text-[13px] font-semibold">Costo y precios de venta (con IGV)</legend>
          <div className="grid sm:grid-cols-3 gap-3">
            <Campo etiqueta="Costo unitario (sin IGV)" ayuda={p?.tieneKardex ? "Lo calculan las compras (costo promedio)" : "Se actualiza con cada compra"}><Entrada inputMode="decimal" disabled={p?.tieneKardex} value={f.costo} onChange={(e) => cambiar("costo", decimal(e.target.value))} placeholder="0.00" /></Campo>
            <Campo etiqueta="Utilidad sobre el costo (%)" ayuda="Base del precio sugerido"><Entrada inputMode="decimal" value={f.utilidad} onChange={(e) => cambiar("utilidad", decimal(e.target.value))} placeholder="30" /></Campo>
            <Campo etiqueta="Precio por unidad" ayuda={ayudaPrecio("pvp", pvp, 1)}><Entrada inputMode="decimal" value={pvp} onChange={(e) => escribirPrecio("pvp", e.target.value)} placeholder="0.00" /></Campo>
          </div>
          <div className="grid sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] gap-3 mt-3">
            <Campo etiqueta="Unid. por blíster"><Entrada inputMode="numeric" value={f.bFactor} onChange={(e) => cambiar("bFactor", e.target.value.replace(/\D/g, ""))} placeholder="10" /></Campo>
            <Campo etiqueta="Precio del blíster (opcional)" ayuda={ayudaPrecio("bPvp", bPvp, num(f.bFactor))}><Entrada inputMode="decimal" value={bPvp} onChange={(e) => escribirPrecio("bPvp", e.target.value)} placeholder="0.00" /></Campo>
            <Campo etiqueta="Código del blíster (opcional)"><Entrada value={f.bCodigo} onChange={(e) => cambiar("bCodigo", e.target.value.trim())} /></Campo>
            <Campo etiqueta="Unid. por caja"><Entrada inputMode="numeric" value={f.cFactor} onChange={(e) => cambiar("cFactor", e.target.value.replace(/\D/g, ""))} placeholder="100" /></Campo>
            <Campo etiqueta="Precio de la caja (opcional)" ayuda={ayudaPrecio("cPvp", cPvp, num(f.cFactor))}><Entrada inputMode="decimal" value={cPvp} onChange={(e) => escribirPrecio("cPvp", e.target.value)} placeholder="0.00" /></Campo>
            <Campo etiqueta="Código de la caja (opcional)"><Entrada value={f.cCodigo} onChange={(e) => cambiar("cCodigo", e.target.value.trim())} /></Campo>
          </div>
        </fieldset>
        {!p ? <p className="text-[13px] text-ink-2">El producto se crea con stock 0. Las unidades entran al registrar la compra, con su lote y vencimiento.</p> : null}
        {error ? <p className="text-sm text-rojo" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="amor" cargando={ocupado} disabled={!f.codigo || !f.nombre.trim() || !f.laboratorio.trim() || !(num(pvp) > 0) || f.costo === ""} onClick={guardar}>{p ? "Guardar cambios" : "Crear producto"}</Boton>
        </div>
      </div>
    </Modal>
  );
}
