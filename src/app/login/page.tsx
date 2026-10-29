"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/cliente";
import { Boton, Campo, Entrada } from "@/components/ui";

const DEMO = [
  { login: "admin", rol: "Propietaria" }, { login: "qf", rol: "Químico farmacéutico" }, { login: "caja1", rol: "Cajero" },
  { login: "almacen", rol: "Inventariador" }, { login: "contador", rol: "Contador" },
];

export default function Login() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const modoPrueba = process.env.NEXT_PUBLIC_MODO_PRUEBA !== "0";

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true); setError(null);
    try {
      await api("/api/auth/login", { cuerpo: { login, password } });
      router.push("/"); router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setCargando(false);
    }
  };

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative overflow-hidden bg-petroleo text-white px-8 py-10 lg:px-14 lg:py-14 flex flex-col">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 40 40" className="size-10" aria-hidden><g transform="rotate(-35 20 20)"><rect x="6" y="12" width="28" height="16" rx="8" fill="#fff" /><path d="M20 12h6a8 8 0 0 1 0 16h-6z" fill="#e2457a" /></g></svg>
          <span className="text-menta text-sm tracking-wide">Botica · Jr. Tacna 142, Collique, Comas</span>
        </div>
        <h1 className="font-display font-bold text-[46px] sm:text-[64px] lg:text-[78px] leading-[.95] mt-14 lg:mt-24 tracking-[-0.04em]">
          Amor<br />y Salud
        </h1>
        <p className="mt-6 text-[17px] text-white/80 max-w-md">Caja, ventas, inventario por lote y comisiones en un solo lugar. Al entrar ves primero lo que necesita atención.</p>
        <div className="mt-auto pt-12 hidden sm:grid grid-cols-4 gap-3 max-w-md" aria-hidden>
          {["#f7d3d7", "#fbe6bf", "transparent", "#d9ecf5", "transparent", "#fbe6bf", "#f7d3d7", "transparent"].map((c, i) => (
            <div key={i} className="h-14 rounded-[28px/22px] border border-white/25" style={{ background: c === "transparent" ? "repeating-linear-gradient(135deg, rgba(255,255,255,.08) 0 6px, transparent 6px 12px)" : `radial-gradient(120% 90% at 30% 22%, rgba(255,255,255,.9) 0 16%, transparent 42%), ${c}`, borderStyle: c === "transparent" ? "dashed" : "solid", animation: `aparecer .4s ${i * 60}ms both ease` }} />
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={entrar} className="w-full max-w-sm">
          <h2 className="font-display font-semibold text-2xl">Inicia sesión</h2>
          <p className="text-ink-2 mt-1.5 text-[15px]">Usa el usuario que te asignó la administración.</p>
          <div className="mt-8 space-y-4">
            <Campo etiqueta="Usuario"><Entrada autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="caja1" /></Campo>
            <Campo etiqueta="Clave"><Entrada type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
          </div>
          {error ? <p className="mt-4 text-sm text-rojo" role="alert">{error}</p> : null}
          <Boton type="submit" variante="amor" tam="lg" className="w-full mt-6" cargando={cargando}>Entrar</Boton>
          {modoPrueba ? (
            <div className="mt-10 rounded-2xl border border-dashed border-foil-3 p-4">
              <p className="text-[12.5px] font-semibold text-ink-2">Ambiente de pruebas · clave «botica2026»</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {DEMO.map((d) => (
                  <button type="button" key={d.login} onClick={() => { setLogin(d.login); setPassword("botica2026"); }}
                    className="h-8 px-3 rounded-full bg-papel border border-foil-3 text-[13px] hover:border-petroleo-3">
                    <b className="font-semibold">{d.login}</b> <span className="text-ink-3">· {d.rol}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
