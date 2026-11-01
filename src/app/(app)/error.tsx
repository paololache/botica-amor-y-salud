"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Boton } from "@/components/ui";

export default function ErrorPantalla({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="tarjeta p-10 text-center">
      <h1 className="font-display font-semibold text-[22px]">Esta pantalla tuvo un problema</h1>
      <p className="text-ink-2 mt-2 text-sm">Tus datos no se perdieron. Intenta de nuevo; si sigue pasando, avisa al administrador.</p>
      <div className="flex justify-center gap-2 mt-5">
        <Boton onClick={reset}>Reintentar</Boton>
        <Link href="/"><Boton variante="borde">Volver al panel</Boton></Link>
      </div>
    </div>
  );
}
