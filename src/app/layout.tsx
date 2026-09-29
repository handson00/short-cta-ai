import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Short CTA AI",
  description: "Esteira de preparação de Shorts: importar, analisar, escolher o CTA e exportar.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
};

const NAV = [
  { href: "/", label: "Fila" },
  { href: "/editor", label: "Editor" },
  { href: "/style", label: "Meu estilo" },
  { href: "/usage", label: "Uso da IA" },
  { href: "/settings", label: "Configurações" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-white">S</span>
              <span className="hidden sm:inline">Short CTA AI</span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-850 hover:text-ink-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">{children}</main>
      </body>
    </html>
  );
}
