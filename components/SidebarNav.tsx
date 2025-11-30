"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Users, 
  AlertTriangle, 
  Network, 
  Upload, 
  Menu,
  Database,
  LogOut,
  Sun,
  Moon,
  FileText
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
  anamnese: FileText,
};

interface SidebarNavProps {
  duplicateCount?: number;
}

export default function SidebarNav({ duplicateCount = 0 }: SidebarNavProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-slate-800 bg-[#0f172a] text-slate-400 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-20" : "w-72"
      )}
    >
      {/* Header */}
      <div className="flex h-20 items-center justify-between px-6">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500 text-white">
              <LayoutDashboard size={18} />
            </div>
            <span className="text-lg font-bold text-white">Nexus</span>
          </div>
        )}
        {isCollapsed && (
           <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500 text-white">
             <LayoutDashboard size={18} />
           </div>
        )}
        
        <button
          onClick={toggleSidebar}
          className={cn(
            "text-slate-400 hover:text-white",
            isCollapsed ? "absolute right-0 top-0 flex h-20 w-20 items-center justify-center" : ""
          )}
        >
          <Menu size={20} />
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
              title={isCollapsed ? link.label : undefined}
            >
              <div className={cn("relative flex items-center justify-center", isCollapsed ? "w-full" : "")}>
                <Icon
                  size={20}
                  className={cn(
                    "transition-colors",
                    isActive ? "text-cyan-400" : "text-slate-400 group-hover:text-white"
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
    </aside>
  );
}
