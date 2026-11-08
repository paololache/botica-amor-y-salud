"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  UsersRound, Send, LayoutGrid, ScanBarcode, Wallet, ReceiptText, Pill, FlaskConical, Truck, ArrowLeftRight, BookOpenText, BadgePercent, Link2, HandCoins, ChartColumn, Target, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X, ChevronDown,
} from "lucide-react";
import type { Rol } from "@/lib/permisos";
import { MODULOS, ROL_NOMBRE, moduloDeRuta, tieneRol } from "@/lib/permisos";
import { api } from "@/lib/cliente";
import { RecordatorioCampana } from "./recordatorio-campana";

export type UsuarioUI = { id: number; nombre: string; login: string; roles: Rol[]; verCostos: boolean };
const Ctx = createContext<UsuarioUI | null>(null);
export function useUsuario() { return useContext(Ctx)!; }

export const ICONOS: Record<string, typeof LayoutGrid> = {
  "/": LayoutGrid, "/vender": ScanBarcode, "/caja": Wallet, "/ventas": ReceiptText, "/productos": Pill, "/compras": Truck, "/movimientos": ArrowLeftRight, "/transferencias": Send,
  "/laboratorios": FlaskConical, "/kardex": BookOpenText, "/campanas": BadgePercent, "/complementos": Link2, "/comisiones": HandCoins, "/reportes": ChartColumn, "/metas": Target, "/usuarios": UsersRound,
};

/** Menú agrupado por tarea: atender al cliente, cuidar el stock, promociones y administración. Panel va solo, arriba. */
const GRUPOS: { titulo: string | null; rutas: string[] }[] = [
  { titulo: null, rutas: ["/"] },
  { titulo: "Atención", rutas: ["/vender", "/caja", "/ventas", "/transferencias"] },
  { titulo: "Inventario", rutas: ["/productos", "/compras", "/movimientos", "/kardex", "/laboratorios"] },
  { titulo: "Promociones", rutas: ["/campanas", "/complementos", "/comisiones"] },
  { titulo: "Gestión", rutas: ["/reportes", "/metas", "/usuarios"] },
];

function Marca({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className="size-9 shrink-0" aria-hidden>
        <g transform="rotate(-35 20 20)">
          <rect x="6" y="12" width="28" height="16" rx="8" fill="#fff" />
          <path d="M20 12h6a8 8 0 0 1 0 16h-6z" fill="#e2457a" />
        </g>
      </svg>
      <div className={compacta ? "hidden" : "leading-none whitespace-nowrap"}>
        <div className="font-display font-semibold text-[17px] text-white tracking-tight">Amor y Salud</div>
        <div className="text-[11.5px] text-rosado/80 mt-1 tracking-wide">Botica · Collique, Comas</div>
      </div>
    </div>
  );
}

const CLAVE_MENU = "botica_menu_reducido";
const CLAVE_GRUPOS = "botica_menu_grupos_cerrados";

