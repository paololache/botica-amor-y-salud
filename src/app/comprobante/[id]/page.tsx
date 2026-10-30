import { Comprobante } from "./comprobante";

export const metadata = { title: "Comprobante" };

export default async function Pagina({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  return <Comprobante id={Number(id)} formato={sp.formato === "a4" ? "a4" : "ticket"} imprimir={sp.imprimir === "1"} />;
}
