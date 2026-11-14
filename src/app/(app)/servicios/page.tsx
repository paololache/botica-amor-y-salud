"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, FileText, HeartPulse, Search } from "lucide-react";
import { api, useDatos, soles, fechaHora, hoyLima, vence } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, EntradaNumero, Insignia, Interruptor, Modal, Pestanas, Selector, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { BuscadorProducto, type ProdBusqueda } from "@/components/buscador-producto";
import { useUsuario } from "@/components/shell";
import { puede, tieneRol } from "@/lib/permisos";
import { textoResultado, type TipoServicio as Tipo } from "@/lib/servicios-texto";

type Servicio = { id: number; codigo: string; nombre: string; tipo: Tipo; via: string | null; descripcion: string | null; precio: number; precioExterno: number | null; requiereReceta: boolean; requiereConsentimiento: boolean; roles: string[]; activo: boolean; puedoRealizar: boolean };
type Atencion = {
  id: number; referencia: string; fecha: string; servicio: string; tipo: Tipo; via: string | null; atendio: string; pacienteDoc: string | null; pacienteNombre: string;
  resultados: Record<string, number | string | null> | null; clasificacion: string | null; derivar: boolean; precio: number; medioPago: string | null; estado: string;
  productoTexto: string | null; loteTexto: string | null; reaccionAdversa: string | null; usuarioId: number;
};
type Historial = { paciente: { nombre: string; telefono: string | null; notas: string | null } | null; atenciones: { id: number; fecha: string; servicio: string; tipo: Tipo; resultados: Record<string, number | string | null> | null; clasificacion: string | null; derivar: boolean }[] };
type Resultado = { id: number; referencia: string; servicio: string; clasificacion: string | null; derivar: boolean; urgente: boolean; precio: number };

const MEDIOS = [["EFECTIVO", "Efectivo"], ["YAPE", "Yape"], ["PLIN", "Plin"], ["TARJETA", "Tarjeta"], ["TRANSFERENCIA", "Transferencia"]] as const;
const VIAS: Record<string, string> = { IM: "intramuscular", SC: "subcutánea", ID: "intradérmica", IV: "intravenosa" };
const SITIOS: Record<string, string[]> = {
  IM: ["Glúteo derecho", "Glúteo izquierdo", "Deltoides derecho", "Deltoides izquierdo", "Muslo (vasto lateral)"],
  SC: ["Abdomen", "Cara externa del brazo", "Muslo"], ID: ["Antebrazo (cara interna)"], IV: ["Vena del pliegue del codo", "Dorso de la mano"],
};
const CHECKS = [
  ["pacienteCorrecto", "Paciente correcto (verifiqué su identidad)"], ["medicamentoCorrecto", "Medicamento correcto (coincide con la receta)"], ["dosisCorrecta", "Dosis correcta"],
  ["viaCorrecta", "Vía correcta"], ["horaCorrecta", "Hora y frecuencia correctas"], ["alergiasConsultadas", "Pregunté por alergias a medicamentos"],
  ["observacionPosterior", "Observé al paciente 15 minutos después de aplicar"],
] as const;

export default function Servicios() {
  const u = useUsuario();
  const [vista, setVista] = useState<"nueva" | "historial" | "catalogo">(puede(u.roles, "servicios") ? "nueva" : "historial");
  const opciones = [
    ...(puede(u.roles, "servicios") ? [{ valor: "nueva" as const, texto: "Nueva atención" }] : []),
    { valor: "historial" as const, texto: "Historial" },
    ...(puede(u.roles, "servicios.catalogo") ? [{ valor: "catalogo" as const, texto: "Catálogo y precios" }] : []),
  ];
  return (
    <div>
      <Encabezado titulo="Servicios farmacéuticos" bajada="Toma de presión, glucosa, temperatura, peso y talla, e inyectables con receta. Los resultados son referenciales y no reemplazan la consulta médica." />
      <div className="mb-5"><Pestanas valor={vista} alCambiar={setVista} opciones={opciones} /></div>
      {vista === "nueva" ? <NuevaAtencion /> : vista === "historial" ? <HistorialAtenciones /> : <Catalogo />}
    </div>
  );
}

