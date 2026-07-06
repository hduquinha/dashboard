"use client";

import { useEffect, useRef } from "react";

interface NewLeadNotificationItem {
  id: number;
  nome: string | null;
  origem: string | null;
  criadoEm: string;
}

const POLL_INTERVAL_MS = 30_000;
/** Acima disso, agrupa em uma única notificação para não inundar o sistema. */
const MAX_INDIVIDUAL_NOTIFICATIONS = 5;

function formatHora(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function buildBody(lead: NewLeadNotificationItem): string {
  const nome = lead.nome ?? "Novo cadastro";
  const acao = lead.origem
    ? `acabou de preencher o formulário "${lead.origem}"`
    : "acabou de se cadastrar";
  const hora = formatHora(lead.criadoEm);
  return `${nome} ${acao}.${hora ? ` (${hora})` : ""}`;
}

async function showNotification(title: string, body: string, tag: string): Promise<void> {
  // Via service worker quando possível: obrigatório no Chrome do Android
  // (new Notification() lança exceção lá) e permite clique consistente.
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag,
        icon: "/pwa-icon-192.png",
        badge: "/pwa-icon-192.png",
        data: { url: "/distribuicao" },
      });
      return;
    }
  } catch {
    // segue para o fallback
  }

  try {
    const notification = new Notification(title, { body, tag, icon: "/pwa-icon-192.png" });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Sem suporte a nenhuma das vias — a Dashboard segue funcionando normalmente.
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Registra o service worker e inscreve o aparelho no web push do servidor.
 * Retorna true se o push ficou ativo (o servidor passa a entregar as
 * notificações de lead mesmo com o navegador fechado).
 */
async function setupPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    if (!("PushManager" in window) || Notification.permission !== "granted") return false;

    const keyRes = await fetch("/api/push/public-key");
    if (!keyRes.ok) return false;
    const { publicKey } = (await keyRes.json()) as { publicKey?: string };
    if (!publicKey) return false;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));

    const saveRes = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription }),
    });
    return saveRes.ok;
  } catch {
    // Push indisponível (http sem TLS, navegador antigo, permissão negada…):
    // o polling abaixo continua cobrindo com a aba aberta.
    return false;
  }
}

/**
 * Notificações de leads/cadastros novos. Montado no layout autenticado:
 * 1. registra o service worker e tenta inscrever o aparelho no web push —
 *    nesse modo o servidor entrega a notificação até com o navegador fechado;
 * 2. se o push não ficar ativo, mantém o polling do feed
 *    `/api/notifications/leads` como fallback (funciona com a aba aberta).
 */
export default function LeadNotifications() {
  const lastSeenIdRef = useRef<number | null>(null);
  const pollingRef = useRef(false);
  const pushActiveRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    let cancelled = false;

    async function init() {
      if (Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          // decisão pendente — segue sem notificação
        }
      }
      const pushActive = await setupPush();
      if (!cancelled) pushActiveRef.current = pushActive;
    }

    async function poll() {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const cursor = lastSeenIdRef.current;
        const url =
          cursor === null ? "/api/notifications/leads" : `/api/notifications/leads?afterId=${cursor}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as { latestId?: number; leads?: NewLeadNotificationItem[] };
        if (cancelled || typeof data.latestId !== "number") return;

        const isBaseline = cursor === null;
        lastSeenIdRef.current = Math.max(cursor ?? 0, data.latestId);
        if (isBaseline || Notification.permission !== "granted") return;
        // Push ativo: o servidor já entrega estas notificações (inclusive
        // neste aparelho) — não duplicar pela via local.
        if (pushActiveRef.current) return;

        const leads = data.leads ?? [];
        if (leads.length === 0) return;

        if (leads.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
          void showNotification(
            "Novos Leads Recebidos",
            `${leads.length} novos cadastros chegaram ao sistema.`,
            `leads-batch-${data.latestId}`
          );
          return;
        }
        for (const lead of leads) {
          void showNotification("Novo Lead Recebido", buildBody(lead), `lead-${lead.id}`);
        }
      } catch {
        // Falha de rede pontual: tenta de novo no próximo ciclo.
      } finally {
        pollingRef.current = false;
      }
    }

    void init();
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
