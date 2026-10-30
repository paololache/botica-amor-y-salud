"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock, History, Trash, ShieldAlert } from "lucide-react";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Campo, Entrada, Encabezado, Cargando, Insignia, Modal, Selector, Tarjeta, useAviso } from "@/components/ui";
import { ContadorEfectivo, totalDe } from "@/components/contador";
import { useUsuario } from "@/components/shell";

type Estado = {
  sesion: { id: number; cajaId: number; caja: string; turno: string; abiertaEn: string; estado: string; fondoInicial: number } | null;
  cajas: { id: number; nombre: string; ocupadaPor: string | null; fondoSugerido: number }[];
  resumen: {
    tickets: number; movimientos: { id: number; tipo: string; concepto: string; medio: string; monto: number; fecha: string }[];
    ventas: { medio: Medio; total: number }[]; totalVentas: number; anuladas: number; esperado: Record<Medio, number>;
  } | null;
  conceptos: { INGRESO: string[]; EGRESO: string[] };
};
type Medio = "EFECTIVO" | "YAPE" | "PLIN" | "TARJETA" | "TRANSFERENCIA";
const TURNOS = ["MAÑANA", "TARDE", "NOCHE", "COMPLETO"] as const;
const DIGITALES = ["YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"] as const;
const NOMBRE_MEDIO: Record<Medio, string> = { EFECTIVO: "Efectivo", YAPE: "Yape", PLIN: "Plin", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };
const UMBRAL = 5;
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function Caja() {
  const u = useUsuario();
  const avisar = useAviso();
  const { datos, recargar, cargando } = useDatos<Estado>("/api/caja");
  const [cajaId, setCajaId] = useState<number | null>(null);
  const [turno, setTurno] = useState<(typeof TURNOS)[number]>("MAÑANA");
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mov, setMov] = useState({ tipo: "EGRESO" as "INGRESO" | "EGRESO", concepto: "", medio: "EFECTIVO", monto: "", comprobante: "" });
  const [cerrando, setCerrando] = useState(false);
  const [virt, setVirt] = useState({ YAPE: "", PLIN: "", TARJETA: "", TRANSFERENCIA: "" });
  const [fondoSig, setFondoSig] = useState("150");
  const [resultado, setResultado] = useState<{ sesionId: number; estado: string; diferencia: number } | null>(null);
  const [val, setVal] = useState({ login: "", password: "", observacion: "" });
  const [borrar, setBorrar] = useState<{ id: number; tipo: string; concepto: string; medio: string; monto: number } | null>(null);
  const [motivoBorrar, setMotivoBorrar] = useState("");

  // El resumen del turno se actualiza solo mientras se vende en otra pestaña o en otra caja.
  useEffect(() => {
    if (cerrando) return;
    const h = setInterval(() => { if (!document.hidden) recargar(); }, 30000);
    const alVolver = () => recargar();
    window.addEventListener("focus", alVolver);
    return () => { clearInterval(h); window.removeEventListener("focus", alVolver); };
  }, [recargar, cerrando]);

  if (cargando && !datos) return <Cargando alto="h-96" />;
  if (!datos) return null;
  const elegida = datos.cajas.find((c) => c.id === (cajaId ?? datos.cajas.find((x) => !x.ocupadaPor)?.id));
  const fondo = totalDe(conteo);
  const difiere = elegida && fondo > 0 && elegida.fondoSugerido > 0 && Math.abs(elegida.fondoSugerido - fondo) > 0.001;

  const abrir = async () => {
    if (!elegida) return;
    setOcupado(true); setError(null);
    try {
      await api("/api/caja/abrir", { cuerpo: { cajaId: elegida.id, turno, conteo, observacion: obs || undefined } });
      avisar("ok", `${elegida.nombre} abierta con ${soles(fondo)}.`);
      setConteo({}); setObs(""); recargar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const registrarMov = async () => {
    setOcupado(true);
    try {
      await api("/api/caja/movimiento", { cuerpo: { ...mov, monto: Number(mov.monto), comprobante: mov.comprobante || undefined } });
      avisar("ok", `${mov.tipo === "INGRESO" ? "Ingreso" : "Egreso"} registrado.`);
      setMov({ ...mov, concepto: "", monto: "", comprobante: "" }); recargar();
    } catch (e) { avisar("error", (e as Error).message); } finally { setOcupado(false); }
  };

  const cerrar = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await api<{ sesionId: number; estado: string; diferencia: number }>("/api/caja/cerrar", { cuerpo: {
        conteo, virtuales: { YAPE: Number(virt.YAPE) || 0, PLIN: Number(virt.PLIN) || 0, TARJETA: Number(virt.TARJETA) || 0, TRANSFERENCIA: Number(virt.TRANSFERENCIA) || 0 },
        fondoSiguiente: Number(fondoSig) || 0, observacion: obs || undefined,
      } });
      setResultado(r); setCerrando(false); setConteo({}); recargar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const eliminarMov = async () => {
    if (!borrar) return;
    setOcupado(true);
    try {
      await api(`/api/caja/movimiento/${borrar.id}`, { metodo: "DELETE", cuerpo: { motivo: motivoBorrar } });
      avisar("ok", `${borrar.tipo === "INGRESO" ? "Ingreso" : "Egreso"} eliminado.`);
      setBorrar(null); recargar();
    } catch (e) { avisar("error", (e as Error).message); } finally { setOcupado(false); }
  };

  const validar = async (sesionId: number) => {
    setOcupado(true); setError(null);
    try {
      await api("/api/caja/validar", { cuerpo: { sesionId, ...val } });
      avisar("ok", "Cierre validado."); setResultado((r) => (r ? { ...r, estado: "CERRADA" } : r)); recargar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const historial = (
    <>
      <Link href="/caja/historial"><Boton variante="borde"><History size={16} /> Cierres anteriores</Boton></Link>
      {u.rol === "ADMIN" ? <Link href="/caja/eliminaciones"><Boton variante="borde"><ShieldAlert size={16} /> Eliminaciones</Boton></Link> : null}
    </>
  );

  if (resultado) {
    const ok = resultado.estado === "CERRADA";
    return (
      <div className="max-w-xl mx-auto">
        <Tarjeta className="p-7 text-center aparecer">
          <p className="sello mx-auto">SESIÓN {String(resultado.sesionId).padStart(6, "0")}</p>
          <h1 className="font-display font-semibold text-2xl mt-4">{ok ? "Caja cerrada" : "Cierre registrado, falta validar"}</h1>
          <p className="text-ink-2 mt-2">Diferencia entre lo contado y lo esperado</p>
          <p className={`cifra text-[52px] mt-1 ${Math.abs(resultado.diferencia) > 5 ? "text-rojo" : "text-ok"}`}>{resultado.diferencia > 0 ? "+" : ""}{soles(resultado.diferencia)}</p>
          {!ok ? <p className="text-sm text-ink-2">La diferencia supera el umbral. Un administrador distinto a ti debe validar el cierre.</p> : null}
          <div className="flex justify-center gap-2 mt-6">
            {ok ? <Link href={`/caja/reporte/${resultado.sesionId}`}><Boton variante="petroleo">Ver reporte de cierre</Boton></Link> : null}
            <Boton variante="borde" onClick={() => setResultado(null)}>Volver</Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  if (!datos.sesion) {
    return (
      <div>
        <Encabezado titulo="Abrir caja" bajada="Cuenta el fondo por denominación; el sistema lo compara con lo que quedó en el último cierre.">{historial}</Encabezado>
        <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
          <div className="space-y-4">
            <Tarjeta titulo="Caja">
              <div className="px-5 pb-5 space-y-2">
                {datos.cajas.map((c) => (
                  <button key={c.id} disabled={!!c.ocupadaPor} onClick={() => setCajaId(c.id)}
                    className={`w-full text-left rounded-2xl border px-4 py-3 transition ${elegida?.id === c.id ? "border-petroleo bg-[#f1f8f6] ring-2 ring-petroleo/15" : "border-foil-2 hover:border-foil-3"} disabled:opacity-60`}>
                    <div className="flex items-center justify-between"><span className="font-semibold">{c.nombre}</span>{c.ocupadaPor ? <Insignia><Lock size={12} /> {c.ocupadaPor}</Insignia> : <Insignia tono="ok">Libre</Insignia>}</div>
                    <div className="text-[12.5px] text-ink-2 mt-1">Fondo del último cierre: {soles(c.fondoSugerido)}</div>
                  </button>
                ))}
              </div>
            </Tarjeta>
            <Tarjeta titulo="Turno">
              <div className="px-5 pb-5 grid grid-cols-2 gap-2">
                {TURNOS.map((t) => <button key={t} onClick={() => setTurno(t)} className={`h-10 rounded-xl text-sm font-semibold border ${turno === t ? "bg-petroleo text-white border-petroleo" : "border-foil-3 text-ink-2"}`}>{t[0] + t.slice(1).toLowerCase()}</button>)}
              </div>
            </Tarjeta>
          </div>
          <Tarjeta titulo="Fondo inicial" accion={elegida?.fondoSugerido ? <Boton tam="sm" variante="fantasma" onClick={() => setConteo({ "100": Math.floor(elegida.fondoSugerido / 100), "20": Math.floor((elegida.fondoSugerido % 100) / 20), "10": Math.floor((elegida.fondoSugerido % 20) / 10) })}>Precargar {soles(elegida.fondoSugerido)}</Boton> : null}>
            <div className="px-5 pb-5">
              <ContadorEfectivo conteo={conteo} alCambiar={setConteo} />
              {difiere ? (
                <div className="mt-4 rounded-2xl bg-ambar-claro p-4">
                  <p className="text-sm font-semibold text-[#8a5b00]">El fondo no coincide con el último cierre ({soles(elegida!.fondoSugerido)}).</p>
                  <Entrada className="mt-2" placeholder="Explica la diferencia" value={obs} onChange={(e) => setObs(e.target.value)} />
                </div>
              ) : null}
              {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
              <Boton variante="amor" tam="lg" className="w-full mt-5" cargando={ocupado} disabled={!elegida} onClick={abrir}>Abrir {elegida?.nombre ?? "caja"} con {soles(fondo)}</Boton>
            </div>
          </Tarjeta>
        </div>
      </div>
    );
  }

  const s = datos.sesion;
  const res = datos.resumen;
  const esperado = res?.esperado;
  const contado: Record<Medio, number> = { EFECTIVO: totalDe(conteo), YAPE: Number(virt.YAPE) || 0, PLIN: Number(virt.PLIN) || 0, TARJETA: Number(virt.TARJETA) || 0, TRANSFERENCIA: Number(virt.TRANSFERENCIA) || 0 };
  const difTotal = esperado ? r2((Object.keys(contado) as Medio[]).reduce((a, m) => a + contado[m] - esperado[m], 0)) : 0;
  const movEfectivo = (tipo: string) => (res?.movimientos ?? []).filter((m) => m.tipo === tipo && m.medio === "EFECTIVO").reduce((a, m) => a + m.monto, 0);
  const abrirCierre = () => {
    const e = datos.resumen?.esperado;
    setVirt({ YAPE: e ? e.YAPE.toFixed(2) : "", PLIN: e ? e.PLIN.toFixed(2) : "", TARJETA: e ? e.TARJETA.toFixed(2) : "", TRANSFERENCIA: e ? e.TRANSFERENCIA.toFixed(2) : "" });
    setCerrando(true); setConteo({}); setError(null);
  };

  if (s.estado === "EN_CIERRE") {
    return (
      <div className="max-w-xl mx-auto">
        <Tarjeta className="p-7">
          <h1 className="font-display font-semibold text-2xl">Tu cierre espera validación</h1>
          <p className="text-ink-2 mt-2">La diferencia del arqueo supera el umbral. Pide a un administrador que ingrese su usuario y clave.</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            <Campo etiqueta="Usuario del administrador"><Entrada value={val.login} onChange={(e) => setVal({ ...val, login: e.target.value })} /></Campo>
            <Campo etiqueta="Clave"><Entrada type="password" value={val.password} onChange={(e) => setVal({ ...val, password: e.target.value })} /></Campo>
          </div>
          <Campo etiqueta="Observación" className="mt-3"><Entrada value={val.observacion} onChange={(e) => setVal({ ...val, observacion: e.target.value })} placeholder="Qué explica la diferencia" /></Campo>
          {error ? <p className="text-sm text-rojo mt-3">{error}</p> : null}
          <Boton className="w-full mt-5" cargando={ocupado} onClick={() => validar(s.id)}>Validar cierre</Boton>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div>
      <Encabezado titulo={`${s.caja} · turno ${s.turno.toLowerCase()}`} bajada={`Abierta ${fechaHora(s.abiertaEn)} con ${soles(s.fondoInicial)} · ${datos.resumen?.tickets ?? 0} tickets emitidos`}>
        {historial}
        <Boton variante="amor" onClick={abrirCierre}>Cerrar caja</Boton>
      </Encabezado>
      {cerrando ? (
        <Tarjeta titulo="Cierre de caja" className="mb-6 aparecer" accion={<Boton tam="sm" variante="fantasma" onClick={() => setCerrando(false)}>Cancelar</Boton>}>
          <div className="px-5 pb-5">
            <p className="text-sm text-ink-2 mb-4">Cuenta el efectivo por denominación. Yape, Plin, tarjeta y transferencia ya vienen con lo registrado en el sistema: corrígelos solo si tus apps marcan otro monto. Revisa la diferencia antes de confirmar; después ya no se puede cambiar.</p>
            <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)] gap-6">
              <ContadorEfectivo conteo={conteo} alCambiar={setConteo} />
              <div className="space-y-3">
                {DIGITALES.map((m) => (
                  <Campo key={m} etiqueta={NOMBRE_MEDIO[m]} ayuda={esperado ? `Según el sistema: ${soles(esperado[m])}` : undefined}><Entrada inputMode="decimal" placeholder="0.00" value={virt[m]} onChange={(e) => setVirt({ ...virt, [m]: e.target.value.replace(",", ".") })} /></Campo>
                ))}
                <Campo etiqueta="Efectivo que queda como fondo" ayuda={`Se retira ${soles(Math.max(0, totalDe(conteo) - (Number(fondoSig) || 0)))}`}><Entrada inputMode="decimal" value={fondoSig} onChange={(e) => setFondoSig(e.target.value)} /></Campo>
                <Campo etiqueta="Observación (opcional)"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder={Math.abs(difTotal) > UMBRAL ? "Explica la diferencia" : undefined} /></Campo>
              </div>
            </div>
            {esperado ? (
              <div className="mt-5 overflow-x-auto rounded-2xl border border-foil-2">
                <table className="tabla">
                  <thead><tr><th>Medio</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th></tr></thead>
                  <tbody>{(Object.keys(NOMBRE_MEDIO) as Medio[]).map((m) => {
                    const d = r2(contado[m] - esperado[m]);
                    return <tr key={m}><td>{NOMBRE_MEDIO[m]}</td><td className="num">{soles(esperado[m])}</td><td className="num">{soles(contado[m])}</td><td className={`num font-semibold ${Math.abs(d) < 0.005 ? "text-ink-3" : d < 0 ? "text-rojo" : "text-ok"}`}>{d > 0 ? "+" : ""}{soles(d)}</td></tr>;
                  })}</tbody>
                </table>
                <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${Math.abs(difTotal) > UMBRAL ? "bg-rojo-claro" : "bg-ok-claro"}`}>
                  <span className="text-sm font-semibold">{Math.abs(difTotal) > UMBRAL ? `La diferencia supera S/ ${UMBRAL.toFixed(2)}: un administrador deberá validar el cierre.` : "La caja cuadra dentro del margen permitido."}</span>
                  <span className={`cifra text-[24px] ${Math.abs(difTotal) > UMBRAL ? "text-rojo" : "text-ok"}`}>{difTotal > 0 ? "+" : ""}{soles(difTotal)}</span>
                </div>
              </div>
            ) : null}
            {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
            <Boton variante="amor" tam="lg" className="w-full mt-5" cargando={ocupado} onClick={cerrar}>Confirmar y cerrar caja</Boton>
          </div>
        </Tarjeta>
      ) : null}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <Tarjeta titulo="Movimientos del turno">
          {datos.resumen?.movimientos.length ? (
            <table className="tabla">
              <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Medio</th><th className="num">Monto</th><th /></tr></thead>
              <tbody>{datos.resumen.movimientos.map((m) => (
                <tr key={m.id}><td>{fechaHora(m.fecha)}</td><td><Insignia tono={m.tipo === "INGRESO" ? "ok" : "ambar"}>{m.tipo === "INGRESO" ? "Ingreso" : "Egreso"}</Insignia></td><td>{m.concepto}</td><td>{m.medio}</td><td className="num font-semibold">{soles(m.monto)}</td>
                  <td className="w-10"><button onClick={() => { setBorrar(m); setMotivoBorrar(""); }} className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-rojo hover:bg-rojo-claro" aria-label={`Eliminar ${m.tipo === "INGRESO" ? "ingreso" : "egreso"} de ${soles(m.monto)}`} title="Eliminar"><Trash size={15} /></button></td></tr>
              ))}</tbody>
            </table>
          ) : <p className="px-5 pb-4 text-sm text-ink-3">Sin ingresos ni egresos manuales. Regístralos a la derecha: sencillo que recibes o gastos menores que pagas con la caja.</p>}
          {res ? (
            <div className="border-t border-foil px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-[15px]">Ventas del turno</h3>
                <span className="text-[12.5px] text-ink-3">{res.tickets} {res.tickets === 1 ? "ticket" : "tickets"}{res.anuladas ? ` · ${res.anuladas} anuladas` : ""} · se actualiza solo</span>
              </div>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-[14px]">
                {res.ventas.map((v) => (
                  <div key={v.medio} className="contents"><dt className={v.total ? "text-ink-2" : "text-ink-3"}>{NOMBRE_MEDIO[v.medio]}</dt><dd className={`text-right tabular-nums ${v.total ? "font-semibold" : "text-ink-3"}`}>{soles(v.total)}</dd></div>
                ))}
                <dt className="border-t border-foil pt-2 font-semibold">Total vendido</dt><dd className="border-t border-foil pt-2 text-right cifra text-[18px]">{soles(res.totalVentas)}</dd>
              </dl>
              <div className="mt-4 rounded-2xl bg-foil px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">Efectivo que debe haber en caja</span>
                  <span className="cifra text-[22px]">{soles(res.esperado.EFECTIVO)}</span>
                </div>
                <p className="text-[12.5px] text-ink-2 mt-1">
                  Fondo {soles(s.fondoInicial)} + ventas en efectivo {soles(res.ventas.find((v) => v.medio === "EFECTIVO")?.total ?? 0)}
                  {movEfectivo("INGRESO") ? ` + ingresos ${soles(movEfectivo("INGRESO"))}` : ""}{movEfectivo("EGRESO") ? ` − egresos ${soles(movEfectivo("EGRESO"))}` : ""}
                </p>
              </div>
            </div>
          ) : null}
        </Tarjeta>
        <Tarjeta titulo="Registrar ingreso o egreso">
          <div className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-foil">
              {(["INGRESO", "EGRESO"] as const).map((t) => <button key={t} onClick={() => setMov({ ...mov, tipo: t, concepto: "" })} className={`h-9 rounded-lg text-sm font-semibold ${mov.tipo === t ? "bg-papel shadow-sm" : "text-ink-2"}`}>{t === "INGRESO" ? "Ingreso" : "Egreso"}</button>)}
            </div>
            <Campo etiqueta="Concepto"><Selector value={mov.concepto} onChange={(e) => setMov({ ...mov, concepto: e.target.value })}><option value="">Elige un concepto</option>{datos.conceptos[mov.tipo].map((c) => <option key={c}>{c}</option>)}</Selector></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Monto"><Entrada inputMode="decimal" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value.replace(",", ".") })} placeholder="0.00" /></Campo>
              <Campo etiqueta="Medio"><Selector value={mov.medio} onChange={(e) => setMov({ ...mov, medio: e.target.value })}>{["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"].map((m) => <option key={m}>{m}</option>)}</Selector></Campo>
            </div>
            <Campo etiqueta="Comprobante (opcional)"><Entrada value={mov.comprobante} onChange={(e) => setMov({ ...mov, comprobante: e.target.value })} placeholder="B001-123" /></Campo>
            <Boton className="w-full" cargando={ocupado} disabled={!mov.concepto || !(Number(mov.monto) > 0)} onClick={registrarMov}>Registrar {mov.tipo === "INGRESO" ? "ingreso" : "egreso"}</Boton>
          </div>
        </Tarjeta>
      </div>
      <Modal abierto={!!borrar} alCerrar={() => setBorrar(null)} titulo={`Eliminar ${borrar?.tipo === "INGRESO" ? "ingreso" : "egreso"}`}>
        {borrar ? (
          <>
            <div className="rounded-2xl bg-foil px-4 py-3 flex items-center justify-between gap-3">
              <div><p className="font-semibold">{borrar.concepto}</p><p className="text-[13px] text-ink-2">{borrar.medio[0] + borrar.medio.slice(1).toLowerCase()}</p></div>
              <p className="cifra text-[22px]">{soles(borrar.monto)}</p>
            </div>
            <Campo etiqueta="Motivo de la eliminación" className="mt-4"><Entrada autoFocus value={motivoBorrar} onChange={(e) => setMotivoBorrar(e.target.value)} placeholder="Ej.: monto mal digitado, se registró dos veces" /></Campo>
            <p className="text-[13px] text-ink-2 mt-3">Se quitará del turno y del cálculo del cierre. Queda registrado con tu usuario, la hora y el motivo en el registro de eliminaciones que revisa el administrador.</p>
            <div className="flex justify-end gap-2 mt-5">
              <Boton variante="fantasma" onClick={() => setBorrar(null)}>Cancelar</Boton>
              <Boton variante="peligro" cargando={ocupado} disabled={motivoBorrar.trim().length < 5} onClick={eliminarMov}>Eliminar</Boton>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
