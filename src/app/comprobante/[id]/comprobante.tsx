"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo } from "react";
import { FileText, Printer, ReceiptText, X } from "lucide-react";
import { useDatos, vence } from "@/lib/cliente";
import { importeEnLetras } from "@/lib/letras";

type Detalle = {
  venta: {
    id: number; serie: string; numero: number; fecha: string; tipoComprobante: "BOLETA" | "FACTURA" | "NOTA_VENTA"; subtotal: number; igv: number; descuento: number; total: number;
    estado: string; cpeEstado: string; receta: { medico: string; cmp: string; numero: string } | null;
  };
  items: { producto: string; presentacion: string; lote: string; vencimiento: string; cantidad: number; precio: number; subtotal: number }[];
  pagos: { medio: string; monto: number }[];
  cliente: { tipoDoc: string; numero: string; nombre: string } | null;
  vendedor: string | null;
  empresa: { razonSocial: string; nombreComercial: string; ruc: string; direccion: string; telefono: string };
  sunatModo: string;
};

const TITULO = { BOLETA: "Boleta de venta electrónica", FACTURA: "Factura electrónica", NOTA_VENTA: "Nota de venta" } as const;
const MEDIO: Record<string, string> = { EFECTIVO: "Efectivo", YAPE: "Yape", PLIN: "Plin", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };

const m2 = (n: number) => Number(n).toFixed(2);
const cant = (n: number) => String(Number(Number(n).toFixed(3)));
const fecha = (f: string) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(f));
const hora = (f: string) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(f));

/** Una línea por producto y presentación: la venta guarda una fila por lote (FEFO), el comprobante las agrupa. */
function agrupar(items: Detalle["items"]) {
  const out: { descripcion: string; cantidad: number; precio: number; importe: number; lotes: string[] }[] = [];
  for (const it of items) {
    const descripcion = `${it.producto} · ${it.presentacion}`;
    const x = out.find((o) => o.descripcion === descripcion && o.precio === it.precio);
    const lote = `${it.lote} (V. ${vence(it.vencimiento)})`;
    if (x) { x.cantidad += Number(it.cantidad); x.importe += Number(it.subtotal); if (!x.lotes.includes(lote)) x.lotes.push(lote); }
    else out.push({ descripcion, cantidad: Number(it.cantidad), precio: Number(it.precio), importe: Number(it.subtotal), lotes: [lote] });
  }
  return out;
}

function notas(d: Detalle) {
  const t = d.venta.tipoComprobante;
  if (t === "NOTA_VENTA") return ["Documento de control interno. No es un comprobante de pago."];
  const out = [`Representación impresa de la ${TITULO[t].toLowerCase()}.`, `Estado SUNAT: ${d.venta.cpeEstado === "ACEPTADO" ? "aceptado" : "pendiente de envío"}.`];
  if (d.sunatModo === "simulado") out.push("Emitido en modo de prueba: sin validez tributaria.");
  return out;
}

export function Comprobante({ id, formato, imprimir }: { id: number; formato: "ticket" | "a4"; imprimir: boolean }) {
  const { datos: d, error } = useDatos<Detalle>(`/api/ventas/${id}`);
  const lineas = useMemo(() => (d ? agrupar(d.items) : []), [d]);

  useEffect(() => {
    if (!d) return;
    document.title = `${d.venta.serie}-${String(d.venta.numero).padStart(8, "0")}`;
    if (!imprimir) return;
    // La pestaña queda abierta después de imprimir o cancelar, para revisar el comprobante.
    const h = setTimeout(() => window.print(), 300);
    return () => clearTimeout(h);
  }, [d, imprimir]);

  const pagina = formato === "ticket" ? "@page { size: 80mm auto; margin: 0; }" : "@page { size: A4; margin: 0; }";

  return (
    <div className="min-h-dvh bg-foil py-6 print:bg-white print:p-0">
      <style>{pagina}</style>
      <div className="no-imprimir mx-auto mb-5 flex max-w-[210mm] flex-wrap items-center justify-center gap-2 px-4">
        <Link replace href={`/comprobante/${id}?formato=ticket`} className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13.5px] font-semibold ${formato === "ticket" ? "border-vino bg-vino text-white" : "border-foil-3 bg-papel text-ink-2"}`}><ReceiptText size={16} /> Ticket 80 mm</Link>
        <Link replace href={`/comprobante/${id}?formato=a4`} className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13.5px] font-semibold ${formato === "a4" ? "border-vino bg-vino text-white" : "border-foil-3 bg-papel text-ink-2"}`}><FileText size={16} /> A4</Link>
        <button onClick={() => window.print()} disabled={!d} className="inline-flex h-9 items-center gap-2 rounded-xl bg-amor px-4 text-[13.5px] font-semibold text-white hover:bg-amor-2 disabled:opacity-50"><Printer size={16} /> Imprimir</button>
        <button onClick={() => window.close()} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13.5px] font-semibold text-ink-2 hover:bg-foil-2"><X size={16} /> Cerrar</button>
      </div>
      {error ? <p className="text-center text-rojo">{error}</p> : !d ? <p className="text-center text-ink-3">Cargando comprobante…</p>
        : formato === "ticket" ? <Ticket d={d} lineas={lineas} /> : <HojaA4 d={d} lineas={lineas} />}
    </div>
  );
}

