import { Constancia } from "./constancia";

export const metadata = { title: "Constancia de servicio" };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Constancia id={Number(id)} />;
}
