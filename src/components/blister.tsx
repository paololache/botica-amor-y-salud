"use client";

export type Conteo = { tipo: string; nombre: string; total: number; criticas: number; grupo: string };

/** Las alertas como un blíster: cada alvéolo es un tipo de alerta; vacío, el alvéolo queda reventado. */
export function Blister({ conteos, seleccion, alElegir }: { conteos: Conteo[]; seleccion: string | null; alElegir: (tipo: string | null) => void }) {
  const orden = ["AGOTADO", "VENCIDO", "POR_VENCER", "POR_TERMINARSE", "DIF_CAJA", "CPE_PENDIENTE", "BAJO_MINIMO", "CAJA_ABIERTA", "SALIDA_PENDIENTE", "CAMPANA_POR_VENCER", "SIN_ROTACION"];
  const lista = [...conteos].sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo));
  const pendientes = lista.reduce((s, c) => s + c.total, 0);
  return (
    <div className="blister lamina">
      <div className="alveolos">
        {lista.map((c, i) => {
          const vacio = c.total === 0;
          const sev = c.criticas > 0 ? "CRITICA" : c.tipo === "SIN_ROTACION" || c.tipo === "CAMPANA_POR_VENCER" || c.tipo === "SALIDA_PENDIENTE" ? "INFO" : "ALTA";
          return (
            <button key={c.tipo} type="button" className="alveolo" style={{ ["--i" as string]: i }} data-vacio={vacio ? "1" : "0"} data-sev={vacio ? undefined : sev}
              data-sel={seleccion === c.tipo ? "1" : "0"} disabled={vacio} aria-pressed={seleccion === c.tipo}
              aria-label={`${c.nombre}: ${c.total}${c.criticas ? `, ${c.criticas} críticas` : ""}`}
              onClick={() => alElegir(seleccion === c.tipo ? null : c.tipo)}>
              <span className="n">{c.total}</span>
              <span className="l">{c.nombre}</span>
            </button>
          );
        })}
      </div>
      <div className="relative z-10 mt-6 flex items-center justify-between text-[12.5px] text-ink-2">
        <span className="sello">{pendientes} PENDIENTES</span>
        <span>{seleccion ? "Toca el alvéolo otra vez para ver todo" : "Toca un alvéolo para filtrar"}</span>
      </div>
    </div>
  );
}
