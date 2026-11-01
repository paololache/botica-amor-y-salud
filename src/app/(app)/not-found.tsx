import Link from "next/link";

export default function NoEncontrada() {
  return (
    <div className="tarjeta p-10 text-center">
      <h1 className="font-display font-semibold text-[22px]">No encontramos esta página</h1>
      <p className="text-ink-2 mt-2 text-sm">Puede que la dirección esté mal escrita o que ya no exista.</p>
      <Link href="/" className="inline-block mt-4 font-semibold text-vino-2">Volver al panel</Link>
    </div>
  );
}
