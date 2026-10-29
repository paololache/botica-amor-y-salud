"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  LayoutGrid, ScanBarcode, Wallet, ReceiptText, Pill, Truck, ArrowLeftRight, BookOpenText, BadgePercent, Link2, HandCoins, ChartColumn, LogOut, Menu, X,
} from "lucide-react";
import type { Rol } from "@/lib/permisos";
import { ROL_NOMBRE } from "@/lib/permisos";
import { api } from "@/lib/cliente";

export type UsuarioUI = { id: number; nombre: string; login: string; rol: Rol; verCostos: boolean };
const Ctx = createContext<UsuarioUI | null>(null);
export function useUsuario() { return useContext(Ctx)!; }

const NAV: { href: string; texto: string; icono: typeof LayoutGrid; roles: Rol[] }[] = [
  { href: "/", texto: "Panel", icono: LayoutGrid, roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "INVENTARIADOR", "CONTADOR"] },
  { href: "/vender", texto: "Vender", icono: ScanBarcode, roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR"] },
  { href: "/caja", texto: "Caja", icono: Wallet, roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR"] },
  { href: "/ventas", texto: "Ventas", icono: ReceiptText, roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "CONTADOR"] },
  { href: "/productos", texto: "Productos", icono: Pill, roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "INVENTARIADOR", "CONTADOR"] },
  { href: "/compras", texto: "Compras", icono: Truck, roles: ["ADMIN", "INVENTARIADOR"] },
  { href: "/movimientos", texto: "Salidas y entradas", icono: ArrowLeftRight, roles: ["ADMIN", "QF", "INVENTARIADOR"] },
  { href: "/kardex", texto: "Kardex", icono: BookOpenText, roles: ["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"] },
  { href: "/campanas", texto: "Campañas", icono: BadgePercent, roles: ["ADMIN"] },
  { href: "/complementos", texto: "Complementos", icono: Link2, roles: ["ADMIN", "QF"] },
  { href: "/comisiones", texto: "Comisiones", icono: HandCoins, roles: ["ADMIN", "QF", "CAJERO", "VENDEDOR", "CONTADOR"] },
  { href: "/reportes", texto: "Reportes", icono: ChartColumn, roles: ["ADMIN", "QF", "INVENTARIADOR", "CONTADOR"] },
];

function Marca() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className="size-9 shrink-0" aria-hidden>
        <g transform="rotate(-35 20 20)">
          <rect x="6" y="12" width="28" height="16" rx="8" fill="#fff" />
          <path d="M20 12h6a8 8 0 0 1 0 16h-6z" fill="#e2457a" />
        </g>
      </svg>
      <div className="leading-none">
        <div className="font-display font-semibold text-[17px] text-white tracking-tight">Amor y Salud</div>
        <div className="text-[11.5px] text-rosado/80 mt-1 tracking-wide">Botica · Collique, Comas</div>
      </div>
    </div>
  );
}

export function Shell({ usuario, children }: { usuario: UsuarioUI; children: ReactNode }) {
  const ruta = usePathname();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  useEffect(() => setAbierto(false), [ruta]);
  const items = NAV.filter((n) => n.roles.includes(usuario.rol));
  const salir = async () => { await api("/api/auth/logout", { metodo: "POST" }); router.push("/login"); router.refresh(); };
  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));
  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Principal">
      {items.map(({ href, texto, icono: I }) => (
        <Link key={href} href={href} aria-current={activo(href) ? "page" : undefined}
          className={`group flex items-center gap-3 h-10 px-3 rounded-xl text-[14.5px] font-medium transition ${activo(href) ? "bg-white text-vino" : "text-white/80 hover:text-white hover:bg-white/8"}`}>
          <I size={18} className={activo(href) ? "text-vino-2" : "text-rosado/70 group-hover:text-rosado"} />
          {texto}
        </Link>
      ))}
    </nav>
  );
  const pie = (
    <div className="mt-auto pt-6">
      <div className="rounded-2xl bg-white/6 p-3.5">
        <div className="text-white font-semibold text-sm truncate">{usuario.nombre}</div>
        <div className="text-rosado/80 text-[12px] mt-0.5">{ROL_NOMBRE[usuario.rol]}</div>
        <button onClick={salir} className="mt-3 inline-flex items-center gap-2 text-[13px] text-white/75 hover:text-white">
          <LogOut size={15} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
  return (
    <Ctx.Provider value={usuario}>
      <div className="min-h-dvh lg:pl-[252px]">
        <aside className="no-imprimir hidden lg:flex fixed inset-y-0 left-0 w-[252px] flex-col panel-vino px-4 py-5 overflow-y-auto">
          <div className="px-2 mb-7"><Marca /></div>
          {nav}
          {pie}
        </aside>
        <div className="no-imprimir lg:hidden sticky top-0 z-30 flex items-center justify-between panel-vino px-4 h-14">
          <Marca />
          <button onClick={() => setAbierto(true)} className="size-10 grid place-items-center text-white rounded-xl hover:bg-white/10" aria-label="Abrir menú"><Menu /></button>
        </div>
        {abierto ? (
          <div className="lg:hidden fixed inset-0 z-40 bg-vino-oscuro/50" onClick={() => setAbierto(false)}>
            <aside className="aparecer absolute inset-y-0 left-0 w-[280px] panel-vino px-4 py-5 flex flex-col overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-2 mb-6"><Marca /><button onClick={() => setAbierto(false)} className="text-white" aria-label="Cerrar menú"><X /></button></div>
              {nav}
              {pie}
            </aside>
          </div>
        ) : null}
        <main className="px-4 md:px-8 py-6 md:py-8 max-w-[1440px] mx-auto">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
