import type { MetadataRoute } from "next";

/**
 * Manifest PWA: permite "Adicionar à tela inicial" no celular dos vendedores,
 * abrindo a Dashboard como app (standalone) — requisito para as notificações
 * push funcionarem bem no Android.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VozUP CRM",
    short_name: "VozUP CRM",
    description: "Dashboard comercial VozUP / Instituto UP",
    start_url: "/crm",
    display: "standalone",
    background_color: "#001b31",
    theme_color: "#001b31",
    icons: [
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
