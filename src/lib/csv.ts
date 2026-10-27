"use client";
/** Descarga CSV con BOM para que Excel respete tildes y ñ. */
export function descargarCsv(nombre: string, cabecera: string[], filas: unknown[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [cabecera, ...filas].map((f) => f.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
