"use client";
import { useState } from "react";
import { api, soles } from "@/lib/cliente";
import { Boton, Campo, Entrada, EntradaNumero, Modal } from "@/components/ui";

export type EstadoEfectivo = { sistema: number; declarado: number; contado: number; diferencia: number; porRegularizar: number };
type Accion = "REPOSICION" | "CARGO_CAJERO" | "SOBRANTE_DEVUELTO" | "SOBRANTE_INGRESO" | "AJUSTE_CONTEO";

const ACCIONES: Record<Accion, { titulo: string; ayuda: string; boton: string; ejemplo: string }> = {
  REPOSICION: { titulo: "Dinero completado", ayuda: "El cajero u otra persona trajo el dinero que faltaba. Puede ser una parte.", boton: "Registrar dinero completado", ejemplo: "Ej.: el cajero repuso el vuelto mal dado" },
  CARGO_CAJERO: { titulo: "Cargo al cajero", ayuda: "El dinero no se recupera: queda como deuda a nombre del cajero hasta que lo pague.", boton: "Registrar cargo al cajero", ejemplo: "Ej.: vuelto mal dado, no se recuperó" },
  SOBRANTE_DEVUELTO: { titulo: "Sobrante devuelto al cliente", ayuda: "Se le dio vuelto de menos a un cliente y se le devolvió.", boton: "Registrar devolución", ejemplo: "Ej.: el cliente regresó por su vuelto" },
  SOBRANTE_INGRESO: { titulo: "Sobrante como ingreso de la botica", ayuda: "No se identificó al cliente: el sobrante queda para la botica.", boton: "Registrar ingreso", ejemplo: "Ej.: no se identificó a quién se le dio vuelto de menos" },
  AJUSTE_CONTEO: { titulo: "Recuento del efectivo", ayuda: "El cajero contó mal: escribe el efectivo que realmente hay.", boton: "Corregir efectivo", ejemplo: "Ej.: recontado con el cajero, había un billete de S/ 10 más" },
};

/**
 * Regularización del efectivo de un cierre (solo el administrador): dinero completado después, cargo al cajero,
 * sobrante devuelto o como ingreso, y recuento. Cada acción recalcula el cierre y queda en el historial.
 */
export function RegularizarEfectivo({ sesionId, efectivo, cajero, alTerminar }: { sesionId: number; efectivo: EstadoEfectivo; cajero: string; alTerminar: (m: string) => void }) {
  const [accion, setAccion] = useState<Accion | null>(null);
  const [monto, setMonto] = useState("");
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pend = efectivo.porRegularizar;
  const faltante = pend < -0.004, sobrante = pend > 0.004;

  const abrir = (a: Accion) => {
    setAccion(a); setError(null); setComentario("");
    setMonto(a === "AJUSTE_CONTEO" ? efectivo.contado.toFixed(2) : Math.abs(pend).toFixed(2));
  };
  const guardar = async () => {
    if (!accion) return;
    setOcupado(true); setError(null);
    try {
      const cuerpo = accion === "AJUSTE_CONTEO" ? { accion, efectivoContado: Number(monto), comentario } : { accion, monto: Number(monto), comentario };
      await api(`/api/caja/sesiones/${sesionId}/efectivo`, { cuerpo });
      setAccion(null);
      alTerminar(accion === "CARGO_CAJERO" ? `Cargo de ${soles(Number(monto))} registrado a ${cajero}.` : "Efectivo regularizado; el cierre se recalculó.");
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  const tope = Math.abs(pend);
  const valido = comentario.trim().length >= 5 && monto.trim() !== "" && (accion === "AJUSTE_CONTEO" ? Number(monto) >= 0 : Number(monto) > 0 && Number(monto) <= tope + 0.005);

  return (
    <section className="no-imprimir mt-8 rounded-2xl border border-foil-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-[15px]">Regularizar el efectivo</h2>
          <p className="text-[13px] text-ink-2 mt-0.5">Cuando el efectivo no cuadra (p. ej. un vuelto mal dado), registra qué pasó con la diferencia.</p>
        </div>
        <div className={`rounded-xl px-3 py-2 text-right ${faltante ? "bg-rojo-claro" : sobrante ? "bg-ok-claro" : "bg-foil"}`}>
          <p className="text-[12px] font-semibold text-ink-2">{faltante ? "Faltante por regularizar" : sobrante ? "Sobrante por regularizar" : "Efectivo"}</p>
          <p className={`cifra text-[20px] ${faltante ? "text-rojo" : sobrante ? "text-ok" : ""}`}>{faltante || sobrante ? soles(Math.abs(pend)) : "Regularizado"}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[13px]">
        {[["Sistema", efectivo.sistema], ["Declaró el cajero", efectivo.declarado], ["Efectivo actual", efectivo.contado], ["Diferencia", efectivo.diferencia]].map(([t, v]) => (
          <div key={t as string} className="rounded-xl bg-foil px-3 py-2"><dt className="text-ink-2 text-[12px]">{t}</dt><dd className="font-semibold tabular-nums">{soles(v as number)}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 mt-3">
        {faltante ? <><Boton tam="sm" onClick={() => abrir("REPOSICION")}>Dinero completado</Boton><Boton tam="sm" variante="borde" onClick={() => abrir("CARGO_CAJERO")}>Cargo al cajero</Boton></> : null}
        {sobrante ? <><Boton tam="sm" onClick={() => abrir("SOBRANTE_DEVUELTO")}>Devuelto al cliente</Boton><Boton tam="sm" variante="borde" onClick={() => abrir("SOBRANTE_INGRESO")}>Ingreso de la botica</Boton></> : null}
        <Boton tam="sm" variante="fantasma" onClick={() => abrir("AJUSTE_CONTEO")}>Recuento del efectivo</Boton>
      </div>

      <Modal abierto={!!accion} alCerrar={() => setAccion(null)} titulo={accion ? ACCIONES[accion].titulo : ""}>
        {accion ? (
          <>
            <p className="text-[13.5px] text-ink-2">{ACCIONES[accion].ayuda}{accion === "CARGO_CAJERO" ? ` Cajero: ${cajero}.` : ""}</p>
            <Campo etiqueta={accion === "AJUSTE_CONTEO" ? "Efectivo real en caja" : "Monto"} className="mt-4"
              ayuda={accion === "AJUSTE_CONTEO" ? `Hoy figura ${soles(efectivo.contado)}; el sistema espera ${soles(efectivo.sistema)}` : `Por regularizar: ${soles(tope)}`}>
              <EntradaNumero autoFocus inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(",", "."))} placeholder="0.00" className="font-semibold" />
            </Campo>
            <Campo etiqueta="Qué pasó" className="mt-3"><Entrada value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={250} placeholder={ACCIONES[accion].ejemplo} /></Campo>
            {error ? <p className="text-sm text-rojo mt-3" role="alert">{error}</p> : null}
            <div className="flex justify-end gap-2 mt-5">
              <Boton variante="fantasma" onClick={() => setAccion(null)}>Cancelar</Boton>
              <Boton cargando={ocupado} disabled={!valido} onClick={guardar}>{ACCIONES[accion].boton}</Boton>
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  );
}
