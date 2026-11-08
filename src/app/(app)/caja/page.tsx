"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock, History, Trash, ShieldAlert } from "lucide-react";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Campo, Entrada, EntradaNumero, Encabezado, Cargando, Insignia, Modal, Selector, Tarjeta, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";

type Estado = {
  sesion: { id: number; cajaId: number; caja: string; turno: string; abiertaEn: string; estado: string; montoApertura: number } | null;
  caja: { nombre: string; ocupadaPor: string | null };
  resumen: {
    tickets: number; movimientos: { id: number; tipo: string; concepto: string; medio: string; monto: number; fecha: string }[];
    ventas: { medio: Medio; total: number }[]; totalVentas: number; anuladas: number; esperado: Record<Medio, number>;
    virtuales: Virtual[];
  } | null;
  conceptos: { INGRESO: string[]; EGRESO: string[] };
};
type Virtual = { clave: string; origen: string; referencia: string; medio: Medio; monto: number; fecha: string };
type Resultado = { sesionId: number; estado: string; diferencia: number; efectivo: { sistema: number; declarado: number }; virtual: { sistema: number; declarado: number; sinConfirmar: number } };
type Medio = "EFECTIVO" | "YAPE" | "PLIN" | "TARJETA" | "TRANSFERENCIA";
const TURNOS = ["MAÑANA", "TARDE", "NOCHE", "COMPLETO"] as const;
const NOMBRE_MEDIO: Record<Medio, string> = { EFECTIVO: "Efectivo", YAPE: "Yape", PLIN: "Plin", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const conSigno = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${soles(Math.abs(n))}`;
const tonoDif = (n: number) => (n < -0.004 ? "text-rojo" : n > 0.004 ? "text-ok" : "");

export default function Caja() {
  const u = useUsuario();
  const avisar = useAviso();
  const { datos, recargar, cargando } = useDatos<Estado>("/api/caja");
  const [monto, setMonto] = useState("");
  const [turno, setTurno] = useState<(typeof TURNOS)[number]>("MAÑANA");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mov, setMov] = useState({ tipo: "EGRESO" as "INGRESO" | "EGRESO", concepto: "", medio: "EFECTIVO", monto: "", comprobante: "" });
  const [cerrando, setCerrando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [efectivo, setEfectivo] = useState("");
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
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
  const abrir = async () => {
    setOcupado(true); setError(null);
    try {
      await api("/api/caja/abrir", { cuerpo: { turno, monto: Number(monto) || 0 } });
      avisar("ok", `Caja abierta con ${soles(Number(monto) || 0)} en efectivo.`);
      setMonto(""); recargar();
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
      const r = await api<Resultado>("/api/caja/cerrar", { cuerpo: { efectivo: Number(efectivo), confirmados: [...confirmados], observacion: obs || undefined } });
      setResultado(r); setCerrando(false); setObs(""); setEfectivo(""); setConfirmados(new Set()); recargar();
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
      {u.roles.includes("ADMIN") ? <Link href="/caja/eliminaciones"><Boton variante="borde"><ShieldAlert size={16} /> Eliminaciones</Boton></Link> : null}
    </>
  );

  if (resultado) {
    const d = resultado.diferencia;
    const fila = (t: string, sistema: number, declarado: number, extra?: string) => (
      <tr><td>{t}{extra ? <span className="block text-[12px] text-rojo">{extra}</span> : null}</td><td className="num">{soles(sistema)}</td><td className="num font-semibold">{soles(declarado)}</td><td className={`num font-semibold ${tonoDif(declarado - sistema)}`}>{conSigno(declarado - sistema)}</td></tr>
    );
    return (
      <div className="max-w-xl mx-auto">
        <Tarjeta className="p-7 aparecer">
          <div className="text-center">
            <p className="sello mx-auto">SESIÓN {String(resultado.sesionId).padStart(6, "0")}</p>
            <h1 className="font-display font-semibold text-2xl mt-4">Caja cerrada</h1>
            <p className="text-ink-2 mt-2">{Math.abs(d) < 0.005 ? "Lo declarado coincide con el sistema" : d < 0 ? "Faltante respecto a lo registrado en el sistema" : "Sobrante respecto a lo registrado en el sistema"}</p>
            <p className={`cifra text-[52px] mt-1 ${Math.abs(d) < 0.005 ? "text-ok" : tonoDif(d)}`}>{conSigno(d)}</p>
          </div>
          <table className="tabla mt-4">
            <thead><tr><th /><th className="num">Sistema</th><th className="num">Declarado</th><th className="num">Diferencia</th></tr></thead>
            <tbody>
              {fila("Saldo final efectivo", resultado.efectivo.sistema, resultado.efectivo.declarado)}
              {fila("Saldo final virtual", resultado.virtual.sistema, resultado.virtual.declarado, resultado.virtual.sinConfirmar ? `${resultado.virtual.sinConfirmar} ${resultado.virtual.sinConfirmar === 1 ? "pago sin confirmar" : "pagos sin confirmar"}` : undefined)}
            </tbody>
          </table>
          <div className="flex justify-center gap-2 mt-6">
            <Link href={`/caja/reporte/${resultado.sesionId}`}><Boton variante="petroleo">Ver reporte de cierre</Boton></Link>
            <Boton variante="borde" onClick={() => setResultado(null)}>Volver</Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  if (!datos.sesion) {
    const ocupadaPor = datos.caja.ocupadaPor;
    return (
      <div>
        <Encabezado titulo="Abrir caja" bajada="Elige tu turno y escribe con cuánto efectivo empiezas.">{historial}</Encabezado>
        <Tarjeta className="max-w-lg p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-[16px]">{datos.caja.nombre}</span>
            {ocupadaPor ? <Insignia><Lock size={12} /> Abierta por {ocupadaPor}</Insignia> : <Insignia tono="ok">Libre</Insignia>}
          </div>
          {ocupadaPor ? <p className="text-sm text-ink-2 mt-3">{ocupadaPor} tiene la caja abierta. Debe cerrarla antes de que abras tu turno.</p> : (
            <>
              <p className="text-[12.5px] font-semibold text-ink-2 mt-5 mb-1.5">Turno</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TURNOS.map((t) => <button key={t} onClick={() => setTurno(t)} aria-pressed={turno === t} className={`h-10 rounded-xl text-sm font-semibold border ${turno === t ? "bg-petroleo text-white border-petroleo" : "border-foil-3 text-ink-2"}`}>{t[0] + t.slice(1).toLowerCase()}</button>)}
              </div>
              <Campo etiqueta="Efectivo con que empiezas" ayuda="Escribe el total en soles; no hace falta separarlo por billetes y monedas" className="mt-4">
                <EntradaNumero inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" onKeyDown={(e) => e.key === "Enter" && abrir()} />
              </Campo>
              {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
              <Boton variante="amor" tam="lg" className="w-full mt-5" cargando={ocupado} onClick={abrir}>Abrir caja con {soles(Number(monto) || 0)}</Boton>
            </>
          )}
        </Tarjeta>
      </div>
    );
  }

  const s = datos.sesion;
  const res = datos.resumen;
  const virtuales = res?.virtuales ?? [];
  const virtualConfirmado = r2(virtuales.filter((v) => confirmados.has(v.clave)).reduce((a, v) => a + v.monto, 0));
  const sinConfirmar = virtuales.length - virtuales.filter((v) => confirmados.has(v.clave)).length;
  const alternar = (clave: string) => setConfirmados((c) => { const n = new Set(c); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  const todos = virtuales.length > 0 && sinConfirmar === 0;
  const movEfectivo = (tipo: string) => (res?.movimientos ?? []).filter((m) => m.tipo === tipo && m.medio === "EFECTIVO").reduce((a, m) => a + m.monto, 0);
  const abrirCierre = () => { setCerrando(true); setError(null); setEfectivo(""); setConfirmados(new Set()); };

  if (s.estado === "EN_CIERRE") {
    return (
      <div className="max-w-xl mx-auto">
        <Tarjeta className="p-7">
          <h1 className="font-display font-semibold text-2xl">Tu cierre espera validación</h1>
          <p className="text-ink-2 mt-2">La diferencia del cierre de caja supera el umbral. Pide a un administrador que ingrese su usuario y clave.</p>
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
      <Encabezado titulo={`${s.caja} · turno ${s.turno.toLowerCase()}`} bajada={`Abierta ${fechaHora(s.abiertaEn)} con ${soles(s.montoApertura)} en efectivo · ${datos.resumen?.tickets ?? 0} tickets emitidos`}>
        {historial}
        <Boton variante="amor" onClick={abrirCierre}>Cerrar caja</Boton>
      </Encabezado>
      {cerrando ? (
        <Tarjeta titulo="Cierre de caja" className="mb-6 aparecer" accion={<Boton tam="sm" variante="fantasma" onClick={() => setCerrando(false)}>Cancelar</Boton>}>
          <div className="px-5 pb-5">
            <p className="text-sm text-ink-2 mb-4">Escribe el efectivo que tienes en caja y marca cada pago virtual que sí te llegó. El sistema compara con lo registrado y calcula la diferencia.</p>
            <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
              <div className="rounded-2xl border border-foil-2 p-4">
                <p className="text-[12px] font-semibold text-ink-3 uppercase tracking-wide">Paso 1</p>
                <Campo etiqueta="Efectivo en caja" ayuda="Cuenta todo el efectivo del cajón, incluida la apertura, y escribe el total" className="mt-1">
                  <EntradaNumero inputMode="decimal" autoFocus value={efectivo} onChange={(e) => setEfectivo(e.target.value)} placeholder="0.00" className="h-12 text-[20px] font-semibold" />
                </Campo>
              </div>
              <div className="rounded-2xl border border-foil-2">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                  <div>
                    <p className="text-[12px] font-semibold text-ink-3 uppercase tracking-wide">Paso 2</p>
                    <p className="font-semibold text-[14px]">Valida los pagos virtuales</p>
                  </div>
                  {virtuales.length ? <Boton tam="sm" variante="borde" onClick={() => setConfirmados(todos ? new Set() : new Set(virtuales.map((v) => v.clave)))}>{todos ? "Desmarcar todos" : "Marcar todos como recibidos"}</Boton> : null}
                </div>
                {virtuales.length ? (
                  <div className="max-h-72 overflow-y-auto mt-2">
                    <table className="tabla">
                      <thead><tr><th className="w-10"><span className="sr-only">Recibido</span></th><th>Hora</th><th>Comprobante</th><th>Medio</th><th className="num">Monto</th></tr></thead>
                      <tbody>{virtuales.map((v) => {
                        const ok = confirmados.has(v.clave);
                        return (
                          <tr key={v.clave} onClick={() => alternar(v.clave)} className={`cursor-pointer ${ok ? "" : "text-ink-2"}`}>
                            <td><input type="checkbox" className="size-4 accent-[var(--color-ok)]" checked={ok} onChange={() => alternar(v.clave)} onClick={(e) => e.stopPropagation()} aria-label={`${v.medio} ${v.referencia} ${soles(v.monto)} recibido`} /></td>
                            <td className="tabular-nums">{new Date(v.fecha).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</td>
                            <td>{v.referencia}{v.origen === "Ingreso" ? <span className="text-ink-3"> · ingreso</span> : null}</td>
                            <td>{NOMBRE_MEDIO[v.medio]}</td>
                            <td className="num font-semibold">{soles(v.monto)}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                ) : <p className="px-4 py-4 text-sm text-ink-3">No hubo pagos virtuales en este turno.</p>}
              </div>
            </div>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <div className="rounded-2xl bg-foil px-4 py-3"><p className="text-[12.5px] text-ink-2 font-semibold">Saldo final efectivo</p><p className="cifra text-[24px]">{soles(Number(efectivo) || 0)}</p></div>
              <div className="rounded-2xl bg-foil px-4 py-3"><p className="text-[12.5px] text-ink-2 font-semibold">Saldo final virtual</p><p className="cifra text-[24px]">{soles(virtualConfirmado)}</p>
                {sinConfirmar ? <p className="text-[12.5px] text-rojo">{sinConfirmar} {sinConfirmar === 1 ? "pago sin confirmar contará" : "pagos sin confirmar contarán"} como faltante</p> : null}</div>
            </div>
            <Campo etiqueta="Observación (opcional)" className="mt-4"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} maxLength={250} placeholder="Ej.: un Yape no llegó, se avisó al cliente" /></Campo>
            {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
            <Boton variante="amor" tam="lg" className="w-full mt-5" cargando={ocupado} disabled={efectivo.trim() === ""} onClick={cerrar}>Confirmar y cerrar caja</Boton>
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
                  Apertura {soles(s.montoApertura)} + ventas en efectivo {soles(res.ventas.find((v) => v.medio === "EFECTIVO")?.total ?? 0)}
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
              <Campo etiqueta="Monto"><EntradaNumero inputMode="decimal" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value.replace(",", ".") })} placeholder="0.00" /></Campo>
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
