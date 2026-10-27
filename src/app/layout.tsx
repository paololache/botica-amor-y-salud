import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Amor y Salud", template: "%s · Amor y Salud" },
  description: "Sistema de gestión de la Botica Amor y Salud: caja, ventas, inventario por lote, comisiones y alertas.",
};
export const viewport: Viewport = { themeColor: "#0c3b36" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE">
      <body>{children}</body>
    </html>
  );
}
