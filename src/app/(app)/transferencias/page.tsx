"use client";
import { useState } from "react";
import { Trash } from "lucide-react";
import { api, useDatos, soles, fechaHora, numero, hoyLima, vence } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, EntradaNumero, Insignia, Pestanas, Sello, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { BuscadorProducto, type ProdBusqueda } from "@/components/buscador-producto";
import { useUsuario } from "@/components/shell";
import { puede } from "@/lib/permisos";

type Item = { id: number; productoId: number; loteId: number | null; lote: string | null; vencimiento: string | null; registroSanitario: string | null; producto: string; codigo: string; laboratorio: string | null; categoria: string | null; unidades: number; enCampana: boolean; stockActual: number; precioUnitario?: number | null; costoUnitario?: number | null; precioActual?: number | null; costoActual?: number | null };
type Transf = { id: number; referencia: string; tipoDestino: "EMPRESA" | "SUCURSAL"; destinoTipoDoc: "RUC" | "DNI" | null; destinoDoc: string | null; registradoPorId: number; vendedor: string | null; ventaId: number | null; factura: string | null; medioPago?: string | null; destino: string; motivo: string; estado: string; registradoEn: string; registradoPor: string; decididoPor: string | null; decididoEn: string | null; comentario: string | null; costoAdicional?: number | null; totalVenta?: number | null; costoTotal?: number | null; items: Item[] };
type Ficha = { id: number; codigo: string; nombre: string; laboratorio: string | null; categoria: string | null; registroSanitario: string | null; stockVigente: number; enPromocion: boolean; presentaciones: { factor: number; pvp: number }[]; lotes: LoteFicha[] };
type LoteFicha = { id: number; numero: string; vencimiento: string; cantidad: number; estado: string };
type Linea = { ficha: Ficha; lote: LoteFicha; unidades: number };
// Cada línea sale de un lote elegido; solo las registradas antes del cambio pueden no tenerlo.
const LoteTexto = ({ lote, vencimiento }: { lote: string | null; vencimiento: string | null }) => (lote ? <Sello lote={lote} vence={vencimiento ? vence(vencimiento) : undefined} /> : <span className="text-[12.5px] font-semibold text-rojo">Sin lote</span>);
const TONO: Record<string, "ambar" | "ok" | "rojo" | "gris"> = { PENDIENTE: "ambar", APROBADA: "ok", RECHAZADA: "rojo", ANULADA: "gris" };
const MEDIOS = [["TRANSFERENCIA", "Transferencia bancaria"], ["EFECTIVO", "Efectivo"], ["YAPE", "Yape"], ["PLIN", "Plin"], ["TARJETA", "Tarjeta"]];
const TipoDestino = ({ t }: { t: Transf }) => (t.tipoDestino === "EMPRESA" ? <span className="text-[12px] text-ink-3">Venta · {t.destinoTipoDoc ?? "RUC"} {t.destinoDoc} · {t.destinoTipoDoc === "DNI" ? "boleta" : "factura"}</span> : <span className="text-[12px] text-ink-3">Traslado a sucursal propia</span>);
const docValido = (tipo: string, n: string) => (tipo === "RUC" ? /^(10|20)\d{9}$/.test(n) : /^\d{8}$/.test(n));

