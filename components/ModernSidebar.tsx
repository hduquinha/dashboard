"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Users, 
  AlertTriangle, 
  Network, 
  Upload, 
  ChevronLeft, 
  ChevronRight,
  Menu,
  Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "@/lib/navLinks";

const ICON_MAP: Record<string, any> = {
  home: LayoutDashboard,
  crm: Database,
  duplicados: AlertTriangle,
  recrutadores: Users,
  rede: Network,
  importar: Upload,
};

interface ModernSidebarProps {
  duplicateCount?: number;
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

export default function ModernSidebar({ duplicateCount = 0, isCollapsed, toggleSidebar }: ModernSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-neutral-800 bg-neutral-950 text-white transition-all duration-300 ease-in-out",
        isCollapsed ? "w-20" : "w-72"
      )}
    >
      {/* Header */}
      <div className="flex h-20 items-center justify-between px-6">
        {!isCollapsed && (
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight text-white">
              NEXUS<span className="text-cyan-400">.ADMIN</span>
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-neutral-500">
              System Control
            </p>
          </div>
        )}
        {isCollapsed && (
           <div className="mx-auto font-bold text-cyan-400">NX</div>
        )}
        
        <button
          onClick={toggleSidebar}
          className="absolute right-4 top-6 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-2 px-3 py-6">
        {NAV_LINKS.filter(link => !['importar', 'duplicados'].includes(link.key)).map((link) => {
          const Icon = ICON_MAP[link.key] || LayoutDashboard;
          const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
          const showBadge = link.key === "duplicados" && duplicateCount > 0;

          return (
            <Link
              key={link.key}
              href={link.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-200",
                isActive
                  ? "bg-cyan-500/10 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
              )}
              title={isCollapsed ? link.label : undefined}
            >
              <div className={cn("relative flex items-center justify-center", isCollapsed ? "w-full" : "")}>
                <Icon
                  size={22}
                  className={cn(
                    "transition-colors",
                    isActive ? "text-cyan-400" : "text-neutral-500 group-hover:text-white"
                  )}
                />
                {showBadge && isCollapsed && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </div>

              {!isCollapsed && (
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate text-sm font-medium">{link.label}</span>
                  {showBadge && (
                    <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                      {duplicateCount > 99 ? "99+" : duplicateCount}
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer / User Profile */}
      <div className="border-t border-neutral-800 p-4">
        <div className={cn("flex items-center gap-3 rounded-xl bg-neutral-900/50 p-3", isCollapsed ? "justify-center" : "")}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-sm font-bold text-white shadow-lg">
            AD
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-medium text-white">Admin User</p>
              <p className="truncate text-xs text-neutral-500">admin@nexus.com</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
