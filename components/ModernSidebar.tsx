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
  Database,
  LogOut,
  Sun,
  Moon,
  FileText,
  X,
  CalendarDays
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "@/lib/navLinks";

const ICON_MAP: Record<string, any> = {
  home: LayoutDashboard,
  treinamentos: CalendarDays,
  crm: Database,
  duplicados: AlertTriangle,
  recrutadores: Users,
  rede: Network,
  importar: Upload,
  anamnese: FileText,
};

interface ModernSidebarProps {
  duplicateCount?: number;
  isCollapsed: boolean;
  toggleSidebar: () => void;
  isMobileOpen?: boolean;
  closeMobileSidebar?: () => void;
}

export default function ModernSidebar({ 
  duplicateCount = 0, 
  isCollapsed, 
  toggleSidebar,
  isMobileOpen = false,
  closeMobileSidebar
}: ModernSidebarProps) {
  const pathname = usePathname();
  const showFullContent = !isCollapsed || isMobileOpen;

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={closeMobileSidebar}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-slate-800 bg-[#0f172a] text-slate-400 transition-all duration-300 ease-in-out lg:static",
          "w-72", // Mobile width
          isCollapsed ? "lg:w-20" : "lg:w-72", // Desktop width
          isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="flex h-20 items-center justify-between px-6">
          {showFullContent && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500 text-white">
                <LayoutDashboard size={18} />
              </div>
              <span className="text-lg font-bold text-white">Nexus</span>
            </div>
          )}
          {!showFullContent && (
             <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500 text-white">
               <LayoutDashboard size={18} />
             </div>
          )}
          
          {/* Desktop Toggle */}
          <button
            onClick={toggleSidebar}
            className="hidden lg:block text-slate-400 hover:text-white"
          >
            <Menu size={20} />
          </button>

          {/* Mobile Close */}
          <button
            onClick={closeMobileSidebar}
            className="lg:hidden text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-6">
          {NAV_LINKS.filter(link => !['importar', 'duplicados'].includes(link.key)).map((link) => {
            const Icon = ICON_MAP[link.key] || LayoutDashboard;
            const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            const showBadge = link.key === "duplicados" && duplicateCount > 0;

            return (
              <Link
                key={link.key}
                href={link.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200",
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                )}
                title={!showFullContent ? link.label : undefined}
              >
                <div className={cn("relative flex items-center justify-center", !showFullContent ? "w-full" : "")}>
                  <Icon
                    size={20}
                    className={cn(
                      "transition-colors",
                      isActive ? "text-cyan-400" : "text-slate-400 group-hover:text-white"
                    )}
                  />
                  {showBadge && !showFullContent && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </div>

                {showFullContent && (
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

        {/* Footer Actions */}
        <div className="border-t border-slate-800 p-4 space-y-4">
          {/* Theme Toggle (Visual) */}
          {showFullContent && (
            <div className="flex items-center justify-between rounded-lg bg-slate-900 p-1">
              <button className="flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-800 py-1.5 text-xs font-medium text-white shadow-sm">
                <Moon size={14} />
                <span>Dark</span>
              </button>
              <button className="flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium text-slate-500 hover:text-slate-300">
                <Sun size={14} />
                <span>Light</span>
              </button>
            </div>
          )}

          {/* Logout */}
          <button className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400",
            !showFullContent ? "justify-center" : ""
          )}>
            <LogOut size={20} />
            {showFullContent && <span className="text-sm font-medium">Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
