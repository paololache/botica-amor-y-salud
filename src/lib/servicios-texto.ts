export type TipoServicio = "PRESION" | "GLUCOSA" | "INYECTABLE" | "TEMPERATURA" | "ANTROPOMETRIA" | "OTRO";
export const VIAS_TEXTO: Record<string, string> = { IM: "intramuscular", SC: "subcutánea", ID: "intradérmica", IV: "intravenosa" };

/** Resultado en palabras para el historial y la tabla. */
export function textoResultado(tipo: TipoServicio, r: Record<string, number | string | null> | null) {
  if (!r) return "—";
  if (tipo === "PRESION") return `${r.sistolica}/${r.diastolica} mmHg${r.pulso ? ` · pulso ${r.pulso}` : ""}`;
  if (tipo === "GLUCOSA") return `${r.valor} mg/dL (${String(r.condicion).toLowerCase()})`;
  if (tipo === "TEMPERATURA") return `${r.valor} °C`;
  if (tipo === "ANTROPOMETRIA") return `${r.peso} kg · ${r.talla} cm · IMC ${r.imc}`;
  if (tipo === "INYECTABLE") return r.via ? `Vía ${VIAS_TEXTO[String(r.via)] ?? r.via}` : "Aplicado";
  return "—";
}

