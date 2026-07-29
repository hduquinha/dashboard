"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification, AppNotificationFeed } from "@/types/notifications";

const POLL_INTERVAL_MS = 45_000;
/** Quantos avisos aparecem empilhados na tela ao mesmo tempo. */
const MAX_TOASTS = 3;
const TOAST_TTL_MS = 12_000;

export interface UseAppNotificationsResult {
  items: AppNotification[];
  unread: number;
  toasts: AppNotification[];
  dismissToast: (id: number) => void;
  markRead: (ids?: number[]) => Promise<void>;
  refresh: () => void;
}

/**
 * Feed de notificacoes do site: busca periodica em /api/notifications/feed,
 * contador para o menu e avisos flutuantes para o que chegou com a aba
 * aberta. Independe da permissao de notificacao do navegador — este e o
 * canal que sempre funciona.
 */
export function useAppNotifications(enabled = true): UseAppNotificationsResult {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  // Maior id ja conhecido: o que passar disso e novidade e vira toast. Na
  // primeira carga so define a linha de base (senao quem abre o dashboard com
  // 20 pendencias antigas leva 20 avisos na cara).
  const baselineIdRef = useRef<number | null>(null);
  const dismissedRef = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/feed?limit=30", { cache: "no-store" });
      if (!response.ok) return;

      const feed = (await response.json()) as AppNotificationFeed;
      if (!Array.isArray(feed.items)) return;

      setItems(feed.items);
      setUnread(feed.unread ?? 0);

      const highestId = feed.items.reduce((max, item) => Math.max(max, item.id), 0);
      if (baselineIdRef.current === null) {
        baselineIdRef.current = highestId;
        return;
      }

      const baseline = baselineIdRef.current;
      const fresh = feed.items
        .filter((item) => item.id > baseline && !item.readAt && !dismissedRef.current.has(item.id))
        .slice(0, MAX_TOASTS);

      if (fresh.length > 0) {
        setToasts((current) => {
          const merged = [...fresh, ...current];
          const unique = merged.filter(
            (item, index) => merged.findIndex((other) => other.id === item.id) === index
          );
          return unique.slice(0, MAX_TOASTS);
        });
      }
      baselineIdRef.current = Math.max(baseline, highestId);
    } catch {
      // Rede instavel: proximo ciclo tenta de novo.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void load();
    };

    void load();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    // Voltar para a aba deve atualizar na hora, sem esperar o proximo ciclo.
    document.addEventListener("visibilitychange", tick);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, load]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((current) => current.slice(0, -1));
    }, TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismissToast = useCallback((id: number) => {
    dismissedRef.current.add(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const markRead = useCallback(
    async (ids?: number[]) => {
      const body = ids && ids.length > 0 ? { ids } : { all: true };
      // Otimista: o contador zera na hora e o servidor confirma depois.
      setUnread((current) => (ids && ids.length > 0 ? Math.max(0, current - ids.length) : 0));
      setItems((current) =>
        current.map((item) =>
          !ids || ids.includes(item.id) ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item
        )
      );

      try {
        await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } finally {
        void load();
      }
    },
    [load]
  );

  return { items, unread, toasts, dismissToast, markRead, refresh: () => void load() };
}
