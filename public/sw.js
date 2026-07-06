/*
 * Service worker da Dashboard VozUP.
 * - Recebe web push do servidor (leads novos) e mostra a notificação mesmo
 *   com o navegador fechado (Android/Chrome exige service worker para isso).
 * - Também mostra notificações pedidas pela página via postMessage (fallback
 *   do polling quando o push não está disponível).
 * - Clique na notificação foca a Dashboard (ou abre uma aba nova).
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function showLeadNotification(data) {
  const title = data.title || "Novo Lead Recebido";
  return self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    data: { url: data.url || "/distribuicao" },
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(showLeadNotification(data));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    event.waitUntil(showLeadNotification(event.data.payload || {}));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && new URL(client.url).pathname !== url) {
            client.navigate(url).catch(() => {});
          }
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
