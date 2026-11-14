import { inflateRawSync } from "node:zlib";

/**
 * Lector mínimo de .xlsx (solo servidor/scripts): un .xlsx es un ZIP con XML. Devuelve las filas de la primera hoja
 * como texto, respetando las columnas vacías. Sin dependencias externas.
 */
export function leerXlsx(buf: Buffer): { hoja: string; filas: (string | null)[][] } {
  const archivos = descomprimir(buf);
  const texto = (n: string) => { const b = archivos.get(n); if (!b) throw new Error(`El archivo no es un Excel válido (falta ${n}).`); return b.toString("utf8"); };
  const compartidos: string[] = [];
  if (archivos.has("xl/sharedStrings.xml")) {
    for (const si of texto("xl/sharedStrings.xml").match(/<si\b[\s\S]*?<\/si>/g) ?? []) compartidos.push(textos(si));
  }
  const libro = texto("xl/workbook.xml");
  const hojaXml = libro.match(/<sheet\b[^>]*>/)?.[0] ?? "";
  const nombre = decodificar(atributo(hojaXml, "name") ?? "Hoja1");
  const rid = atributo(hojaXml, "r:id");
  const rels = texto("xl/_rels/workbook.xml.rels");
  const rel = (rels.match(/<Relationship\b[^>]*>/g) ?? []).find((r) => atributo(r, "Id") === rid);
  let destino = rel ? atributo(rel, "Target") ?? "worksheets/sheet1.xml" : "worksheets/sheet1.xml";
  destino = destino.startsWith("/") ? destino.slice(1) : `xl/${destino}`;
  const filas: (string | null)[][] = [];
  for (const fila of texto(destino).match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const valores: (string | null)[] = [];
    for (const c of fila.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const apertura = c.match(/<c\b[^>]*>/)?.[0] ?? c;
      const ref = atributo(apertura, "r") ?? "";
      const col = columna(ref.replace(/\d+/g, ""));
      const tipo = atributo(apertura, "t");
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valor: string | null = null;
      if (tipo === "s" && v !== undefined) valor = compartidos[Number(v)] ?? null;
      else if (tipo === "inlineStr") valor = textos(c);
      else if (v !== undefined) valor = decodificar(v);
      while (valores.length < col) valores.push(null);
      valores[col] = valor;
    }
    filas.push(valores);
  }
  return { hoja: nombre, filas };
}

const atributo = (tag: string, nombre: string) => tag.match(new RegExp(`\\s${nombre.replace(":", "\\:")}="([^"]*)"`))?.[1];
const textos = (xml: string) => decodificar((xml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<t\b[^>]*>|<\/t>/g, "")).join(""));
function columna(letras: string) { let n = 0; for (const ch of letras) n = n * 26 + ch.charCodeAt(0) - 64; return Math.max(0, n - 1); }
function decodificar(t: string) {
  return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}

/** ZIP: directorio central al final del archivo; cada entrada va guardada o comprimida con deflate. */
function descomprimir(buf: Buffer) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un Excel (.xlsx) válido.");
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const out = new Map<string, Buffer>();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("El Excel está dañado.");
    const metodo = buf.readUInt16LE(p + 10);
    const tam = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28), largoExtra = buf.readUInt16LE(p + 30), largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoNombre).toString("utf8");
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(inicio, inicio + tam);
    out.set(nombre, metodo === 8 ? inflateRawSync(datos) : Buffer.from(datos));
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return out;
}
