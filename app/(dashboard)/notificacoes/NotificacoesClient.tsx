"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, Bell, CheckCheck, Inbox, RefreshCw, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppNotification, AppNotificationFeed, AppNotificationKind } from "@/types/notifications";

const POLL_INTERVAL_MS = 45_000;

const KIND_META: Record<
  AppNotificationKind,
  { icon: typeof Bell; label: string; tone: string }
> = {
  new_lead: { icon: Inbox, label: "Lead novo", tone: "bg-blue-50 text-blue-700 border-blue-100" },
  lead_assigned: {
    icon: UserPlus,
    label: "Atribuição",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  stale_lead: {
    icon: AlarmClock,
    label: "Lead parado",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  undistributed_lead: {
    icon: AlarmClock,
    label: "Sem distribuir",
    tone: "bg-rose-50 text-rose-700 border-rose-100",
  },
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "agora";
  if (diffMinutes < 60) return `há ${diffMinutes} min`;
  if (diffMinutes < 60 * 24) return `há ${Math.round(diffMinutes / 60)}h`;

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

interface NotificacoesClientProps {
  initialFeed: AppNotificationFeed;
}

export default function NotificacoesClient({ initialFeed }: NotificacoesClientProps) {
  const [feed, setFeed] = useState<AppNotificationFeed>(initialFeed);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/feed?limit=60", { cache: "no-store" });
      if (!response.ok) return;
      setFeed((await response.json()) as AppNotificationFeed);
    } catch {
      // Sem rede: mantém o que já está na tela.
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const markRead = useCallback(
    async (ids?: number[]) => {
      const body = ids && ids.length > 0 ? { ids } : { all: true };
      setFeed((current) => ({
        items: current.items.map((item) =>
          !ids || ids.includes(item.id)
            ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
            : item
        ),
        unread: ids && ids.length > 0 ? Math.max(0, current.unread - ids.length) : 0,
      }));

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

  const visibleItems = useMemo(
    () => (onlyUnread ? feed.items.filter((item) => !item.readAt) : feed.items),
    [feed.items, onlyUnread]
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[rgb(var(--slate-12))]">Notificações</h1>
          <p className="mt-1 text-sm text-[rgb(var(--slate-10))]">
            {feed.unread > 0
              ? `${feed.unread} não ${feed.unread === 1 ? "lida" : "lidas"}`
              : "Tudo em dia por aqui."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyUnread((value) => !value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition",
              onlyUnread
                ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                : "border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))]"
            )}
          >
            {onlyUnread ? "Mostrando não lidas" : "Só não lidas"}
          </button>

          <button
            type="button"
            onClick={async () => {
              setIsRefreshing(true);
              await load();
              setIsRefreshing(false);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))]"
          >
            <RefreshCw className={cn("size-3.5", isRefreshing ? "animate-spin" : "")} />
            Atualizar
          </button>

          <button
            type="button"
            onClick={() => void markRead()}
            disabled={feed.unread === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCheck className="size-3.5" />
            Marcar todas como lidas
          </button>
        </div>
      </header>

      {visibleItems.length === 0 ? (
        <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center">
          <Bell className="mx-auto size-6 text-[rgb(var(--slate-9))]" />
          <p className="mt-3 text-sm font-medium text-[rgb(var(--slate-11))]">
            {onlyUnread ? "Nenhuma notificação não lida." : "Nenhuma notificação por enquanto."}
          </p>
          <p className="mt-1 text-xs text-[rgb(var(--slate-10))]">
            Leads novos, atribuições e leads parados aparecem aqui automaticamente.
          </p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {visibleItems.map((item) => (
            <NotificationRow key={item.id} item={item} onMarkRead={() => void markRead([item.id])} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  onMarkRead,
}: {
  item: AppNotification;
  onMarkRead: () => void;
}) {
  const meta = KIND_META[item.kind] ?? {
    icon: Bell,
    label: "Aviso",
    tone: "bg-slate-50 text-slate-700 border-slate-100",
  };
  const Icon = meta.icon;
  const isUnread = !item.readAt;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-[rgb(var(--surface-1))] p-4 transition",
        isUnread
          ? "border-cyan-200 shadow-[0_1px_2px_rgba(28,32,36,0.06)]"
          : "border-[rgb(var(--border-weak))]"
      )}
    >
      <span
        className={cn(
          "flex size-9 flex-shrink-0 items-center justify-center rounded-lg border",
          meta.tone
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
            {meta.label}
          </span>
          <span className="text-xs text-[rgb(var(--slate-9))]">{formatWhen(item.createdAt)}</span>
          {isUnread ? <span className="size-1.5 rounded-full bg-cyan-500" /> : null}
        </div>

        <p className="mt-1 text-sm font-semibold text-[rgb(var(--slate-12))]">{item.title}</p>
        <p className="mt-0.5 text-sm text-[rgb(var(--slate-11))]">{item.body}</p>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {item.url ? (
            <Link
              href={item.url}
              onClick={onMarkRead}
              className="text-xs font-bold text-cyan-700 hover:text-cyan-900"
            >
              Abrir
            </Link>
          ) : null}
          {isUnread ? (
            <button
              type="button"
              onClick={onMarkRead}
              className="text-xs font-semibold text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
            >
              Marcar como lida
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
