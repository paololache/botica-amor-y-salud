import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/sesion-servidor";
import { Shell } from "@/components/shell";
import { ProveedorAvisos } from "@/components/ui";
import { verCostos } from "@/lib/permisos";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { sesion: s, caducada } = await sesionActual();
  // Hay que borrar la cookie: con ella, /login devolvería al panel y quedaría en un bucle.
  if (caducada) redirect("/api/auth/salir");
  if (!s) redirect("/login");
  return (
    <ProveedorAvisos>
      <Shell usuario={{ ...s, verCostos: verCostos(s.roles) }}>{children}</Shell>
    </ProveedorAvisos>
  );
}
