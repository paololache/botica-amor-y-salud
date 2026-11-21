"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Settings2, Trash } from "lucide-react";
import { api, soles } from "@/lib/cliente";
import { IGV } from "@/lib/util";
import { costoSinIgv, gananciaDesdePrecio, precioDesdeGanancia, resultadoPrecio } from "@/lib/precios";
import { Boton, Campo, Entrada, EntradaNumero, Interruptor, Modal, Selector, useAviso } from "@/components/ui";
import { SelectorLaboratorio, type Laboratorio } from "@/components/selector-laboratorio";

export type ProductoEditable = {
  id: number; codigo: string; nombre: string; nombreComercial?: string | null; patologias?: string | null; principioActivo: string | null; concentracion: string | null; formaFarmaceutica: string | null; registroSanitario: string | null; registroVence: string | null;
  laboratorioId: number | null; laboratorio: string | null; categoriaId: number | null; condicionVenta: string; tipoIgv?: string; stockMinimo: number; costoPromedio?: number; porcentajeUtilidad?: number; tieneKardex: boolean;
  presentaciones: { nombre: string; factor: number; pvp: number; codigo: string | null }[];
};

const FORMAS = ["Tableta", "Cápsula", "Jarabe", "Suspensión", "Solución", "Inyectable", "Crema", "Ungüento", "Gel", "Gotas", "Supositorio", "Óvulo", "Inhalador", "Polvo", "Otra"];
const decimal = (v: string) => v.replace(",", ".");
const num = (v: string) => Number(v) || 0;