export default function Transferencias() {
  const u = useUsuario();
  const aprueba = puede(u.roles, "transferencias.aprobar");
  const pend = useDatos<Transf[]>(aprueba ? "/api/transferencias?estado=PENDIENTE" : null);
  const [tab, setTab] = useState<"nueva" | "aprobar" | "historial">(aprueba ? "aprobar" : "nueva");
  return (
    <div>
      <Encabezado titulo="Transferencias" bajada="Mercadería que sale hacia otra botica. El stock solo se descuenta cuando el propietario la aprueba con el precio de venta; no genera comisión." />
      <div className="mb-5"><Pestanas valor={tab} alCambiar={setTab} opciones={[
        { valor: "nueva", texto: "Nueva" },
        ...(aprueba ? [{ valor: "aprobar" as const, texto: "Por aprobar", extra: pend.datos?.length ? <Insignia tono="amor">{pend.datos.length}</Insignia> : undefined }] : []),
        { valor: "historial", texto: "Historial" },
      ]} /></div>
      {tab === "nueva" ? <Nueva alRegistrar={() => { pend.recargar(); setTab(aprueba ? "aprobar" : "historial"); }} /> : tab === "aprobar" ? <PorAprobar alDecidir={pend.recargar} /> : <Historial />}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return <div><p className="text-[12.5px] font-semibold text-ink-2 mb-1.5">{etiqueta}</p><div className="h-10 rounded-xl bg-foil px-3 flex items-center text-[14.5px] truncate">{valor ?? "—"}</div></div>;
}

function Nueva({ alRegistrar }: { alRegistrar: () => void }) {
  const u = useUsuario();
  const avisar = useAviso();
  const verPrecios = puede(u.roles, "transferencias.aprobar");
  const [tipoDestino, setTipoDestino] = useState<"EMPRESA" | "SUCURSAL">("EMPRESA");
  const [tipoDoc, setTipoDoc] = useState<"RUC" | "DNI">("RUC");
  const [ruc, setRuc] = useState("");
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [loteId, setLoteId] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Solo se ofrecen lotes que se pueden despachar: activos, sin vencer y con stock.
  const lotes = (ficha?.lotes ?? []).filter((l) => l.estado === "ACTIVO" && l.vencimiento > hoyLima() && l.cantidad > 0);
  const lote = lotes.find((l) => String(l.id) === loteId) ?? null;
  const yaProducto = ficha ? lineas.filter((l) => l.ficha.id === ficha.id).reduce((s, l) => s + l.unidades, 0) : 0;
  const yaLote = lote ? lineas.filter((l) => l.lote?.id === lote.id).reduce((s, l) => s + l.unidades, 0) : 0;
  const cant = Number(cantidad);
  const errorCant = !ficha || !(cant > 0) || !lote ? null
    : lote && cant + yaLote > lote.cantidad ? `El lote ${lote.numero} tiene ${lote.cantidad} unidades${yaLote ? ` (ya agregaste ${yaLote})` : ""}.`
    : cant + yaProducto > ficha.stockVigente ? `Solo hay ${ficha.stockVigente} unidades vigentes${yaProducto ? ` (ya agregaste ${yaProducto})` : ""}.` : null;
  const elegir = async (p: ProdBusqueda) => {
    try { setFicha(await api<Ficha>(`/api/productos/${p.id}`)); setCantidad(""); setLoteId(""); } catch (e) { avisar("error", (e as Error).message); }
  };
  const agregar = () => {
    if (!ficha || !lote || !(cant > 0) || errorCant) return;
    const igual = (l: Linea) => l.ficha.id === ficha.id && l.lote.id === lote.id;
    setLineas((ls) => ls.some(igual) ? ls.map((l) => (igual(l) ? { ...l, unidades: l.unidades + cant } : l)) : [...ls, { ficha, lote, unidades: cant }]);
    setFicha(null); setCantidad(""); setLoteId("");
  };
  const continuar = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await api<{ referencia: string }>("/api/transferencias", { cuerpo: { tipoDestino, destino, destinoTipoDoc: tipoDestino === "EMPRESA" ? tipoDoc : undefined, destinoDoc: tipoDestino === "EMPRESA" ? ruc : undefined, motivo, items: lineas.map((l) => ({ productoId: l.ficha.id, loteId: l.lote.id, unidades: l.unidades })) } });
      avisar("ok", `Transferencia ${r.referencia} registrada. Queda pendiente de aprobación del propietario.`);
      setDestino(""); setRuc(""); setMotivo(""); setLineas([]); alRegistrar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  const pvpUnidad = ficha?.presentaciones.find((x) => x.factor === 1)?.pvp;
  return (
    <div className="space-y-6">
      <Tarjeta titulo="Datos de la transferencia">
        <div className="px-5 pb-5 grid md:grid-cols-3 gap-3">
          <fieldset className="md:col-span-3">
            <legend className="text-[12.5px] font-semibold text-ink-2 mb-1.5">Tipo de transferencia (*)</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {([["EMPRESA", "Venta (farmacia o persona)", "Con RUC se emite factura; con DNI, boleta. Cuenta como venta"], ["SUCURSAL", "Traslado a sucursal propia", "Mismo RUC: no es venta, sale a costo"]] as const).map(([v, t, d]) => (
                <label key={v} className={`flex gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${tipoDestino === v ? "border-petroleo bg-[#f1f8f6]" : "border-foil-3"}`}>
                  <input type="radio" name="tipoDestino" className="mt-1" checked={tipoDestino === v} onChange={() => setTipoDestino(v)} />
                  <span><span className="font-semibold text-[14px]">{t}</span><span className="block text-[12px] text-ink-3">{d}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <Dato etiqueta="Origen" valor="Botica Amor y Salud" />
          {tipoDestino === "EMPRESA" ? (
            <Campo etiqueta="Documento del comprador (*)" ayuda={tipoDoc === "RUC" ? "Se emitirá factura" : "Persona sin RUC: se emitirá boleta"} error={tipoDoc === "RUC" && ruc.length === 11 && !/^(10|20)/.test(ruc) ? "El RUC empieza con 10 o 20" : null}>
              <div className="flex gap-2">
                <Selector className="w-24" aria-label="Tipo de documento" value={tipoDoc} onChange={(e) => { setTipoDoc(e.target.value as "RUC" | "DNI"); setRuc(""); }}><option value="RUC">RUC</option><option value="DNI">DNI</option></Selector>
                <EntradaNumero inputMode="numeric" aria-label="Número de documento" value={ruc} onChange={(e) => setRuc(e.target.value.slice(0, tipoDoc === "RUC" ? 11 : 8))} placeholder={tipoDoc === "RUC" ? "20100000011" : "12345678"} />
              </div>
            </Campo>
          ) : null}
          <Campo etiqueta={tipoDestino === "EMPRESA" ? (tipoDoc === "RUC" ? "Razón social (*)" : "Nombre completo (*)") : "Sucursal de destino (*)"}><Entrada value={destino} maxLength={120} onChange={(e) => setDestino(e.target.value)} placeholder={tipoDestino === "EMPRESA" ? (tipoDoc === "RUC" ? "Razón social que va en la factura" : "Nombre que va en la boleta") : "Nombre de la sucursal"} /></Campo>
          <Campo etiqueta="Motivo (*)"><Entrada value={motivo} maxLength={250} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: pedido de la sucursal por falta de stock" /></Campo>
          <Dato etiqueta="Serie y número" valor={<span className="text-ink-2">TR01 · se asigna al registrar</span>} />
          <Dato etiqueta="Fecha de transferencia" valor={fechaHora(new Date().toISOString())} />
          <Dato etiqueta="Responsable" valor={u.nombre} />
        </div>
      </Tarjeta>
      <Tarjeta titulo="Datos del producto">
        <div className="px-5 pb-5 space-y-3">
          <BuscadorProducto sinPrecio placeholder="Buscar producto por nombre o código" alElegir={elegir} />
          {ficha ? (
            <>
              <div className="grid md:grid-cols-4 gap-3">
                <div className="md:col-span-2"><Dato etiqueta="Nombre" valor={<span className="font-semibold">{ficha.nombre}</span>} /></div>
                <Dato etiqueta="Laboratorio" valor={ficha.laboratorio} />
                <Dato etiqueta="Categoría" valor={ficha.categoria} />
                <Dato etiqueta="R. sanitario" valor={ficha.registroSanitario} />
                {verPrecios ? <Dato etiqueta="Precio venta unitario" valor={soles(pvpUnidad)} /> : null}
                <Dato etiqueta="Stock sistema (vigente)" valor={`${numero(ficha.stockVigente)} und.`} />
                <Campo etiqueta="Lote (*)" ayuda={lote ? `Vence ${vence(lote.vencimiento)} · ${numero(lote.cantidad)} und. en el lote` : lotes.length ? "Elige el lote del que sale la mercadería" : "No hay lotes vigentes con stock"}>
                  <Selector value={loteId} onChange={(e) => setLoteId(e.target.value)} aria-invalid={!lote}>
                    <option value="">Elige el lote</option>
                    {lotes.map((l) => <option key={l.id} value={l.id}>{l.numero} · vence {vence(l.vencimiento)} · {numero(l.cantidad)} und.</option>)}
                  </Selector>
                </Campo>
                <Campo etiqueta="Cantidad a transferir (*)" error={errorCant}><EntradaNumero inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder="Unidades" /></Campo>
              </div>
              {ficha.enPromocion ? <p className="text-[13px] rounded-xl bg-ambar-claro text-[#8a5b00] px-3 py-2">Este producto está en campaña. En una transferencia la campaña no se aplica: no genera comisión.</p> : null}
              <div className="flex gap-2">
                <Boton disabled={!lote || !(cant > 0) || !!errorCant} onClick={agregar} title={lote ? undefined : "Elige primero el lote"}>Agregar a la lista</Boton>
                <Boton variante="borde" onClick={() => { setFicha(null); setCantidad(""); setLoteId(""); }}>Limpiar</Boton>
              </div>
            </>
          ) : <p className="text-[13px] text-ink-3">Busca un producto para ver sus datos y escribir la cantidad.</p>}
        </div>
        {lineas.length ? (
          <div className="overflow-x-auto border-t border-foil"><table className="tabla">
            <thead><tr><th>Producto</th><th>Lote / Venc.</th><th>R. sanitario</th><th className="num">Stock del lote</th><th className="num">Cantidad</th><th>Laboratorio</th><th>Categoría</th><th /></tr></thead>
            <tbody>{lineas.map((l) => (
              <tr key={`${l.ficha.id}:${l.lote.id}`}>
                <td><b>{l.ficha.nombre}</b><span className="block text-[12px] text-ink-3">{l.ficha.codigo}{l.ficha.enPromocion ? " · en campaña, sin comisión" : ""}</span></td>
                <td><LoteTexto lote={l.lote.numero} vencimiento={l.lote.vencimiento} /></td>
                <td className="whitespace-nowrap">{l.ficha.registroSanitario ?? <span className="text-ink-3">—</span>}</td>
                <td className="num">{numero(l.lote.cantidad)}</td><td className="num font-semibold">{numero(l.unidades)}</td>
                <td>{l.ficha.laboratorio ?? "—"}</td><td>{l.ficha.categoria ?? "—"}</td>
                <td className="text-right"><button className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-rojo" aria-label={`Quitar ${l.ficha.nombre}`} onClick={() => setLineas((ls) => ls.filter((x) => x !== l))}><Trash size={15} /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : null}
        <div className="px-5 py-4 border-t border-foil flex flex-wrap items-center justify-between gap-3">
          {error ? <p className="text-sm text-rojo">{error}</p> : <span className="text-[13px] text-ink-2">{lineas.length ? `${lineas.length} producto${lineas.length === 1 ? "" : "s"} en la lista` : "Agrega al menos un producto"}</span>}
          <Boton variante="amor" cargando={ocupado} disabled={!lineas.length || destino.trim().length < 3 || motivo.trim().length < 5 || (tipoDestino === "EMPRESA" && !docValido(tipoDoc, ruc))} onClick={continuar}>Registrar transferencia</Boton>
        </div>
      </Tarjeta>
    </div>
  );
}

type Usuario = { id: number; nombre: string; activo: boolean };

/** Precio mínimo por unidad para no perder (costo + IGV), redondeado hacia arriba al céntimo. */
const minimoDe = (costo: number | null | undefined) => (costo == null ? null : Math.ceil(costo * 1.18 * 100 - 1e-6) / 100);

function PorAprobar({ alDecidir }: { alDecidir: () => void }) {
  const { datos, recargar } = useDatos<Transf[]>("/api/transferencias?estado=PENDIENTE");
  const usuarios = useDatos<Usuario[]>("/api/usuarios/gestion");
  if (!datos) return <Cargando />;
  if (!datos.length) return <Tarjeta><Vacio titulo="No hay transferencias por aprobar">Cuando alguien registre una, aparecerá aquí para que indiques el precio de venta.</Vacio></Tarjeta>;
  return <div className="space-y-4">{datos.map((t) => <Aprobar key={t.id} t={t} usuarios={(usuarios.datos ?? []).filter((u) => u.activo)} alDecidir={() => { recargar(); alDecidir(); }} />)}</div>;
}

function Aprobar({ t, usuarios, alDecidir }: { t: Transf; usuarios: Usuario[]; alDecidir: () => void }) {
  const avisar = useAviso();
  const esVenta = t.tipoDestino === "EMPRESA";
  const [vendedorId, setVendedorId] = useState(String(t.registradoPorId));
  const [medio, setMedio] = useState("TRANSFERENCIA");
  // Parte del precio de lista: el propietario lo ajusta para fijar el precio de esta venta.
  const [precios, setPrecios] = useState<Record<number, string>>(() => Object.fromEntries(t.items.filter((i) => i.precioActual != null).map((i) => [i.id, String(i.precioActual)])));
  const [adicional, setAdicional] = useState("");
  const [comentario, setComentario] = useState("");
  const [motivoBajoCosto, setMotivoBajoCosto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Líneas cuyo precio no cubre el costo más el IGV: solo se aprueban a propósito y con motivo.
  const bajoCosto = esVenta ? t.items.map((i) => ({ i, p: Number(precios[i.id]), min: minimoDe(i.costoActual) }))
    .filter((x) => x.p > 0 && x.min !== null && x.p < x.min) : [];
  // Lo que se pierde de verdad: el costo menos lo que entra sin IGV, por cada unidad.
  const perdida = bajoCosto.reduce((s, x) => s + Math.max(0, (x.i.costoActual ?? 0) - x.p / 1.18) * x.i.unidades, 0);
  const total = t.items.reduce((s, i) => s + (Number(precios[i.id]) || 0) * i.unidades, 0);
  const completo = !esVenta || (t.items.every((i) => Number(precios[i.id]) > 0) && !!vendedorId);
  const sinStock = t.items.filter((i) => i.unidades > i.stockActual);
  const sinLote = t.items.filter((i) => !i.loteId);
  const decidir = async (aprobar: boolean) => {
    setOcupado(true); setError(null);
    try {
      let factura: string | null = null;
      if (aprobar) factura = (await api<{ factura: string | null }>(`/api/transferencias/${t.id}/aprobar`, { cuerpo: esVenta
        ? { precios: t.items.map((i) => ({ detalleId: i.id, precioUnitario: Number(precios[i.id]) })), vendedorId: Number(vendedorId), medioPago: medio, delivery: adicional ? Number(adicional) : undefined, comentario: comentario || undefined, motivoBajoCosto: bajoCosto.length ? motivoBajoCosto : undefined }
        : { costoAdicional: adicional ? Number(adicional) : undefined, comentario: comentario || undefined } })).factura;
      else await api(`/api/transferencias/${t.id}/rechazar`, { cuerpo: { comentario } });
      avisar("ok", !aprobar ? `${t.referencia} rechazada: el stock no se movió.` : factura ? `${t.referencia} aprobada: se emitió ${t.destinoTipoDoc === "DNI" ? "la boleta" : "la factura"} ${factura} y el stock ya se descontó.` : `${t.referencia} aprobada: traslado registrado y stock descontado.`);
      alDecidir();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  return (
    <Tarjeta className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><span className="sello">{t.referencia}</span><span className="font-semibold">A {t.destino}</span></div>
          <TipoDestino t={t} />
          <p className="text-sm text-ink-2 mt-1">{t.motivo}</p>
          <p className="text-[12.5px] text-ink-3 mt-1">Registró {t.registradoPor} · {fechaHora(t.registradoEn)}</p>
        </div>
      </div>
      <div className="overflow-x-auto mt-3"><table className="tabla">
        <thead><tr><th>Producto</th><th>Lote / Venc.</th><th>R. sanitario</th><th className="num">Cantidad</th><th className="num">Stock del lote</th><th className="num">Costo actual</th>{esVenta ? <><th className="num">Precio de lista</th><th className="num">Precio de venta</th><th className="num">Margen</th><th className="num">Subtotal</th></> : null}</tr></thead>
        <tbody>{t.items.map((i) => (
          <tr key={i.id}>
            <td><b>{i.producto}</b><span className="block text-[12px] text-ink-3">{i.codigo}{i.laboratorio ? ` · ${i.laboratorio}` : ""}{i.enCampana ? " · en campaña, sin comisión" : ""}</span></td>
            <td><LoteTexto lote={i.lote} vencimiento={i.vencimiento} /></td>
            <td className="whitespace-nowrap">{i.registroSanitario ?? <span className="text-ink-3">—</span>}</td>
            <td className="num">{numero(i.unidades)}</td>
            <td className={`num ${i.unidades > i.stockActual ? "text-rojo font-semibold" : ""}`}>{numero(i.stockActual)}</td>
            <td className="num text-ink-2">{i.costoActual != null ? soles(i.costoActual) : "—"}</td>
            {esVenta ? <>
              <td className="num text-ink-2">{i.precioActual != null ? soles(i.precioActual) : "—"}</td>
              <td className="num">{(() => {
                const min = minimoDe(i.costoActual); const bajo = min !== null && Number(precios[i.id]) > 0 && Number(precios[i.id]) < min;
                return <>
                  <EntradaNumero crudo inputMode="decimal" className={`w-28 h-9 rounded-lg border text-right px-2 ${bajo ? "border-rojo bg-rojo-claro/40" : "border-foil-3"}`} placeholder="0.00" value={precios[i.id] ?? ""} onChange={(e) => setPrecios({ ...precios, [i.id]: e.target.value })} aria-label={`Precio de ${i.producto}`} aria-invalid={bajo} />
                  {min !== null ? <span className={`block text-[11.5px] mt-1 ${bajo ? "text-rojo font-semibold" : "text-ink-3"}`}>{bajo ? "Bajo costo · " : ""}mín. {soles(min)}</span> : null}
                </>;
              })()}</td>
              <td className="num">{(() => { const p = Number(precios[i.id]); if (!(p > 0) || i.costoActual == null) return "—"; const m = ((p / 1.18 - i.costoActual) / (p / 1.18)) * 100; return <span className={m < 0 ? "text-rojo font-semibold" : ""}>{m.toFixed(1)}%</span>; })()}</td>
              <td className="num">{soles((Number(precios[i.id]) || 0) * i.unidades)}</td>
            </> : null}
          </tr>
        ))}</tbody>
      </table></div>
      {sinLote.length ? <p className="text-sm text-rojo mt-3">{sinLote.map((i) => i.producto).join(", ")} se registró sin lote. Recházala y regístrala de nuevo eligiendo el lote.</p> : null}
      {sinStock.length ? <p className="text-sm text-rojo mt-3">Ya no hay stock suficiente de {sinStock.map((i) => i.producto).join(", ")}. Recházala o espera a reponer.</p> : null}
      {esVenta ? (
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Campo etiqueta="Venta a nombre de (*)" ayuda="La venta queda registrada para este usuario; no genera comisión">
            <Selector value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
              {!usuarios.some((u) => String(u.id) === vendedorId) ? <option value={vendedorId}>{t.registradoPor}</option> : null}
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Medio de pago (*)" ayuda="No entra al cierre de ninguna caja">
            <Selector value={medio} onChange={(e) => setMedio(e.target.value)}>{MEDIOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</Selector>
          </Campo>
        </div>
      ) : <p className="text-[13px] text-ink-2 mt-3">Traslado a sucursal propia: no se factura ni cuenta como venta; la mercadería sale a su costo.</p>}
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)] gap-3 mt-4">
        <Campo etiqueta={esVenta ? "Delivery (lo paga el cliente)" : "Costo adicional (opcional)"} ayuda={esVenta ? `Se cobra en la ${t.destinoTipoDoc === "DNI" ? "boleta" : "factura"} como «Servicio de delivery»` : "Ej.: envío; lo asume la botica"}><EntradaNumero inputMode="decimal" value={adicional} onChange={(e) => setAdicional(e.target.value)} placeholder="0.00" /></Campo>
        <Campo etiqueta="Comentario" ayuda="Obligatorio para rechazar"><Entrada value={comentario} maxLength={250} onChange={(e) => setComentario(e.target.value)} /></Campo>
      </div>
      {bajoCosto.length ? (
        <div className="mt-4 rounded-2xl border border-rojo/30 bg-rojo-claro/50 p-4" role="alert">
          <p className="font-semibold text-rojo">Estás vendiendo por debajo del costo</p>
          <p className="text-[13px] text-ink-2 mt-1">
            {bajoCosto.map((x) => `${x.i.producto}: precio ${soles(x.p)}, mínimo para no perder ${soles(x.min)}`).join(" · ")}.
            {" "}Pérdida aproximada: <b className="text-rojo">{soles(perdida)}</b>. Si es a propósito (por ejemplo, para recuperar la inversión), escribe el motivo; queda registrado en la auditoría.
          </p>
          <Entrada className="mt-3" value={motivoBajoCosto} maxLength={250} onChange={(e) => setMotivoBajoCosto(e.target.value)} placeholder="Ej.: producto por vencer, se liquida para recuperar la inversión" aria-label="Motivo de la venta bajo costo" />
        </div>
      ) : null}
      {error ? <p className="text-sm text-rojo mt-3">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <span className="text-[13.5px]">{esVenta ? <>Total de la {t.destinoTipoDoc === "DNI" ? "boleta" : "factura"}: <b>{soles(total + (Number(adicional) || 0))}</b>{Number(adicional) > 0 ? <span className="text-ink-2"> (productos {soles(total)} + delivery {soles(Number(adicional))})</span> : null} · costo {soles(t.items.reduce((s, i) => s + (i.costoActual ?? 0) * i.unidades, 0))}</> : <>Sin venta · costo {soles(t.items.reduce((s, i) => s + (i.costoActual ?? 0) * i.unidades, 0))}</>}{!esVenta && Number(adicional) > 0 ? <span className="text-ink-2"> · costo adicional {soles(Number(adicional))}</span> : null}</span>
        <div className="flex gap-2">
          <Boton variante="borde" cargando={ocupado} disabled={comentario.trim().length < 5} onClick={() => decidir(false)}>Rechazar</Boton>
          <Boton variante={bajoCosto.length ? "peligro" : "amor"} cargando={ocupado} disabled={!completo || !!sinStock.length || !!sinLote.length || (bajoCosto.length > 0 && motivoBajoCosto.trim().length < 5)} onClick={() => decidir(true)}>
            {esVenta ? `${bajoCosto.length ? "Aprobar bajo costo y emitir" : "Aprobar y emitir"} ${t.destinoTipoDoc === "DNI" ? "boleta" : "factura"}` : "Aprobar traslado"}
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}

function Historial() {
  const u = useUsuario();
  const verPrecios = puede(u.roles, "transferencias.aprobar");
  const { datos } = useDatos<Transf[]>("/api/transferencias");
  const [abierta, setAbierta] = useState<number | null>(null);
  if (!datos) return <Cargando />;
  if (!datos.length) return <Tarjeta><Vacio titulo="Sin transferencias" /></Tarjeta>;
  return (
    <Tarjeta>
      <div className="overflow-x-auto"><table className="tabla">
        <thead><tr><th>Número</th><th>Destino</th><th>Fecha</th><th>Responsable</th><th>Estado</th>{verPrecios ? <th className="num">Total venta</th> : null}<th /></tr></thead>
        <tbody>{datos.map((t) => [
          <tr key={t.id}>
            <td><span className="sello">{t.referencia}</span>{t.factura ? <a className="block text-[12px] font-semibold text-vino-2 mt-1" href={`/comprobante/${t.ventaId}`} target="_blank" rel="noreferrer">{t.destinoTipoDoc === "DNI" ? "Boleta" : "Factura"} {t.factura}</a> : null}</td>
            <td><span className="font-semibold">{t.destino}</span><br /><TipoDestino t={t} /></td>
            <td className="whitespace-nowrap">{fechaHora(t.registradoEn)}</td><td>{t.registradoPor}</td>
            <td><Insignia tono={TONO[t.estado]}>{t.estado[0] + t.estado.slice(1).toLowerCase()}</Insignia></td>
            {verPrecios ? <td className="num">{t.totalVenta != null ? soles(t.totalVenta) : "—"}</td> : null}
            <td className="text-right"><Boton tam="sm" variante="fantasma" onClick={() => setAbierta(abierta === t.id ? null : t.id)}>{abierta === t.id ? "Ocultar" : "Ver detalle"}</Boton></td>
          </tr>,
          abierta === t.id ? (
            <tr key={`${t.id}-d`}><td colSpan={verPrecios ? 7 : 6} className="bg-foil/40">
              <p className="text-[13px] text-ink-2">{t.motivo}{t.decididoPor ? ` · ${t.estado === "APROBADA" ? "aprobó" : "rechazó"} ${t.decididoPor}, ${fechaHora(t.decididoEn)}` : ""}{t.vendedor ? ` · venta a nombre de ${t.vendedor}` : ""}{t.comentario ? ` · «${t.comentario}»` : ""}</p>
              <ul className="mt-2 space-y-1 text-[13px]">{t.items.map((i) => (
                <li key={i.id}><b>{i.producto}</b> · {i.lote ? `lote ${i.lote}${i.vencimiento ? ` (vence ${vence(i.vencimiento)})` : ""}` : "sin lote"}{i.registroSanitario ? ` · R.S. ${i.registroSanitario}` : ""} · {numero(i.unidades)} und.{verPrecios && i.precioUnitario != null ? ` · ${soles(i.precioUnitario)} c/u` : ""}{verPrecios && i.costoUnitario != null ? ` · costo ${soles(i.costoUnitario)} c/u` : ""}</li>
              ))}</ul>
              {verPrecios && t.estado === "APROBADA" ? <p className="text-[13px] mt-2">Total {soles(t.totalVenta)} · costo de la mercadería {soles(t.costoTotal)}{Number(t.costoAdicional) > 0 ? (t.tipoDestino === "EMPRESA" ? ` · incluye delivery cobrado al cliente ${soles(t.costoAdicional)}` : ` · costo adicional ${soles(t.costoAdicional)}`) : ""}</p> : null}
            </td></tr>
          ) : null,
        ])}</tbody>
      </table></div>
    </Tarjeta>
  );
}
