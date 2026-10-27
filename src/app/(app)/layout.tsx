import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/sesion-servidor";
import { Shell } from "@/components/shell";
import { ProveedorAvisos } from "@/components/ui";
import { verCostos } from "@/lib/permisos";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await sesionActual();
  if (!s) redirect("/login");
  return (
    <ProveedorAvisos>
      <Shell usuario={{ ...s, verCostos: verCostos(s.rol) }}>{children}</Shell>
    </ProveedorAvisos>
  );
}