type Lineas = ReturnType<typeof agrupar>;

function Ticket({ d, lineas }: { d: Detalle; lineas: Lineas }) {
  const v = d.venta;
  const linea = "border-t border-dashed border-black/60 my-2";
  return (
    <article className="relative mx-auto w-[80mm] bg-white px-[4mm] py-[5mm] text-[11.5px] leading-snug text-black shadow-lg print:shadow-none">
      {v.estado === "ANULADA" ? <Anulado /> : null}
      <header className="text-center">
        <p className="text-[14px] font-bold uppercase">{d.empresa.nombreComercial}</p>
        <p>{d.empresa.razonSocial}</p>
        {d.empresa.ruc ? <p>RUC {d.empresa.ruc}</p> : null}
        <p>{d.empresa.direccion}</p>
        {d.empresa.telefono ? <p>Tel. {d.empresa.telefono}</p> : null}
      </header>
      <div className={linea} />
      <div className="text-center">
        <p className="font-bold uppercase">{TITULO[v.tipoComprobante]}</p>
        <p className="text-[13px] font-bold">{v.serie}-{String(v.numero).padStart(8, "0")}</p>
      </div>
      <div className={linea} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2">
        <dt>Fecha:</dt><dd>{fecha(v.fecha)} {hora(v.fecha)}</dd>
        <dt>Cliente:</dt><dd className="uppercase">{d.cliente?.nombre ?? "Clientes varios"}</dd>
        {d.cliente ? <><dt>{d.cliente.tipoDoc}:</dt><dd>{d.cliente.numero}</dd></> : null}
        {d.vendedor ? <><dt>Atendió:</dt><dd>{d.vendedor}</dd></> : null}
      </dl>
      <div className={linea} />
      <table className="w-full">
        <thead><tr className="text-left"><th className="font-semibold">Descripción</th><th className="text-right font-semibold">Importe</th></tr></thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="pt-1.5 pr-2">
                <span className="block">{l.descripcion}</span>
                <span className="block">{cant(l.cantidad)} x {m2(l.precio)}</span>
                <span className="block text-[10px] text-black/70">Lote {l.lotes.join(", ")}</span>
              </td>
              <td className="pt-1.5 text-right tabular-nums">{m2(l.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={linea} />
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
        {v.descuento > 0 ? <><dt>Descuento</dt><dd className="text-right">-{m2(v.descuento)}</dd></> : null}
        <dt>Op. gravada</dt><dd className="text-right">{m2(v.subtotal)}</dd>
        <dt>IGV 18%</dt><dd className="text-right">{m2(v.igv)}</dd>
        <dt className="text-[13px] font-bold">TOTAL S/</dt><dd className="text-right text-[13px] font-bold">{m2(v.total)}</dd>
      </dl>
      <p className="mt-2 text-[10.5px]">{importeEnLetras(v.total)}</p>
      <div className={linea} />
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
        {d.pagos.map((p, i) => <Fragment key={i}><dt>{MEDIO[p.medio] ?? p.medio}</dt><dd className="text-right">{m2(p.monto)}</dd></Fragment>)}
      </dl>
      {v.receta ? (
        <>
          <div className={linea} />
          <p>Receta N.º {v.receta.numero} · Dr(a). {v.receta.medico} · CMP {v.receta.cmp}</p>
        </>
      ) : null}
      <div className={linea} />
      <footer className="space-y-0.5 text-center text-[10.5px]">
        {notas(d).map((n) => <p key={n}>{n}</p>)}
        <p className="pt-1 font-semibold">Gracias por su compra</p>
      </footer>
    </article>
  );
}

function HojaA4({ d, lineas }: { d: Detalle; lineas: Lineas }) {
  const v = d.venta;
  return (
    <article className="relative mx-auto w-[210mm] min-h-[297mm] bg-white px-[14mm] py-[14mm] text-[12.5px] leading-snug text-black shadow-lg print:min-h-0 print:shadow-none">
      {v.estado === "ANULADA" ? <Anulado /> : null}
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[20px] font-bold">{d.empresa.nombreComercial}</p>
          <p className="font-semibold">{d.empresa.razonSocial}</p>
          <p>{d.empresa.direccion}</p>
          {d.empresa.telefono ? <p>Tel. {d.empresa.telefono}</p> : null}
        </div>
        <div className="min-w-[62mm] rounded-lg border-2 border-black px-4 py-3 text-center">
          {d.empresa.ruc ? <p className="font-semibold">RUC {d.empresa.ruc}</p> : null}
          <p className="mt-1 text-[14px] font-bold uppercase">{TITULO[v.tipoComprobante]}</p>
          <p className="mt-1 text-[15px] font-bold">{v.serie}-{String(v.numero).padStart(8, "0")}</p>
        </div>
      </header>
      <section className="mt-6 grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1 rounded-lg border border-black/30 px-4 py-3">
        <span className="font-semibold">Cliente:</span><span className="uppercase">{d.cliente?.nombre ?? "Clientes varios"}</span>
        <span className="font-semibold">Fecha de emisión:</span><span>{fecha(v.fecha)} {hora(v.fecha)}</span>
        <span className="font-semibold">{d.cliente?.tipoDoc ?? "Documento"}:</span><span>{d.cliente?.numero ?? "—"}</span>
        <span className="font-semibold">Moneda:</span><span>Soles</span>
        {d.vendedor ? <><span className="font-semibold">Atendió:</span><span className="col-span-3">{d.vendedor}</span></> : null}
      </section>
      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y-2 border-black text-left">
            <th className="py-2 pr-2 font-semibold">Cant.</th><th className="py-2 pr-2 font-semibold">Descripción</th><th className="py-2 pr-2 font-semibold">Lote / Venc.</th>
            <th className="py-2 pr-2 text-right font-semibold">P. unit.</th><th className="py-2 text-right font-semibold">Importe</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i} className="border-b border-black/15 align-top">
              <td className="py-2 pr-2 tabular-nums">{cant(l.cantidad)}</td>
              <td className="py-2 pr-2">{l.descripcion}</td>
              <td className="py-2 pr-2 text-[11px]">{l.lotes.join(", ")}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{m2(l.precio)}</td>
              <td className="py-2 text-right tabular-nums">{m2(l.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-5 flex items-start justify-between gap-8">
        <div className="space-y-2">
          <p className="font-semibold">{importeEnLetras(v.total)}</p>
          <p>Forma de pago: {d.pagos.map((p) => `${MEDIO[p.medio] ?? p.medio} S/ ${m2(p.monto)}`).join(" · ")}</p>
          {v.receta ? <p>Receta N.º {v.receta.numero} · Dr(a). {v.receta.medico} · CMP {v.receta.cmp}</p> : null}
        </div>
        <dl className="grid min-w-[62mm] grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
          {v.descuento > 0 ? <><dt>Descuento</dt><dd className="text-right">-{m2(v.descuento)}</dd></> : null}
          <dt>Op. gravada</dt><dd className="text-right">{m2(v.subtotal)}</dd>
          <dt>IGV 18%</dt><dd className="text-right">{m2(v.igv)}</dd>
          <dt className="border-t-2 border-black pt-1 text-[14px] font-bold">Total S/</dt><dd className="border-t-2 border-black pt-1 text-right text-[14px] font-bold">{m2(v.total)}</dd>
        </dl>
      </section>
      <footer className="mt-10 border-t border-black/30 pt-3 text-center text-[11px] text-black/80">
        {notas(d).map((n) => <p key={n}>{n}</p>)}
      </footer>
    </article>
  );
}

function Anulado() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-label="Comprobante anulado">
      <span className="-rotate-[24deg] rounded-lg border-4 border-rojo/70 px-6 py-2 text-[34px] font-bold tracking-widest text-rojo/70">ANULADO</span>
    </div>
  );
}