type Categoria = { id: number; nombre: string; productos?: number };
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`);

export function FormProducto({ producto: p, categorias, laboratorios, alCerrar, alGuardar }: { producto: ProductoEditable | null; categorias: { id: number; nombre: string }[]; laboratorios: Laboratorio[]; alCerrar: () => void; alGuardar: () => void }) {
  const avisar = useAviso();
  const b0 = p?.presentaciones.find((x) => x.nombre.startsWith("Blíster"));
  const c0 = p?.presentaciones.find((x) => x.nombre.startsWith("Caja"));
  const [f, setF] = useState({
    codigo: p?.codigo ?? "", nombre: p?.nombre ?? "", principioActivo: p?.principioActivo ?? "", nombreComercial: p?.nombreComercial ?? "", patologias: p?.patologias ?? "",
    concentracion: p?.concentracion ?? "", formaFarmaceutica: p?.formaFarmaceutica ?? "", registroSanitario: p?.registroSanitario ?? "", registroVence: p?.registroVence ?? "",
    categoriaId: p?.categoriaId ? String(p.categoriaId) : "", condicionVenta: p?.condicionVenta ?? "LIBRE", tipoIgv: p?.tipoIgv ?? "GRAVADO", stockMinimo: String(p?.stockMinimo ?? 0),
    // El costo se muestra CON IGV (como en la factura); se guarda sin IGV.
    costo: p?.costoPromedio !== undefined ? String(Math.round(p.costoPromedio * IGV * 10000) / 10000) : "", utilidad: String(p?.porcentajeUtilidad ?? 30), pvp: p ? String(p.presentaciones.find((x) => x.factor === 1)?.pvp ?? "") : "",
    bFactor: b0 ? String(b0.factor) : "", bPvp: b0 ? String(b0.pvp) : "", bCodigo: b0?.codigo ?? "", cFactor: c0 ? String(c0.factor) : "", cPvp: c0 ? String(c0.pvp) : "", cCodigo: c0?.codigo ?? "",
  });
  // Un precio sigue al sugerido hasta que se escribe a mano; los que ya existen no se tocan solos.
  const [manual, setManual] = useState({ pvp: !!p, bPvp: !!b0, cPvp: !!c0 });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarDuplicado, setConfirmarDuplicado] = useState(false);
  const [lab, setLab] = useState<Laboratorio | null>(p?.laboratorioId && p.laboratorio ? { id: p.laboratorioId, nombre: p.laboratorio } : null);
  const [catalogo, setCatalogo] = useState(laboratorios);
  const elegirLab = (l: Laboratorio | null) => { setLab(l); setConfirmarDuplicado(false); setError(null); if (l && !catalogo.some((x) => x.id === l.id)) setCatalogo((c) => [...c, l].sort((a, b) => a.nombre.localeCompare(b.nombre))); };
  const cambiar =(k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  // Costo: por defecto se escribe con IGV (como viene en la factura); si no se tiene ese dato, se escribe sin IGV.
  const [incluyeIgv, setIncluyeIgv] = useState(true);
  const [costoTocado, setCostoTocado] = useState(false);
  const gravado = f.tipoIgv === "GRAVADO";
  // Costo unitario sin IGV: es el que se guarda. Si al editar no se tocó, se usa el guardado tal cual (sin redondeos de ida y vuelta).
  const costo = p && !costoTocado && p.costoPromedio !== undefined ? p.costoPromedio : costoSinIgv(num(f.costo), incluyeIgv);
  const sugerido = (factor: number) => (costo && factor ? String(precioDesdeGanancia(costo, factor, num(f.utilidad), gravado)) : "");
  const precio = (k: keyof typeof manual, factor: number) => (manual[k] ? f[k] : sugerido(factor));
  const escribirPrecio = (k: keyof typeof manual, v: string) => { setManual((x) => ({ ...x, [k]: true })); cambiar(k, decimal(v)); };
  const pvp = precio("pvp", 1), bPvp = precio("bPvp", num(f.bFactor)), cPvp = precio("cPvp", num(f.cFactor));
  // La ganancia (%) se calcula sola: si se escribe el precio por unidad, sale de ese precio; si se escribe la ganancia, el precio se sugiere.
  const gananciaUnidad = manual.pvp ? gananciaDesdePrecio(num(pvp), costo, 1, gravado) : num(f.utilidad);
  const escribirGanancia = (v: string) => { cambiar("utilidad", decimal(v)); setManual((x) => ({ ...x, pvp: false, ...(b0 ? {} : { bPvp: false }), ...(c0 ? {} : { cPvp: false }) })); };
  const filasResultado = [
    { nombre: "Unidad", precio: num(pvp), factor: 1 },
    ...(num(f.bFactor) > 1 && num(bPvp) > 0 ? [{ nombre: `Blíster x${num(f.bFactor)}`, precio: num(bPvp), factor: num(f.bFactor) }] : []),
    ...(num(f.cFactor) > 1 && num(cPvp) > 0 ? [{ nombre: `Caja x${num(f.cFactor)}`, precio: num(cPvp), factor: num(f.cFactor) }] : []),
  ].filter((x) => x.precio > 0);

  const ayudaPrecio = (k: keyof typeof manual, valor: string, factor: number) => {
    const s = sugerido(factor);
    const usar = manual[k] && s && num(s) !== num(valor) ? <button type="button" className="font-semibold text-vino-2" onClick={() => setManual((x) => ({ ...x, [k]: false }))}>Usar sugerido {soles(num(s))}</button> : null;
    if (factor > 1 && num(valor)) return <>{`Por unidad: ${soles(num(valor) / factor)}`}{usar ? <> · {usar}</> : null}</>;
    return usar ?? (manual[k] || !s ? undefined : "Sugerido por la ganancia");
  };

  // Código de barras: en un producto nuevo se genera solo, siguiendo la serie interna; se puede cambiar o escanear el de fábrica.
  const [codigoAuto, setCodigoAuto] = useState<string | null>(null);
  const generarCodigo = async () => {
    try { const r = await api<{ codigo: string }>("/api/productos/siguiente-codigo"); setCodigoAuto(r.codigo); cambiar("codigo", r.codigo); }
    catch (e) { avisar("error", (e as Error).message); }
  };
  useEffect(() => { if (!p) generarCodigo(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Categorías: se pueden agregar al vuelo y eliminar las que ningún producto usa.
  const [cats, setCats] = useState<Categoria[]>(categorias);
  const [nuevaCat, setNuevaCat] = useState<string | null>(null);
  const [verCats, setVerCats] = useState(false);
  const recargarCats = async () => { try { setCats(await api<Categoria[]>("/api/categorias")); } catch { /* se mantiene la lista actual */ } };
  const crearCat = async () => {
    try {
      const c = await api<Categoria>("/api/categorias", { cuerpo: { nombre: nuevaCat ?? "" } });
      setCats((xs) => [...xs, c].sort((a, b) => a.nombre.localeCompare(b.nombre))); cambiar("categoriaId", String(c.id)); setNuevaCat(null);
      avisar("ok", `Categoría «${c.nombre}» agregada.`);
    } catch (e) { avisar("error", (e as Error).message); }
  };
  const eliminarCat = async (c: Categoria) => {
    try {
      await api(`/api/categorias/${c.id}`, { metodo: "DELETE" });
      setCats((xs) => xs.filter((x) => x.id !== c.id)); if (f.categoriaId === String(c.id)) cambiar("categoriaId", "");
      avisar("ok", `Categoría «${c.nombre}» eliminada.`);
    } catch (e) { avisar("error", (e as Error).message); }
  };

  const guardar = async () => {
    setOcupado(true); setError(null);
    const empaque = (factor: string, precio: string, codigo: string) => (factor.trim() || precio.trim() || codigo ? { factor: num(factor), pvp: num(precio), codigo: codigo || null } : null);
    try {
      const cuerpo = {
        codigo: f.codigo, nombre: f.nombre, laboratorioId: lab?.id, principioActivo: f.principioActivo || null, nombreComercial: f.nombreComercial || null, patologias: f.patologias || null, concentracion: f.concentracion || null, formaFarmaceutica: f.formaFarmaceutica || null,
        registroSanitario: f.registroSanitario || null, registroVence: f.registroVence || null, categoriaId: f.categoriaId ? Number(f.categoriaId) : null,
        condicionVenta: f.condicionVenta, tipoIgv: f.tipoIgv, stockMinimo: Math.trunc(num(f.stockMinimo)), costoUnitario: costo,
        porcentajeUtilidad: Math.max(0, Math.min(999, gananciaUnidad ?? num(f.utilidad))), precioUnidad: num(pvp),
        blister: empaque(f.bFactor, bPvp, f.bCodigo), caja: empaque(f.cFactor, cPvp, f.cCodigo), confirmarDuplicado,
      };
      if (p) await api(`/api/productos/${p.id}`, { metodo: "PATCH", cuerpo });
      else await api("/api/productos", { cuerpo });
      avisar("ok", p ? "Producto actualizado." : `${f.nombre} creado. El stock entra al registrar su primera compra.`);
      alGuardar();
    } catch (e) { setError((e as Error).message); if ((e as { codigo?: string }).codigo === "POSIBLE_DUPLICADO") setConfirmarDuplicado(true); } finally { setOcupado(false); }
  };

  return (
    <Modal abierto alCerrar={alCerrar} titulo={p ? "Editar producto" : "Agregar producto"} ancho="max-w-3xl">
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo etiqueta="Código de barras" ayuda={!p && codigoAuto && f.codigo === codigoAuto ? "Generado automáticamente (correlativo). Puedes cambiarlo o escanear el de fábrica" : "Al escanearlo se vende por unidad"}>
            <div className="flex gap-2">
              <Entrada value={f.codigo} onChange={(e) => cambiar("codigo", e.target.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20))} placeholder="000000000001" />
              {!p ? <button type="button" onClick={generarCodigo} title="Generar el siguiente código correlativo" aria-label="Generar código" className="h-10 w-10 shrink-0 grid place-items-center rounded-xl border border-foil-3 text-ink-2 hover:text-ink"><RefreshCw size={15} /></button> : null}
            </div>
          </Campo>
          <SelectorLaboratorio laboratorios={catalogo} valor={lab} alElegir={elegirLab} />
          <Campo etiqueta="Nombre del producto" className="sm:col-span-2"><Entrada autoFocus value={f.nombre} onChange={(e) => { setConfirmarDuplicado(false); setError(null); cambiar("nombre", e.target.value); }} placeholder="Dolofenex Forte cápsula" /></Campo>
          <Campo etiqueta="Nombre comercial o marca (opcional)" ayuda="Como lo pide el cliente; se puede buscar por aquí"><Entrada value={f.nombreComercial} onChange={(e) => cambiar("nombreComercial", e.target.value)} placeholder="Panadol" /></Campo>
          <Campo etiqueta="Principio activo (opcional)" ayuda="Permite buscar sustitutos con F9 en Vender"><Entrada value={f.principioActivo} onChange={(e) => cambiar("principioActivo", e.target.value)} placeholder="Paracetamol" /></Campo>
          <Campo etiqueta="Patologías: para qué sirve (opcional)" ayuda="Separadas por coma. En Vender se puede buscar «fiebre» o «gastritis»" className="sm:col-span-2">
            <Entrada value={f.patologias} onChange={(e) => cambiar("patologias", e.target.value)} placeholder="fiebre, dolor de cabeza, dolor muscular" maxLength={300} />
          </Campo>
          <Campo etiqueta="Concentración (opcional)"><Entrada value={f.concentracion} onChange={(e) => cambiar("concentracion", e.target.value)} placeholder="500 mg" /></Campo>
          <Campo etiqueta="Forma farmacéutica (opcional)"><Selector value={f.formaFarmaceutica} onChange={(e) => cambiar("formaFarmaceutica", e.target.value)}><option value="">Sin especificar</option>{FORMAS.map((x) => <option key={x} value={x}>{x}</option>)}</Selector></Campo>
          <Campo etiqueta="Registro sanitario (opcional)"><Entrada value={f.registroSanitario} onChange={(e) => cambiar("registroSanitario", e.target.value)} placeholder="EE-01234" /></Campo>
          <Campo etiqueta="Vencimiento del registro (opcional)"><Entrada type="date" value={f.registroVence} onChange={(e) => cambiar("registroVence", e.target.value)} /></Campo>
          <div>
            <Campo etiqueta="Categoría (opcional)">
              <div className="flex gap-2">
                <Selector value={f.categoriaId} onChange={(e) => cambiar("categoriaId", e.target.value)}><option value="">Sin categoría</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Selector>
                <button type="button" onClick={() => { setVerCats((v) => !v); if (!verCats) recargarCats(); }} title="Agregar o eliminar categorías" aria-label="Administrar categorías" aria-expanded={verCats}
                  className={`h-10 w-10 shrink-0 grid place-items-center rounded-xl border ${verCats ? "border-petroleo text-petroleo" : "border-foil-3 text-ink-2 hover:text-ink"}`}><Settings2 size={15} /></button>
              </div>
            </Campo>
            {nuevaCat === null ? <button type="button" className="mt-1 text-[12.5px] font-semibold text-petroleo-3" onClick={() => setNuevaCat("")}>+ Nueva categoría</button> : (
              <div className="flex gap-2 mt-1.5">
                <Entrada autoFocus value={nuevaCat} maxLength={60} onChange={(e) => setNuevaCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crearCat(); } if (e.key === "Escape") { e.stopPropagation(); setNuevaCat(null); } }} placeholder="Nombre de la categoría" />
                <Boton tam="sm" className="h-10" disabled={(nuevaCat ?? "").trim().length < 2} onClick={crearCat}>Agregar</Boton>
                <Boton tam="sm" variante="fantasma" className="h-10" onClick={() => setNuevaCat(null)}>Cancelar</Boton>
              </div>
            )}
          </div>
          {verCats ? (
            <div className="sm:col-span-2 rounded-xl border border-foil-2 bg-foil/40 p-3">
              <p className="text-[12.5px] text-ink-2 mb-2">Solo se pueden eliminar las categorías que ningún producto usa.</p>
              <ul className="grid sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {cats.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-lg bg-papel border border-foil-2 px-2.5 py-1.5 text-[13px]">
                    <span className="flex-1 min-w-0 truncate">{c.nombre}</span>
                    <span className="text-[12px] text-ink-3 tabular-nums">{c.productos ?? "?"} prod.</span>
                    <button type="button" disabled={(c.productos ?? 1) > 0} onClick={() => eliminarCat(c)} title={(c.productos ?? 1) > 0 ? "Tiene productos: no se puede eliminar" : "Eliminar categoría"} aria-label={`Eliminar ${c.nombre}`}
                      className="size-7 grid place-items-center rounded-md text-ink-3 hover:text-rojo hover:bg-rojo-claro disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3"><Trash size={14} /></button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Campo etiqueta="Tipo de IGV" ayuda="Casi todo es gravado (18 %). Cámbialo solo si el contador lo indica"><Selector value={f.tipoIgv} onChange={(e) => cambiar("tipoIgv", e.target.value)}><option value="GRAVADO">Gravado (con IGV)</option><option value="EXONERADO">Exonerado</option><option value="INAFECTO">Inafecto</option></Selector></Campo>
          <Campo etiqueta="Stock mínimo (unidades)"><EntradaNumero inputMode="numeric" value={f.stockMinimo} onChange={(e) => cambiar("stockMinimo", e.target.value.replace(/\D/g, ""))} /></Campo>
        </div>
        <fieldset className="rounded-2xl border border-foil-2 p-4">
          <legend className="px-1 text-[13px] font-semibold">Costo, ganancia y precios de venta</legend>
          <div className="grid sm:grid-cols-3 gap-3">
            <Campo etiqueta={`Costo unitario ${incluyeIgv ? "(con IGV)" : "(sin IGV)"}`}
              ayuda={p?.tieneKardex ? "Lo calculan las compras (costo promedio)" : num(f.costo) > 0 ? (incluyeIgv ? `Sin IGV: ${soles(costo)}` : `Con IGV: ${soles(costo * IGV)}`) : "Como figura en la factura"}>
              <EntradaNumero inputMode="decimal" disabled={p?.tieneKardex} value={f.costo} onChange={(e) => { setCostoTocado(true); cambiar("costo", decimal(e.target.value)); }} placeholder="0.00" />
            </Campo>
            <Campo etiqueta="Ganancia sobre el costo (%)" ayuda={manual.pvp ? "Calculada con el precio que escribiste" : "Escríbela y el precio se calcula solo"}>
              <EntradaNumero inputMode="decimal" value={manual.pvp ? (gananciaUnidad === null ? "" : String(gananciaUnidad)) : f.utilidad} onChange={(e) => escribirGanancia(e.target.value)} placeholder="30" />
            </Campo>
            <Campo etiqueta="Precio por unidad (con IGV)" ayuda={ayudaPrecio("pvp", pvp, 1)}><EntradaNumero inputMode="decimal" value={pvp} onChange={(e) => escribirPrecio("pvp", e.target.value)} placeholder="0.00" /></Campo>
          </div>
          {!p?.tieneKardex ? (
            <label className="flex items-center gap-2.5 mt-2 text-[13px] text-ink-2">
              <Interruptor activo={incluyeIgv} alCambiar={() => { setCostoTocado(true); setIncluyeIgv((v) => !v); }} etiqueta="El costo incluye IGV" />
              {incluyeIgv ? "El costo incluye IGV (como viene en la factura)" : "No tengo el costo con IGV: lo escribo sin IGV y el sistema lo calcula"}
            </label>
          ) : null}
          <div className="grid sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] gap-3 mt-3">
            <Campo etiqueta="Unid. por blíster"><EntradaNumero inputMode="numeric" value={f.bFactor} onChange={(e) => cambiar("bFactor", e.target.value.replace(/\D/g, ""))} placeholder="10" /></Campo>
            <Campo etiqueta="Precio del blíster (opcional)" ayuda={ayudaPrecio("bPvp", bPvp, num(f.bFactor))}><EntradaNumero inputMode="decimal" value={bPvp} onChange={(e) => escribirPrecio("bPvp", e.target.value)} placeholder="0.00" /></Campo>
            <Campo etiqueta="Código del blíster (opcional)"><Entrada value={f.bCodigo} onChange={(e) => cambiar("bCodigo", e.target.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20))} /></Campo>
            <Campo etiqueta="Unid. por caja"><EntradaNumero inputMode="numeric" value={f.cFactor} onChange={(e) => cambiar("cFactor", e.target.value.replace(/\D/g, ""))} placeholder="100" /></Campo>
            <Campo etiqueta="Precio de la caja (opcional)" ayuda={ayudaPrecio("cPvp", cPvp, num(f.cFactor))}><EntradaNumero inputMode="decimal" value={cPvp} onChange={(e) => escribirPrecio("cPvp", e.target.value)} placeholder="0.00" /></Campo>
            <Campo etiqueta="Código de la caja (opcional)"><Entrada value={f.cCodigo} onChange={(e) => cambiar("cCodigo", e.target.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20))} /></Campo>
          </div>
          {costo > 0 && filasResultado.length ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-foil-2">
              <table className="tabla" aria-label="Cuánto ganas con cada precio">
                <thead><tr><th>Cuánto ganas</th><th className="num">Precio</th><th className="num">Costo (sin IGV)</th><th className="num">Ganancia</th><th className="num" title="Ganancia dividida entre el costo">Sobre el costo</th><th className="num" title="Qué parte del precio (sin IGV) es ganancia">Margen del precio</th></tr></thead>
                <tbody>{filasResultado.map((x) => {
                  const r = resultadoPrecio(x.precio, costo, x.factor, gravado);
                  return (
                    <tr key={x.nombre} className={r.pierde ? "bg-rojo-claro/40" : ""}>
                      <td className="font-semibold">{x.nombre}</td><td className="num">{soles(x.precio)}</td><td className="num text-ink-2">{soles(r.costo)}</td>
                      <td className={`num font-semibold ${r.pierde ? "text-rojo" : "text-ok"}`}>{r.pierde ? `− ${soles(-r.ganancia)}` : soles(r.ganancia)}</td>
                      <td className={`num ${r.pierde ? "text-rojo" : ""}`}>{pct(r.sobreCosto)}</td><td className={`num ${r.pierde ? "text-rojo" : ""}`}>{pct(r.delPrecio)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <p className="px-3 py-2 text-[12px] text-ink-3">{gravado ? "La ganancia se calcula sin IGV: el IGV del precio se paga a SUNAT." : "Producto sin IGV: la ganancia es el precio menos el costo."}{filasResultado.some((x) => resultadoPrecio(x.precio, costo, x.factor, gravado).pierde) ? " En rojo: ese precio no cubre el costo." : ""}</p>
            </div>
          ) : null}
        </fieldset>
        {!p ? <p className="text-[13px] text-ink-2">El producto se crea con stock 0. Las unidades entran al registrar la compra, con su lote y vencimiento.</p> : null}
        {error ? <p className="text-sm text-rojo" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="amor" cargando={ocupado} disabled={!f.codigo || !f.nombre.trim() || !lab || !(num(pvp) > 0) || f.costo === ""} onClick={guardar}>{confirmarDuplicado ? "Es un producto distinto, guardar" : p ? "Guardar cambios" : "Crear producto"}</Boton>
        </div>
      </div>
    </Modal>
  );
}
