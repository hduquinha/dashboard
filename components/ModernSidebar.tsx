"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Target,
  Users,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV_LINKS, SECONDARY_NAV_LINKS, VOZUP_NAV_LINKS, type NavLink } from "@/lib/navLinks";
import type { DashboardUser } from "@/lib/auth";

const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  home: LayoutDashboard,
  treinamentos: CalendarDays,
  crm: Target,
  produtividade: ClipboardList,
  distribuicao: Send,
  recrutadores: Users,
  rede: Network,
  anamnese: FileText,
  relatorios: BarChart3,
  "encontro-online": Video,
  "vozup-leads": Users,
};

interface ModernSidebarProps {
  currentUser?: DashboardUser | null;
  duplicateCount?: number;
  isCollapsed: boolean;
  toggleSidebar: () => void;
  isMobileOpen?: boolean;
  closeMobileSidebar?: () => void;
}

function getInitials(user?: DashboardUser | null) {
  const source = user?.name || user?.email || "U";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("");
}

export default function ModernSidebar({
  currentUser,
  duplicateCount = 0,
  isCollapsed,
  toggleSidebar,
  isMobileOpen = false,
  closeMobileSidebar,
}: ModernSidebarProps) {
  const pathname = usePathname();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const showFullContent = !isCollapsed || isMobileOpen;
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  const isActivePath = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));
  const hasActiveSecondary = SECONDARY_NAV_LINKS.some((link) => isActivePath(link.href));
  const showSecondaryLinks = showFullContent && (isMoreOpen || hasActiveSecondary);

  function renderNavLinkVozup(link: NavLink) {
    const Icon = ICON_MAP[link.key] || Users;
    const isActive = isActivePath(link.href);

    return (
      <li key={link.key} className="w-full">
        <Link
          href={link.href}
          className={cn(
            "group flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium transition",
            showFullContent ? "w-full" : "mx-auto size-9 justify-center px-0",
            isActive
              ? "bg-[#3b1d8a]/20 text-[#a78bfa]"
              : "text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
          )}
          title={!showFullContent ? link.label : undefined}
        >
          <span className="relative flex size-5 items-center justify-center">
            <Icon size={17} className={cn("transition-colors", isActive ? "text-[#a78bfa]" : "text-[rgb(var(--slate-10))] group-hover:text-[#a78bfa]")} />
          </span>
          {showFullContent ? (
            <span className="truncate">{link.label}</span>
          ) : null}
        </Link>
      </li>
    );
  }

  function renderNavLink(link: NavLink, isSecondary = false) {
    const Icon = ICON_MAP[link.key] || LayoutDashboard;
    const isActive = isActivePath(link.href);
    const showBadge = link.key === "home" && duplicateCount > 0;

    return (
      <li key={link.key} className="w-full">
        <Link
          href={link.href}
          className={cn(
            "group flex items-center gap-2 rounded-lg px-2 font-medium transition",
            isSecondary ? "h-8 text-xs" : "h-9 text-sm",
            showFullContent ? "w-full" : "mx-auto size-9 justify-center px-0",
            isActive
              ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
              : "text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
          )}
          title={!showFullContent ? link.label : undefined}
        >
          <span className="relative flex size-5 items-center justify-center">
            <Icon size={isSecondary ? 16 : 17} />
            {showBadge && !showFullContent ? (
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[rgb(var(--ruby-9))]" />
            ) : null}
          </span>

          {showFullContent ? (
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{link.label}</span>
              {showBadge ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-[rgb(var(--ruby-9))] px-1.5 text-[11px] font-semibold text-white">
                  {duplicateCount > 99 ? "99+" : duplicateCount}
                </span>
              ) : null}
            </span>
          ) : null}
        </Link>
      </li>
    );
  }

  return (
    <>
      {isMobileOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/30 backdrop-blur-[1px] lg:hidden"
          onClick={closeMobileSidebar}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-11))] shadow-[1px_0_2px_rgba(28,32,36,0.02)] transition-all duration-200 ease-out lg:static",
          "w-64",
          isCollapsed ? "lg:w-16" : "lg:w-64",
          isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="grid gap-2 px-2 py-2">
          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              showFullContent ? "justify-between" : "justify-center"
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid size-8 flex-shrink-0 place-content-center">
                <Image
                  src="/logo-up.svg"
                  alt="Instituto UP"
                  width={24}
                  height={24}
                  className="size-6"
                />
              </div>
              {showFullContent ? (
                <>
                  <div className="h-3 w-px flex-shrink-0 bg-[rgb(var(--border-strong))]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-5 text-[rgb(var(--slate-12))]">
                      CRM
                    </p>
                    <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                      Pipeline comercial
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            <button
              onClick={toggleSidebar}
              className="hidden size-8 items-center justify-center rounded-lg text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))] lg:flex"
              title={isCollapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={isCollapsed ? "Expandir menu" : "Recolher menu"}
            >
              <ToggleIcon size={18} />
            </button>

            <button
              onClick={closeMobileSidebar}
              className="flex size-8 items-center justify-center rounded-lg text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))] lg:hidden"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className={cn("min-w-0 flex-1 overflow-y-auto px-2 py-2", showFullContent ? "" : "px-1")}>
          {/* ── Instituto UP ─────────────────────────────────── */}
          {showFullContent ? (
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--slate-9))]">
              Instituto UP
            </p>
          ) : null}
          <ul className={cn("m-0 flex list-none flex-col gap-1", !showFullContent ? "items-center" : "")}>
            {PRIMARY_NAV_LINKS.map((link) => renderNavLink(link))}
          </ul>

          {showFullContent ? (
            <div className="mt-3 border-t border-[rgb(var(--border-weak))] pt-3">
              <button
                type="button"
                onClick={() => setIsMoreOpen((value) => !value)}
                className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2 text-xs font-medium text-[rgb(var(--slate-10))] transition hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
                aria-expanded={showSecondaryLinks}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MoreHorizontal size={16} />
                  <span className="truncate">Mais ferramentas</span>
                </span>
                <ChevronDown
                  size={14}
                  className={cn("transition-transform", showSecondaryLinks ? "rotate-180" : "")}
                />
              </button>

              {showSecondaryLinks ? (
                <ul className="m-0 mt-1 flex list-none flex-col gap-1">
                  {SECONDARY_NAV_LINKS.map((link) => renderNavLink(link, true))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* ── VozUP ─────────────────────────────────────────── */}
          {!currentUser?.institutoUpOnly && (
            <div className="mt-4 border-t border-[rgb(var(--border-weak))] pt-4">
              {showFullContent ? (
                <div className="mb-1 flex items-center gap-1.5 px-2">
                  <span className="text-base leading-none">🎤</span>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a78bfa]">
                    VozUP
                  </p>
                </div>
              ) : (
                <div className="mb-1 flex justify-center">
                  <span className="text-base leading-none" title="VozUP">🎤</span>
                </div>
              )}
              <ul className={cn("m-0 flex list-none flex-col gap-1", !showFullContent ? "items-center" : "")}>
                {VOZUP_NAV_LINKS.map((link) => renderNavLinkVozup(link))}
              </ul>
            </div>
          )}
        </nav>

        <section className="relative flex flex-shrink-0 flex-col gap-1 border-t border-[rgb(var(--border-weak))] px-1.5 py-1.5 shadow-[0_-2px_4px_rgba(27,28,29,0.02)]">
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-[rgb(var(--slate-11))]",
              !showFullContent ? "justify-center" : ""
            )}
          >
            <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--blue-3))] text-xs font-semibold text-[rgb(var(--blue-11))]">
              {getInitials(currentUser)}
            </div>
            {showFullContent ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-5 text-[rgb(var(--slate-12))]">
                  {currentUser?.name || "Usuário"}
                </p>
                <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                  {currentUser?.email || "Sessao autenticada"}
                </p>
              </div>
            ) : null}
          </div>

          <form action="/logout" method="post">
            <button
              type="submit"
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-[rgb(var(--slate-11))] transition hover:bg-[rgb(var(--ruby-3))] hover:text-[rgb(var(--ruby-11))]",
                !showFullContent ? "justify-center px-0" : ""
              )}
              title="Sair"
            >
              <LogOut size={17} />
              {showFullContent ? <span>Sair</span> : null}
            </button>
          </form>
        </section>
      </aside>
    </>
  );
}
