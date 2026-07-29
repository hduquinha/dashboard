"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu } from "lucide-react";
import LeadNotifications from "@/components/LeadNotifications";
import ModernSidebar from "@/components/ModernSidebar";
import NotificationToasts from "@/components/NotificationToasts";
import { useAppNotifications } from "@/components/useAppNotifications";
import type { DashboardUser } from "@/lib/auth";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  currentUser?: DashboardUser | null;
  duplicateCount: number;
}

export default function DashboardLayoutClient({
  children,
  currentUser,
  duplicateCount,
}: DashboardLayoutClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpenPathname, setMobileOpenPathname] = useState<string | null>(null);
  const pathname = usePathname();
  const isMobileOpen = mobileOpenPathname === pathname;
  const isVozupWorkspace = pathname.startsWith("/vozup") || pathname.startsWith("/financeiro");
  const notifications = useAppNotifications();

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#f5f8fb] text-slate-950">
      <LeadNotifications />
      <div className="fixed left-0 right-0 top-0 z-20 flex h-14 items-center justify-between border-b border-white/10 bg-[var(--dashboard-navy)] px-3 text-white shadow-[0_12px_30px_rgba(2,19,37,0.18)] lg:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileOpenPathname(pathname)}
            className="flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight text-white">
              <span className="text-[#08d9ff]">VOZ</span>UP
            </span>
          </div>
        </div>

        <Link
          href="/notificacoes"
          className="relative flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
          aria-label={
            notifications.unread > 0
              ? `Notificações (${notifications.unread} não lidas)`
              : "Notificações"
          }
        >
          <Bell size={19} />
          {notifications.unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-black text-slate-950">
              {notifications.unread > 99 ? "99+" : notifications.unread}
            </span>
          ) : null}
        </Link>
      </div>

      <ModernSidebar
        currentUser={currentUser}
        duplicateCount={duplicateCount}
        unreadNotifications={notifications.unread}
        isCollapsed={isCollapsed}
        toggleSidebar={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileOpen}
        closeMobileSidebar={() => setMobileOpenPathname(null)}
      />
      
      <main className="flex-1 overflow-y-auto overflow-x-hidden pt-14 transition-all duration-300 lg:pt-0">
        <div className={isVozupWorkspace ? "min-h-full p-0" : "min-h-full p-3 sm:p-4 lg:p-6"}>
          {children}
        </div>
      </main>

      <NotificationToasts
        toasts={notifications.toasts}
        onDismiss={notifications.dismissToast}
        onOpen={(notification) => {
          notifications.dismissToast(notification.id);
          void notifications.markRead([notification.id]);
        }}
      />
    </div>
  );
}