function NuevaAtencion() {
  const u = useUsuario();
  const avisar = useAviso();
  const { datos: servicios } = useDatos<Servicio[]>("/api/servicios");
  const [sel, setSel] = useState<Servicio | null>(null);
  const [pac, setPac] = useState({ doc: "", nombre: "", edad: "", sexo: "", telefono: "" });
  const [historial, setHistorial] = useState<Historial | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [reposo, setReposo] = useState(false);
  const [iny, setIny] = useState({ origen: "INTERNO" as "INTERNO" | "EXTERNO", producto: "", lote: "", vencimiento: "", dosis: "", sitio: "", medico: "", cmp: "", fechaReceta: hoyLima(), consentimiento: false, reaccion: "" });
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [prod, setProd] = useState<{ id: number; nombre: string; lotes: { id: number; numero: string; vencimiento: string; cantidad: number; estado: string }[] } | null>(null);
  const [loteId, setLoteId] = useState("");
  const [medio, setMedio] = useState("EFECTIVO");
  const [sinCosto, setSinCosto] = useState(false);
  const [yaCobrado, setYaCobrado] = useState(false);
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    const d = pac.doc.trim();
    if (!/^\d{8}$/.test(d)) { setHistorial(null); return; }
    let vigente = true;
    api<Historial>(`/api/servicios/paciente?doc=${d}`).then((h) => {
      if (!vigente) return;
      setHistorial(h);
      if (h.paciente) setPac((p) => (p.doc === d && !p.nombre ? { ...p, nombre: h.paciente!.nombre, telefono: p.telefono || h.paciente!.telefono || "" } : p));
    }).catch(() => undefined);
    return () => { vigente = false; };
  }, [pac.doc]);

  const reiniciar = () => {
    setSel(null); setPac({ doc: "", nombre: "", edad: "", sexo: "", telefono: "" }); setV({}); setReposo(false); setChecks({}); setProd(null); setLoteId(""); setObs(""); setSinCosto(false); setYaCobrado(false); setError(null);
    setIny({ origen: "INTERNO", producto: "", lote: "", vencimiento: "", dosis: "", sitio: "", medico: "", cmp: "", fechaReceta: hoyLima(), consentimiento: false, reaccion: "" });
  };
  const precioActual = !sel ? 0 : sel.tipo === "INYECTABLE" && iny.origen === "EXTERNO" && sel.precioExterno != null ? Number(sel.precioExterno) : Number(sel.precio);
  const n = (k: string) => (v[k] === undefined || v[k] === "" ? undefined : Number(v[k]));
  const elegirProducto = async (p: ProdBusqueda) => {
    try { const f = await api<{ id: number; nombre: string; lotes: { id: number; numero: string; vencimiento: string; cantidad: number; estado: string }[] }>(`/api/productos/${p.id}`); setProd(f); setLoteId(""); }
    catch (e) { avisar("error", (e as Error).message); }
  };

  const registrar = async () => {
    if (!sel) return;
    setOcupado(true); setError(null);
    const cuerpo: Record<string, unknown> = {
      servicioId: sel.id, medioPago: medio, sinCosto, cobradoEnVenta: yaCobrado, observacion: obs || undefined,
      paciente: { doc: pac.doc.trim() || "", nombre: pac.nombre, edad: pac.edad ? Number(pac.edad) : undefined, sexo: pac.sexo || undefined, telefono: pac.telefono || undefined },
    };
    if (sel.tipo === "PRESION") cuerpo.presion = { sistolica: n("sis"), diastolica: n("dia"), pulso: n("pulso"), brazo: v.brazo || "IZQUIERDO", reposo };
    if (sel.tipo === "GLUCOSA") cuerpo.glucosa = { valor: n("glu"), condicion: v.condicion || "AYUNAS" };
    if (sel.tipo === "TEMPERATURA") cuerpo.temperatura = { valor: n("temp"), zona: v.zona || "AXILAR" };
    if (sel.tipo === "ANTROPOMETRIA") cuerpo.antropometria = { peso: n("peso"), talla: n("talla") };
    if (sel.tipo === "INYECTABLE") cuerpo.inyectable = {
      origen: iny.origen, loteId: iny.origen === "INTERNO" && loteId ? Number(loteId) : undefined,
      producto: iny.origen === "EXTERNO" ? iny.producto : undefined, lote: iny.origen === "EXTERNO" ? iny.lote : undefined, vencimiento: iny.origen === "EXTERNO" && iny.vencimiento ? iny.vencimiento : undefined,
      dosis: iny.dosis, sitio: iny.sitio, receta: { medico: iny.medico, cmp: iny.cmp, fecha: iny.fechaReceta },
      verificaciones: Object.fromEntries(CHECKS.map(([k]) => [k, !!checks[k]])), consentimiento: iny.consentimiento, reaccionAdversa: iny.reaccion || undefined,
    };
    try {
      const r = await api<Resultado>("/api/servicios/atenciones", { cuerpo });
      setResultado(r); reiniciar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  if (resultado) return (
    <Tarjeta className="p-6 max-w-xl aparecer">
      <p className="sello">{resultado.referencia}</p>
      <h2 className="font-display font-semibold text-[22px] mt-3">{resultado.servicio} registrado</h2>
      {resultado.clasificacion ? <p className="mt-2 text-[15px]">Resultado: <b className={resultado.derivar ? "text-rojo" : "text-ok"}>{resultado.clasificacion}</b></p> : null}
      {resultado.urgente ? <p className="mt-3 rounded-xl bg-rojo-claro px-3 py-2 text-[13.5px] text-rojo font-semibold flex gap-2"><AlertTriangle size={18} className="shrink-0" /> Valor de alarma: recomienda acudir de inmediato a un establecimiento de salud.</p>
        : resultado.derivar ? <p className="mt-3 rounded-xl bg-ambar-claro px-3 py-2 text-[13.5px] text-[#8a5b00]">Fuera de rango: recomienda al paciente consultar con su médico.</p> : null}
      <p className="text-[13px] text-ink-2 mt-3">{resultado.precio > 0 ? `Se cobró ${soles(resultado.precio)}; el ingreso quedó en tu caja.` : "Sin costo."}</p>
      <div className="flex flex-wrap gap-2 mt-5">
        <a href={`/constancia-servicio/${resultado.id}`} target="_blank" rel="noopener"><Boton variante="borde"><FileText size={16} /> Constancia para el paciente</Boton></a>
        <Boton onClick={() => setResultado(null)}>Nueva atención</Boton>
      </div>
    </Tarjeta>
  );

  return (
    <div className="space-y-5">
      <Tarjeta titulo="1. Servicio">
        {!servicios ? <div className="p-5"><Cargando /></div> : (
          <div className="px-5 pb-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {servicios.map((s) => (
              <button key={s.id} disabled={!s.puedoRealizar} onClick={() => { setSel(s); setError(null); }} aria-pressed={sel?.id === s.id}
                className={`text-left rounded-xl border px-3 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed ${sel?.id === s.id ? "border-petroleo bg-petroleo/5 ring-1 ring-petroleo" : "border-foil-3 hover:border-ink-3"}`}>
                <span className="block font-semibold text-[14px]">{s.nombre}</span>
                <span className="block text-[12px] text-ink-2 mt-0.5">{s.precio > 0 ? soles(s.precio) : "Gratuito"}{s.precioExterno != null && s.precioExterno !== s.precio ? ` · externo ${soles(s.precioExterno)}` : ""}{s.requiereReceta ? " · con receta" : ""}</span>
                {!s.puedoRealizar ? <span className="block text-[11.5px] text-ink-3 mt-0.5">Solo {s.roles.map((r) => (r === "QF" ? "QF" : r.toLowerCase())).join(" o ")}</span> : null}
              </button>
            ))}
          </div>
        )}
      </Tarjeta>

      {sel ? (
        <>
          <Tarjeta titulo="2. Paciente">
            <div className="px-5 pb-5 grid sm:grid-cols-[150px_minmax(0,1fr)_90px_110px] gap-3">
              <Campo etiqueta="DNI (opcional)" ayuda="Guarda su historial"><EntradaNumero inputMode="numeric" value={pac.doc} onChange={(e) => setPac({ ...pac, doc: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="12345678" /></Campo>
              <Campo etiqueta="Nombre completo (*)"><Entrada value={pac.nombre} maxLength={120} onChange={(e) => setPac({ ...pac, nombre: e.target.value })} /></Campo>
              <Campo etiqueta="Edad"><EntradaNumero inputMode="numeric" value={pac.edad} onChange={(e) => setPac({ ...pac, edad: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></Campo>
              <Campo etiqueta="Sexo"><Selector value={pac.sexo} onChange={(e) => setPac({ ...pac, sexo: e.target.value })}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></Selector></Campo>
            </div>
            {historial?.paciente?.notas ? <p className="mx-5 mb-3 rounded-xl bg-ambar-claro px-3 py-2 text-[13px] text-[#8a5b00]">Nota del cliente: {historial.paciente.notas}</p> : null}
            {historial?.atenciones.length ? (
              <div className="mx-5 mb-5 rounded-xl bg-foil px-3 py-2.5 text-[13px]">
                <p className="font-semibold text-ink-2 mb-1">Atenciones anteriores</p>
                <ul className="space-y-0.5">{historial.atenciones.slice(0, 5).map((a) => (
                  <li key={a.id}>{fechaHora(a.fecha)} · {a.servicio}: <b>{textoResultado(a.tipo, a.resultados)}</b>{a.clasificacion ? <span className={a.derivar ? "text-rojo" : "text-ink-2"}> · {a.clasificacion}</span> : null}</li>
                ))}</ul>
              </div>
            ) : null}
          </Tarjeta>

          <Tarjeta titulo={`3. ${sel.nombre}`}>
            <div className="px-5 pb-5 space-y-4">
              {sel.descripcion ? <p className="text-[13px] text-ink-2">{sel.descripcion}</p> : null}
              {sel.tipo === "PRESION" ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Campo etiqueta="Sistólica (mmHg)"><EntradaNumero inputMode="numeric" value={v.sis ?? ""} onChange={(e) => setV({ ...v, sis: e.target.value })} placeholder="120" /></Campo>
                    <Campo etiqueta="Diastólica (mmHg)"><EntradaNumero inputMode="numeric" value={v.dia ?? ""} onChange={(e) => setV({ ...v, dia: e.target.value })} placeholder="80" /></Campo>
                    <Campo etiqueta="Pulso (lpm)"><EntradaNumero inputMode="numeric" value={v.pulso ?? ""} onChange={(e) => setV({ ...v, pulso: e.target.value })} placeholder="72" /></Campo>
                    <Campo etiqueta="Brazo"><Selector value={v.brazo ?? "IZQUIERDO"} onChange={(e) => setV({ ...v, brazo: e.target.value })}><option value="IZQUIERDO">Izquierdo</option><option value="DERECHO">Derecho</option></Selector></Campo>
                  </div>
                  <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="size-4" checked={reposo} onChange={(e) => setReposo(e.target.checked)} /> El paciente reposó 5 minutos, sentado, sin haber fumado ni tomado café en los últimos 30 minutos</label>
                </>
              ) : sel.tipo === "GLUCOSA" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Campo etiqueta="Glucosa (mg/dL)"><EntradaNumero inputMode="numeric" value={v.glu ?? ""} onChange={(e) => setV({ ...v, glu: e.target.value })} placeholder="95" /></Campo>
                  <Campo etiqueta="Condición"><Selector value={v.condicion ?? "AYUNAS"} onChange={(e) => setV({ ...v, condicion: e.target.value })}><option value="AYUNAS">En ayunas (8 h)</option><option value="POSTPRANDIAL">2 h después de comer</option><option value="ALEATORIA">Al azar</option></Selector></Campo>
                </div>
              ) : sel.tipo === "TEMPERATURA" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Campo etiqueta="Temperatura (°C)"><EntradaNumero inputMode="decimal" value={v.temp ?? ""} onChange={(e) => setV({ ...v, temp: e.target.value.replace(",", ".") })} placeholder="36.5" /></Campo>
                  <Campo etiqueta="Zona"><Selector value={v.zona ?? "AXILAR"} onChange={(e) => setV({ ...v, zona: e.target.value })}><option value="AXILAR">Axilar</option><option value="ORAL">Oral</option><option value="TIMPANICA">Timpánica</option><option value="FRONTAL">Frontal</option></Selector></Campo>
                </div>
              ) : sel.tipo === "ANTROPOMETRIA" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Campo etiqueta="Peso (kg)"><EntradaNumero inputMode="decimal" value={v.peso ?? ""} onChange={(e) => setV({ ...v, peso: e.target.value.replace(",", ".") })} placeholder="70" /></Campo>
                  <Campo etiqueta="Talla (cm)"><EntradaNumero inputMode="numeric" value={v.talla ?? ""} onChange={(e) => setV({ ...v, talla: e.target.value })} placeholder="165" /></Campo>
                  {n("peso") && n("talla") ? <div className="self-end pb-2 text-[13.5px]">IMC <b>{(n("peso")! / (n("talla")! / 100) ** 2).toFixed(1)}</b></div> : null}
                </div>
              ) : sel.tipo === "INYECTABLE" ? (
                <>
                  {sel.via === "IV" ? <p className="rounded-xl bg-ambar-claro px-3 py-2 text-[13px] text-[#8a5b00] flex gap-2"><AlertTriangle size={17} className="shrink-0" /> La vía intravenosa solo se aplica si la botica está autorizada para ese servicio y lo realiza un profesional de salud.</p> : null}
                  <fieldset>
                    <legend className="text-[12.5px] font-semibold text-ink-2 mb-1.5">Receta médica (obligatoria)</legend>
                    <div className="grid sm:grid-cols-[minmax(0,1fr)_130px_160px] gap-3">
                      <Campo etiqueta="Médico que la indica"><Entrada value={iny.medico} onChange={(e) => setIny({ ...iny, medico: e.target.value })} placeholder="Dr(a). ..." /></Campo>
                      <Campo etiqueta="CMP"><EntradaNumero inputMode="numeric" value={iny.cmp} onChange={(e) => setIny({ ...iny, cmp: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></Campo>
                      <Campo etiqueta="Fecha de la receta"><Entrada type="date" value={iny.fechaReceta} max={hoyLima()} onChange={(e) => setIny({ ...iny, fechaReceta: e.target.value })} /></Campo>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="text-[12.5px] font-semibold text-ink-2 mb-1.5">Medicamento</legend>
                    <div className="grid sm:grid-cols-2 gap-2 mb-3">
                      {([["INTERNO", "De la botica (interno)", "Se vendió aquí: elige el lote"], ["EXTERNO", "Lo trae el paciente (externo)", "Revisa lote y vencimiento antes de aplicar"]] as const).map(([o, t, d]) => (
                        <label key={o} className={`flex gap-2.5 rounded-xl border px-3 py-2 cursor-pointer ${iny.origen === o ? "border-petroleo bg-petroleo/5" : "border-foil-3"}`}>
                          <input type="radio" className="mt-1" checked={iny.origen === o} onChange={() => setIny({ ...iny, origen: o })} />
                          <span><span className="font-semibold text-[13.5px]">{t}</span><span className="block text-[12px] text-ink-3">{d}</span></span>
                        </label>
                      ))}
                    </div>
                    {iny.origen === "INTERNO" ? (
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>{prod ? <p className="text-[13.5px] mb-1"><b>{prod.nombre}</b> <button className="text-petroleo-3 text-[12.5px] font-semibold ml-1" onClick={() => setProd(null)}>cambiar</button></p> : <BuscadorProducto sinPrecio placeholder="Busca el inyectable" alElegir={elegirProducto} />}</div>
                        {prod ? <Campo etiqueta="Lote"><Selector value={loteId} onChange={(e) => setLoteId(e.target.value)}>
                          <option value="">Elige el lote</option>
                          {prod.lotes.filter((l) => l.estado === "ACTIVO" && l.vencimiento > hoyLima() && l.cantidad > 0).map((l) => <option key={l.id} value={l.id}>{l.numero} · vence {vence(l.vencimiento)}</option>)}
                        </Selector></Campo> : null}
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-[minmax(0,1fr)_140px_160px] gap-3">
                        <Campo etiqueta="Medicamento y presentación"><Entrada value={iny.producto} onChange={(e) => setIny({ ...iny, producto: e.target.value })} placeholder="Dexametasona 4 mg/ml ampolla" /></Campo>
                        <Campo etiqueta="Lote"><Entrada value={iny.lote} onChange={(e) => setIny({ ...iny, lote: e.target.value.toUpperCase() })} /></Campo>
                        <Campo etiqueta="Vencimiento"><Entrada type="date" value={iny.vencimiento} onChange={(e) => setIny({ ...iny, vencimiento: e.target.value })} /></Campo>
                      </div>
                    )}
                    <div className="grid sm:grid-cols-2 gap-3 mt-3">
                      <Campo etiqueta="Dosis"><Entrada value={iny.dosis} onChange={(e) => setIny({ ...iny, dosis: e.target.value })} placeholder="1 ampolla de 2 ml" /></Campo>
                      <Campo etiqueta={`Sitio de aplicación (vía ${VIAS[sel.via ?? ""] ?? ""})`}><Selector value={iny.sitio} onChange={(e) => setIny({ ...iny, sitio: e.target.value })}><option value="">Elige el sitio</option>{(SITIOS[sel.via ?? ""] ?? []).map((x) => <option key={x}>{x}</option>)}</Selector></Campo>
                    </div>
                  </fieldset>
                  <fieldset className="rounded-xl border border-foil-2 p-3">
                    <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Antes y después de aplicar (5 correctos)</legend>
                    <div className="grid sm:grid-cols-2 gap-1.5">
                      {CHECKS.map(([k, t]) => <label key={k} className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="size-4 mt-0.5" checked={!!checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} /> {t}</label>)}
                      <label className="flex items-start gap-2 text-[13px] font-semibold"><input type="checkbox" className="size-4 mt-0.5" checked={iny.consentimiento} onChange={(e) => setIny({ ...iny, consentimiento: e.target.checked })} /> El paciente (o su apoderado) dio su consentimiento</label>
                    </div>
                  </fieldset>
                  <Campo etiqueta="Reacción adversa (solo si ocurrió)" ayuda="Se marca para derivar; notifícala a DIGEMID con el formato de sospecha de reacción adversa"><Entrada value={iny.reaccion} onChange={(e) => setIny({ ...iny, reaccion: e.target.value })} placeholder="Ej.: enrojecimiento, mareo, erupción" /></Campo>
                </>
              ) : null}
              <Campo etiqueta="Observación (opcional)"><Entrada value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} /></Campo>
            </div>
          </Tarjeta>

          <Tarjeta className="p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="text-[12.5px] font-semibold text-ink-2">Precio</p>
                <p className="cifra text-[26px]">{precioActual > 0 && !sinCosto && !yaCobrado ? soles(precioActual) : yaCobrado ? "Cobrado en Vender" : "Sin costo"}</p>
                {sel.tipo === "INYECTABLE" && sel.precioExterno != null && sel.precioExterno !== sel.precio ? <p className="text-[12px] text-ink-3">{iny.origen === "EXTERNO" ? "Con medicamento externo" : "Con medicamento de la botica"}</p> : null}
              </div>
              {precioActual > 0 ? <label className="flex items-center gap-2 text-[13px] pb-2"><input type="checkbox" className="size-4" checked={yaCobrado} onChange={(e) => setYaCobrado(e.target.checked)} /> Ya se cobró en Vender</label> : null}
              {precioActual > 0 && !sinCosto && !yaCobrado ? <Campo etiqueta="Medio de pago" ayuda="Entra a tu caja como ingreso"><Selector value={medio} onChange={(e) => setMedio(e.target.value)} className="w-44">{MEDIOS.map(([m, t]) => <option key={m} value={m}>{t}</option>)}</Selector></Campo> : null}
              {precioActual > 0 && tieneRol(u.roles, "ADMIN", "QF") ? <label className="flex items-center gap-2 text-[13px] pb-2"><Interruptor activo={sinCosto} alCambiar={() => setSinCosto(!sinCosto)} etiqueta="Cortesía" /> Cortesía (sin costo)</label> : null}
              <Boton variante="amor" tam="lg" className="ml-auto" cargando={ocupado} disabled={pac.nombre.trim().length < 3} onClick={registrar}><HeartPulse size={18} /> Registrar atención</Boton>
            </div>
            {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
          </Tarjeta>
        </>
      ) : null}
    </div>
  );
}

function HistorialAtenciones() {
  const u = useUsuario();
  const avisar = useAviso();
  const [desde, setDesde] = useState(new Date(Date.now() - 29 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Lima" }));
  const [hasta, setHasta] = useState(hoyLima());
  const [buscar, setBuscar] = useState("");
  const [derivar, setDerivar] = useState(false);
  const q = new URLSearchParams({ desde, hasta, ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(derivar ? { derivar: "1" } : {}) });
  const { datos, recargar } = useDatos<Atencion[]>(`/api/servicios/atenciones?${q}`);
  const [anular, setAnular] = useState<Atencion | null>(null);
  const [motivo, setMotivo] = useState("");
  const registradas = (datos ?? []).filter((a) => a.estado === "REGISTRADA");
  const cobrado = registradas.reduce((s, a) => s + Number(a.precio), 0);
  return (
    <>
      <Tarjeta>
        <div className="p-4 flex flex-wrap gap-2 items-end">
          <Campo etiqueta="Desde"><Entrada type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></Campo>
          <Campo etiqueta="Hasta"><Entrada type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></Campo>
          <div className="relative flex-1 min-w-[200px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" /><Entrada value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Paciente o DNI" className="pl-9" /></div>
          <label className="flex items-center gap-2 text-[13px] pb-2"><input type="checkbox" className="size-4" checked={derivar} onChange={(e) => setDerivar(e.target.checked)} /> Solo para derivar</label>
        </div>
        <p className="px-4 pb-3 text-[13px] text-ink-2">{registradas.length} atenciones · {soles(cobrado)} cobrados</p>
        {!datos ? <div className="p-5"><Cargando /></div> : datos.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Fecha</th><th>Paciente</th><th>Servicio</th><th>Resultado</th><th>Atendió</th><th className="num">Precio</th><th /></tr></thead>
            <tbody>{datos.map((a) => (
              <tr key={a.id} className={a.estado === "ANULADA" ? "opacity-55" : ""}>
                <td className="whitespace-nowrap">{fechaHora(a.fecha)}<span className="block text-[11.5px] text-ink-3">{a.referencia}</span></td>
                <td><span className="font-semibold">{a.pacienteNombre}</span>{a.pacienteDoc ? <span className="block text-[12px] text-ink-3">DNI {a.pacienteDoc}</span> : null}</td>
                <td>{a.servicio}{a.productoTexto ? <span className="block text-[12px] text-ink-3">{a.productoTexto}{a.loteTexto ? ` · lote ${a.loteTexto}` : ""}</span> : null}</td>
                <td>{textoResultado(a.tipo, a.resultados)}{a.clasificacion ? <span className="block mt-0.5"><Insignia tono={a.derivar ? "rojo" : "ok"}>{a.clasificacion}</Insignia></span> : null}{a.estado === "ANULADA" ? <Insignia tono="gris" className="mt-1">Anulada</Insignia> : null}</td>
                <td>{a.atendio}</td>
                <td className="num">{Number(a.precio) > 0 ? soles(a.precio) : "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <a href={`/constancia-servicio/${a.id}`} target="_blank" rel="noopener" className="inline-grid size-8 place-items-center rounded-lg border border-foil-3 text-ink-2 hover:text-ink" title="Constancia" aria-label={`Constancia ${a.referencia}`}><FileText size={15} /></a>
                  {a.estado === "REGISTRADA" && (a.usuarioId === u.id || u.roles.includes("ADMIN")) && puede(u.roles, "servicios") ? <Boton tam="sm" variante="fantasma" className="ml-1" onClick={() => { setAnular(a); setMotivo(""); }}>Anular</Boton> : null}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Vacio titulo="Sin atenciones con estos filtros" />}
      </Tarjeta>
      <Modal abierto={!!anular} alCerrar={() => setAnular(null)} titulo={`Anular ${anular?.referencia ?? ""}`}>
        <p className="text-sm text-ink-2">{anular?.servicio} · {anular?.pacienteNombre}. {Number(anular?.precio) > 0 ? "El ingreso sale de la caja si sigue abierta." : ""}</p>
        <Campo etiqueta="Motivo" className="mt-3"><Entrada autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: se registró dos veces" /></Campo>
        <div className="flex justify-end gap-2 mt-5">
          <Boton variante="fantasma" onClick={() => setAnular(null)}>Cancelar</Boton>
          <Boton variante="peligro" disabled={motivo.trim().length < 5} onClick={async () => {
            try { await api(`/api/servicios/atenciones/${anular!.id}/anular`, { cuerpo: { motivo } }); avisar("ok", "Atención anulada."); setAnular(null); recargar(); }
            catch (e) { avisar("error", (e as Error).message); }
          }}>Anular</Boton>
        </div>
      </Modal>
    </>
  );
}

const PERFILES = [["ADMIN", "Admin"], ["QF", "QF"], ["CAJERO", "Cajero"], ["VENDEDOR", "Vendedor"]] as const;

function Catalogo() {
  const avisar = useAviso();
  const { datos, recargar } = useDatos<Servicio[]>("/api/servicios?todos=1");
  const [cambios, setCambios] = useState<Record<number, Partial<Servicio>>>({});
  if (!datos) return <Cargando />;
  const de = (s: Servicio) => ({ ...s, ...cambios[s.id] });
  const guardar = async (s: Servicio) => {
    const x = de(s);
    try {
      await api(`/api/servicios/${s.id}`, { metodo: "PUT", cuerpo: { nombre: x.nombre, descripcion: x.descripcion, precio: Number(x.precio), precioExterno: x.precioExterno == null || String(x.precioExterno) === "" ? null : Number(x.precioExterno), roles: x.roles, requiereReceta: x.requiereReceta, requiereConsentimiento: x.requiereConsentimiento, activo: x.activo } });
      avisar("ok", `${x.nombre} actualizado.`); setCambios((c) => { const n = { ...c }; delete n[s.id]; return n; }); recargar();
    } catch (e) { avisar("error", (e as Error).message); }
  };
  return (
    <Tarjeta>
      <p className="px-5 pt-4 text-[13px] text-ink-2">Buenas prácticas: los procedimientos invasivos (glucosa e inyectables) solo los realiza el químico farmacéutico o el administrador, y los inyectables siempre piden receta y consentimiento.</p>
      <div className="overflow-x-auto mt-2"><table className="tabla">
        <thead><tr><th>Servicio</th><th className="num">Precio</th><th className="num">Con medicamento externo</th><th>Quién lo realiza</th><th>Requisitos</th><th>Activo</th><th /></tr></thead>
        <tbody>{datos.map((s) => {
          const x = de(s);
          return (
            <tr key={s.id}>
              <td><span className="font-semibold">{s.nombre}</span><span className="block text-[12px] text-ink-3">{s.codigo}</span></td>
              <td className="num"><EntradaNumero crudo inputMode="decimal" className="w-24 h-9 rounded-lg border border-foil-3 text-right px-2" value={String(x.precio)} onChange={(e) => setCambios({ ...cambios, [s.id]: { ...cambios[s.id], precio: e.target.value.replace(",", ".") as unknown as number } })} aria-label={`Precio de ${s.nombre}`} /></td>
              <td className="num">{s.tipo === "INYECTABLE" ? <EntradaNumero crudo inputMode="decimal" className="w-24 h-9 rounded-lg border border-foil-3 text-right px-2" placeholder="igual" value={x.precioExterno == null ? "" : String(x.precioExterno)} onChange={(e) => setCambios({ ...cambios, [s.id]: { ...cambios[s.id], precioExterno: (e.target.value.trim() === "" ? null : e.target.value.replace(",", ".")) as unknown as number | null } })} aria-label={`Precio con medicamento externo de ${s.nombre}`} /> : <span className="text-ink-3">—</span>}</td>
              <td><div className="flex flex-wrap gap-1">{PERFILES.map(([r, t]) => (
                <button key={r} aria-pressed={x.roles.includes(r)} onClick={() => setCambios({ ...cambios, [s.id]: { ...cambios[s.id], roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] } })}
                  className={`h-7 px-2.5 rounded-full text-[12px] font-semibold border ${x.roles.includes(r) ? "bg-petroleo text-white border-petroleo" : "border-foil-3 text-ink-2"}`}>{t}</button>
              ))}</div></td>
              <td className="text-[12.5px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={x.requiereReceta} onChange={(e) => setCambios({ ...cambios, [s.id]: { ...cambios[s.id], requiereReceta: e.target.checked } })} /> Receta</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={x.requiereConsentimiento} onChange={(e) => setCambios({ ...cambios, [s.id]: { ...cambios[s.id], requiereConsentimiento: e.target.checked } })} /> Consentimiento</label>
              </td>
              <td><Interruptor activo={x.activo} alCambiar={() => setCambios({ ...cambios, [s.id]: { ...cambios[s.id], activo: !x.activo } })} etiqueta={`Activar ${s.nombre}`} /></td>
              <td className="text-right">{cambios[s.id] ? <Boton tam="sm" onClick={() => guardar(s)}>Guardar</Boton> : null}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </Tarjeta>
  );
}
