"use client";

import Link from "next/link";
import { AlarmClock, Bell, Inbox, ListChecks, MessageSquare, UserPlus, X } from "lucide-react";
import type { AppNotification, AppNotificationKind } from "@/types/notifications";

const ICON_BY_KIND: Record<AppNotificationKind, typeof Bell> = {
  new_lead: Inbox,
  lead_assigned: UserPlus,
  stale_lead: AlarmClock,
  undistributed_lead: AlarmClock,
  task_assigned: ListChecks,
  task_mention: MessageSquare,
  task_due: AlarmClock,
};

interface NotificationToastsProps {
  toasts: AppNotification[];
  onDismiss: (id: number) => void;
  onOpen: (notification: AppNotification) => void;
}

/**
 * Avisos flutuantes dentro do proprio site, para quem esta com o dashboard
 * aberto. Complementa (nao substitui) o web push: aparece mesmo com a
 * notificacao do navegador bloqueada.
 */
export default function NotificationToasts({ toasts, onDismiss, onOpen }: NotificationToastsProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = ICON_BY_KIND[toast.kind] ?? Bell;
        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-cyan-200/20 bg-[#001b31] p-3 text-white shadow-[0_18px_40px_rgba(2,19,37,0.35)]"
          >
            <span className="mt-0.5 flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-200">
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-5">{toast.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-200/80">{toast.body}</p>
              {toast.url ? (
                <Link
                  href={toast.url}
                  onClick={() => onOpen(toast)}
                  className="mt-1.5 inline-block text-xs font-bold text-cyan-300 hover:text-cyan-200"
                >
                  Abrir
                </Link>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="flex size-6 flex-shrink-0 items-center justify-center rounded-md text-slate-300/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Dispensar notificação"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
