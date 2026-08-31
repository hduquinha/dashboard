import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Mesma família que o site da VozUP usa para títulos (ver
// landingpage-vozup/vite.config.ts, peso 800 preload) — o relatório de
// campanha em PDF pega essa identidade em vez de inventar uma tipografia
// própria só para o documento impresso.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s | Dashboard",
  },
  description:
    "Dashboard de gestao comercial do Instituto UP.",
  // A equipe usa o dashboard adicionado à tela de início do celular. No iPhone
  // o manifest sozinho só é respeitado a partir do Safari 16.4 — sem estas
  // metatags, aparelhos mais antigos abrem o atalho como aba comum do Safari,
  // com barra de endereço, em vez de abrir como app.
  appleWebApp: {
    capable: true,
    title: "VozUP CRM",
    // "default" mantém o conteúdo abaixo da barra de status. Com
    // "black-translucent" a página passaria por baixo do relógio e do notch.
    statusBarStyle: "default",
  },
  other: {
    // O Next só emite `mobile-web-app-capable` (o padrão novo). O iOS anterior
    // ao 16.4 ignora essa tag e o manifest: sem a versão com prefixo `apple-`,
    // o atalho na tela de início abre como aba do Safari, com barra de endereço
    // — e é justamente nos iPhones que a equipe relata problema.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deixa a página ocupar a tela inteira do iPhone e habilita as variáveis
  // `env(safe-area-inset-*)`, usadas na barra de topo e no menu lateral para
  // não ficarem embaixo do notch nem da barrinha inicial.
  viewportFit: "cover",
  themeColor: "#001b31",
  // De propósito não fixamos `maximumScale`/`userScalable`: bloquear o zoom
  // quebra a acessibilidade de quem precisa ampliar para ler.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isTestEnvironment = process.env.DASHBOARD_TEST_ENV === "true";

  return (
    <html lang="pt-BR">
      <body
        className={`${inter.variable} ${geistMono.variable} ${poppins.variable} antialiased bg-[rgb(var(--background-color))] text-[rgb(var(--slate-12))]`}
      >
        {isTestEnvironment && (
          <div
            role="status"
            className="sticky top-0 z-[100] bg-amber-300 px-4 py-2 text-center text-sm font-bold text-amber-950 shadow-sm"
          >
            AMBIENTE DE TESTE — os dados alterados aqui não afetam o painel principal
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
