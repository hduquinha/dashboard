"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu } from "lucide-react";
import ModernSidebar from "@/components/ModernSidebar";
import type { DashboardUser } from "@/lib/auth";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  chatwootUrl?: string | null;
  currentUser?: DashboardUser | null;
  duplicateCount: number;
}

export default function DashboardLayoutClient({
  children,
  chatwootUrl,
  currentUser,
  duplicateCount,
}: DashboardLayoutClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpenPathname, setMobileOpenPathname] = useState<string | null>(null);
  const pathname = usePathname();
  const isMobileOpen = mobileOpenPathname === pathname;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[rgb(var(--background-color))] text-[rgb(var(--slate-12))]">
      <div className="fixed left-0 right-0 top-0 z-20 flex h-14 items-center justify-between border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 shadow-[0_1px_2px_rgba(28,32,36,0.04)] lg:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileOpenPathname(pathname)}
            className="flex size-9 items-center justify-center rounded-lg text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))]"
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Image src="/chatwoot-logo-thumbnail.svg" alt="Chatwoot" width={24} height={24} />
            <span className="text-sm font-semibold text-[rgb(var(--slate-12))]">
              CRM Chatwoot
            </span>
          </div>
        </div>
      </div>

      <ModernSidebar
        chatwootUrl={chatwootUrl}
        currentUser={currentUser}
        duplicateCount={duplicateCount}
        isCollapsed={isCollapsed}
        toggleSidebar={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileOpen}
        closeMobileSidebar={() => setMobileOpenPathname(null)}
      />
      
      <main className="flex-1 overflow-y-auto overflow-x-hidden pt-14 transition-all duration-300 lg:pt-0">
        <div className="min-h-full p-3 sm:p-4 lg:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