export function Shell({ usuario, children }: { usuario: UsuarioUI; children: ReactNode }) {
  const ruta = usePathname();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  useEffect(() => setAbierto(false), [ruta]);
  // Cuenta la sección abierta para los accesos rápidos del panel; si falla no interrumpe nada.
  useEffect(() => {
    if (ruta === "/") return;
    fetch("/api/uso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruta }), keepalive: true }).catch(() => {});
  }, [ruta]);
  // El menú se recuerda por separado en Vender, donde por defecto va reducido para dar espacio a la venta.
  const [reducido, setReducido] = useState({ general: false, vender: true });
  useEffect(() => {
    try { const g = localStorage.getItem(CLAVE_MENU); if (g) setReducido((r) => ({ ...r, ...JSON.parse(g) })); } catch { /* sin preferencia guardada */ }
  }, []);
  const zona = ruta.startsWith("/vender") ? "vender" : "general";
  const compacto = reducido[zona];
  const alternarMenu = () => {
    const nuevo = { ...reducido, [zona]: !compacto };
    setReducido(nuevo);
    try { localStorage.setItem(CLAVE_MENU, JSON.stringify(nuevo)); } catch { /* se aplica solo en esta visita */ }
  };
  // Acordeón: se recuerdan los grupos cerrados; el grupo de la sección abierta se despliega solo al navegar.
  const [cerrados, setCerrados] = useState<string[]>([]);
  useEffect(() => {
    try { const g = localStorage.getItem(CLAVE_GRUPOS); if (g) setCerrados(JSON.parse(g)); } catch { /* todos abiertos */ }
  }, []);
  const guardarCerrados = (lista: string[]) => {
    setCerrados(lista);
    try { localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(lista)); } catch { /* se aplica solo en esta visita */ }
  };
  const alternarGrupo = (titulo: string) => guardarCerrados(cerrados.includes(titulo) ? cerrados.filter((t) => t !== titulo) : [...cerrados, titulo]);
  useEffect(() => {
    const grupo = GRUPOS.find((g) => g.titulo && g.rutas.some((r) => r !== "/" && (ruta === r || ruta.startsWith(r + "/"))));
    if (grupo?.titulo) setCerrados((c) => {
      if (!c.includes(grupo.titulo!)) return c;
      const lista = c.filter((t) => t !== grupo.titulo);
      try { localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(lista)); } catch { /* sin guardar */ }
      return lista;
    });
  }, [ruta]);
  const items = MODULOS.filter((m) => !m.oculto && tieneRol(usuario.roles, ...m.roles)).map((m) => ({ ...m, icono: ICONOS[m.href] }));
  const modulo = moduloDeRuta(ruta);
  const conAcceso = !modulo || tieneRol(usuario.roles, ...modulo.roles);
  const salir = async () => { await api("/api/auth/logout", { metodo: "POST" }); router.push("/login"); router.refresh(); };
  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));
  // Lo que no esté en un grupo cae al final, para no perder secciones nuevas.
  const agrupadas = GRUPOS.map((g) => ({ ...g, items: g.rutas.map((r) => items.find((m) => m.href === r)).filter((m): m is (typeof items)[number] => !!m) }));
  const sueltas = items.filter((m) => !GRUPOS.some((g) => g.rutas.includes(m.href)));
  if (sueltas.length) agrupadas.push({ titulo: "Otros", rutas: [], items: sueltas });
  const nav = (corto: boolean) => (
    <nav className="flex flex-col" aria-label="Principal">
      {agrupadas.filter((g) => g.items.length).map((g, k) => {
        const id = `grupo-${(g.titulo ?? "inicio").toLowerCase()}`;
        // En el menú reducido no hay acordeón: se ven todos los íconos separados por líneas.
        const abiertoG = corto || !g.titulo || !cerrados.includes(g.titulo);
        const conActivo = g.items.some((m) => activo(m.href));
        return (
          <div key={id} role="group" aria-label={g.titulo ?? undefined} className={k ? (corto ? "mt-2 pt-2 border-t border-white/10" : "mt-1.5") : ""}>
            {g.titulo && !corto ? (
              <button type="button" onClick={() => alternarGrupo(g.titulo!)} aria-expanded={abiertoG} aria-controls={id}
                className="w-full flex items-center justify-between gap-2 h-8 px-3 rounded-lg text-[11px] font-semibold uppercase tracking-[0.08em] text-rosado/60 hover:text-rosado hover:bg-white/5 transition">
                <span className="flex items-center gap-2">{g.titulo}{!abiertoG && conActivo ? <span className="size-1.5 rounded-full bg-rosado" aria-label="aquí estás" /> : null}</span>
                <ChevronDown size={15} className={`transition-transform duration-200 ${abiertoG ? "" : "-rotate-90"}`} aria-hidden />
              </button>
            ) : null}
            <div id={id} inert={!abiertoG} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${abiertoG ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="overflow-hidden flex flex-col gap-0.5">
                {g.items.map(({ href, texto, icono: I }) => (
                  <Link key={href} href={href} aria-current={activo(href) ? "page" : undefined} aria-label={corto ? texto : undefined} title={corto ? texto : undefined}
                    className={`group flex shrink-0 items-center h-9 rounded-xl text-[14px] font-medium transition ${corto ? "justify-center" : "gap-3 px-3 whitespace-nowrap"} ${activo(href) ? "bg-white text-vino" : "text-white/80 hover:text-white hover:bg-white/8"}`}>
                    <I size={18} className={`shrink-0 ${activo(href) ? "text-vino-2" : "text-rosado/70 group-hover:text-rosado"}`} />
                    {corto ? null : texto}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
  const pie = (corto: boolean) => (
    <div className="mt-auto pt-4">
      {corto ? (
        <button onClick={salir} title={`Cerrar sesión · ${usuario.nombre}`} aria-label="Cerrar sesión" className="size-10 mx-auto grid place-items-center rounded-xl text-white/75 hover:text-white hover:bg-white/8"><LogOut size={17} /></button>
      ) : (
        <div className="rounded-2xl bg-white/6 p-3.5">
          <div className="text-white font-semibold text-sm truncate">{usuario.nombre}</div>
          <div className="text-rosado/80 text-[12px] mt-0.5 truncate">{usuario.roles.map((r) => ROL_NOMBRE[r]).join(" · ")}</div>
          <button onClick={salir} className="mt-3 inline-flex items-center gap-2 text-[13px] text-white/75 hover:text-white">
            <LogOut size={15} /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
  return (
    <Ctx.Provider value={usuario}>
      <div className={`min-h-dvh transition-[padding] duration-200 print:!pl-0 ${compacto ? "lg:pl-[72px]" : "lg:pl-[252px]"}`}>
        <aside className={`no-imprimir hidden lg:flex fixed inset-y-0 left-0 z-20 flex-col panel-vino py-5 overflow-x-hidden overflow-y-auto transition-[width] duration-200 ${compacto ? "w-[72px] px-3" : "w-[252px] px-4"}`}>
          <div className={`mb-4 flex gap-2 ${compacto ? "flex-col items-center" : "items-center justify-between px-2"}`}>
            <Marca compacta={compacto} />
            <button onClick={alternarMenu} aria-expanded={!compacto} aria-label={compacto ? "Expandir menú" : "Reducir menú"} title={compacto ? "Expandir menú" : "Reducir menú"}
              className="size-9 shrink-0 grid place-items-center rounded-lg text-rosado/80 hover:text-white hover:bg-white/8">
              {compacto ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          {nav(compacto)}
          {pie(compacto)}
        </aside>
        <div className="no-imprimir lg:hidden sticky top-0 z-30 flex items-center justify-between panel-vino px-4 h-14">
          <Marca />
          <button onClick={() => setAbierto(true)} className="size-10 grid place-items-center text-white rounded-xl hover:bg-white/10" aria-label="Abrir menú"><Menu /></button>
        </div>
        {abierto ? (
          <div className="lg:hidden fixed inset-0 z-40 bg-vino-oscuro/50" onClick={() => setAbierto(false)}>
            <aside className="aparecer absolute inset-y-0 left-0 w-[280px] panel-vino px-4 py-5 flex flex-col overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-2 mb-6"><Marca /><button onClick={() => setAbierto(false)} className="text-white" aria-label="Cerrar menú"><X /></button></div>
              {nav(false)}
              {pie(false)}
            </aside>
          </div>
        ) : null}
        {tieneRol(usuario.roles, "CAJERO", "VENDEDOR", "QF") ? <RecordatorioCampana /> : null}
        <main className="px-4 md:px-8 py-6 md:py-8 max-w-[1440px] mx-auto">{conAcceso ? children : (
          <div className="tarjeta p-10 text-center">
            <h1 className="font-display font-semibold text-[22px]">No tienes acceso a {modulo?.texto}</h1>
            <p className="text-ink-2 mt-2 text-sm">Tus perfiles no incluyen este módulo. Pide al propietario que te lo asigne.</p>
            <Link href="/" className="inline-block mt-4 font-semibold text-vino-2">Volver al panel</Link>
          </div>
        )}</main>
      </div>
    </Ctx.Provider>
  );
}
