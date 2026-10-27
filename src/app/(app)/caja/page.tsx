"use client";
import Link from "next/link";
import { useState } from "react";
import { Lock, History } from "lucide-react";
import { api, useDatos, soles, fechaHora } from "@/lib/cliente";
import { Boton, Campo, Entrada, Encabezado, Cargando, Insignia, Selector, Tarjeta, useAviso, Vacio } from "@/components/ui";
import { ContadorEfectivo, totalDe } from "@/components/contador";
import { useUsuario } from "@/components/shell";

type Estado = {
  sesion: { id: number; cajaId: number; caja: string; turno: string; abiertaEn: string; estado: string; fondoInicial: number } | null;
  cajas: { id: number; nombre: string; ocupadaPor: string | null; fondoSugerido: number }[];
  resumen: { tickets: number; movimientos: { id: number; tipo: string; concepto: string; medio: string; monto: number; fecha: string }[] } | null;
  conceptos: { INGRESO: string[]; EGRESO: string[] };
};
const TURNOS = ["MAÑANA", "TARDE", "NOCHE", "COMPLETO"] as const;

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

  const validar = async (sesionId: number) => {
    setOcupado(true); setError(null);
    try {
      await api("/api/caja/validar", { cuerpo: { sesionId, ...val } });
      avisar("ok", "Cierre validado."); setResultado((r) => (r ? { ...r, estado: "CERRADA" } : r)); recargar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };

  const historial = <Link href="/caja/historial"><Boton variante="borde"><History size={16} /> Cierres anteriores</Boton></Link>;

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
        <Boton variante="amor" onClick={() => { setCerrando(true); setConteo({}); setError(null); }}>Cerrar caja</Boton>
      </Encabezado>
      {cerrando ? (
        <Tarjeta titulo="Cierre ciego" className="mb-6 aparecer" accion={<Boton tam="sm" variante="fantasma" onClick={() => setCerrando(false)}>Cancelar</Boton>}>
          <div className="px-5 pb-5">
            <p className="text-sm text-ink-2 mb-4">Cuenta el efectivo y escribe lo que marcan tus apps. No verás el monto esperado: el sistema calcula la diferencia al confirmar, y el conteo ya no se puede cambiar.</p>
            <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)] gap-6">
              <ContadorEfectivo conteo={conteo} alCambiar={setConteo} />
              <div className="space-y-3">
                {(["YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"] as const).map((m) => (
                  <Campo key={m} etiqueta={m[0] + m.slice(1).toLowerCase()}><Entrada inputMode="decimal" placeholder="0.00" value={virt[m]} onChange={(e) => setVirt({ ...virt, [m]: e.target.value.replace(",", ".") })} /></Campo>
                ))}
                <Campo etiqueta="Efectivo que queda como fondo" ayuda={`Se retira ${soles(Math.max(0, totalDe(conteo) - (Number(fondoSig) || 0)))}`}><Entrada inputMode="decimal" value={fondoSig} onChange={(e) => setFondoSig(e.target.value)} /></Campo>
                <Campo etiqueta="Observación (opcional)"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
              </div>
            </div>
            {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
            <Boton variante="amor" tam="lg" className="w-full mt-5" cargando={ocupado} onClick={cerrar}>Confirmar conteo y cerrar</Boton>
          </div>
        </Tarjeta>
      ) : null}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <Tarjeta titulo="Movimientos del turno">
          {datos.resumen?.movimientos.length ? (
            <table className="tabla">
              <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Medio</th><th className="num">Monto</th></tr></thead>
              <tbody>{datos.resumen.movimientos.map((m) => (
                <tr key={m.id}><td>{fechaHora(m.fecha)}</td><td><Insignia tono={m.tipo === "INGRESO" ? "ok" : "ambar"}>{m.tipo === "INGRESO" ? "Ingreso" : "Egreso"}</Insignia></td><td>{m.concepto}</td><td>{m.medio}</td><td className="num font-semibold">{soles(m.monto)}</td></tr>
              ))}</tbody>
            </table>
          ) : <Vacio titulo="Sin ingresos ni egresos">Registra aquí el sencillo que recibes o los gastos menores que pagas con la caja.</Vacio>}
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
            {u.rol === "ADMIN" ? <p className="text-[12px] text-ink-3">Como administrador también puedes ver el esperado en el reporte de cierre.</p> : null}
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}
