import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Dashboard Chatwoot",
    template: "%s | Dashboard Chatwoot",
  },
  description:
    "Dashboard integrado aos usuarios, sessoes e canais do Chatwoot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-[rgb(var(--background-color))] text-[rgb(var(--slate-12))]`}
      >
        {children}
      </body>
    </html>
  );
}
