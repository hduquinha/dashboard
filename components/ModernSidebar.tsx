"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Columns3,
  Inbox,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Network,
  PiggyBank,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Target,
  Users,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV_LINKS, SECONDARY_NAV_LINKS, VOZUP_NAV_LINKS, type NavLink } from "@/lib/navLinks";
import type { DashboardUser } from "@/lib/auth";
import { canViewNavLink } from "@/lib/permissions";

const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  home: LayoutDashboard,
  treinamentos: CalendarDays,
  crm: Target,
  produtividade: Columns3,
  distribuicao: Inbox,
  recrutadores: Users,
  rede: Network,
  anamnese: FileText,
  relatorios: BarChart3,
  "encontro-online": Video,
  "vozup-leads": Users,
  "vozup-financeiro": PiggyBank,
  usuarios: ShieldCheck,
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
  const visiblePrimaryLinks = PRIMARY_NAV_LINKS.filter((link) => canViewNavLink(currentUser, link.key));
  const visibleSecondaryLinks = SECONDARY_NAV_LINKS.filter((link) => canViewNavLink(currentUser, link.key));
  const visibleVozupLinks = VOZUP_NAV_LINKS.filter((link) => canViewNavLink(currentUser, link.key));
  const hasActiveSecondary = visibleSecondaryLinks.some((link) => isActivePath(link.href));
  const showSecondaryLinks = showFullContent && (isMoreOpen || hasActiveSecondary);

  function renderNavLink(link: NavLink, options?: { secondary?: boolean; vozup?: boolean }) {
    const Icon = ICON_MAP[link.key] || LayoutDashboard;
    const isActive = isActivePath(link.href);
    const showBadge = link.key === "home" && duplicateCount > 0;
    const label = options?.vozup && link.key === "vozup-leads" ? "Leads" : link.label;

    return (
      <li key={link.key} className="w-full">
        <Link
          href={link.href}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-4 font-semibold transition",
            options?.secondary ? "h-10 text-sm" : "h-11 text-sm",
            showFullContent ? "w-full" : "mx-auto size-10 justify-center px-0",
            isActive
              ? "bg-cyan-500/20 text-white shadow-[inset_3px_0_0_#08bfe8,0_14px_28px_rgba(6,168,216,0.12)]"
              : "text-slate-200/75 hover:bg-white/10 hover:text-white"
          )}
          title={!showFullContent ? label : undefined}
        >
          <span className="relative flex size-5 items-center justify-center">
            <Icon
              size={options?.secondary ? 17 : 18}
              className={cn(
                "transition-colors",
                isActive ? "text-cyan-200" : "text-slate-200/70 group-hover:text-cyan-100"
              )}
            />
            {showBadge && !showFullContent ? (
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-cyan-300" />
            ) : null}
          </span>

          {showFullContent ? (
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{label}</span>
              {showBadge ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-cyan-400 px-1.5 text-[11px] font-black text-slate-950">
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
          className="fixed inset-0 z-20 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          onClick={closeMobileSidebar}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-cyan-200/10 bg-[linear-gradient(180deg,#001b31_0%,#001526_55%,#00111f_100%)] text-white shadow-[18px_0_50px_rgba(1,16,31,0.24)] transition-all duration-200 ease-out lg:static",
          "w-[292px]",
          isCollapsed ? "lg:w-[76px]" : "lg:w-[292px]",
          isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="grid gap-2 px-5 py-7">
          <div
            className={cn(
              "flex min-w-0 items-center gap-3",
              showFullContent ? "justify-between" : "justify-center"
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              {showFullContent ? (
                <div className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG estatico da marca, sem otimizacao do next/image */}
                  <img
                    src="/vozup-logo-dark.svg"
                    alt="VozUP"
                    className="h-12 w-auto max-w-full"
                  />
                  <p className="mt-1 truncate text-lg font-medium leading-5 text-slate-200/80">
                    CRM
                  </p>
                </div>
              ) : (
                <div className="grid size-11 place-content-center rounded-xl bg-cyan-500/15 ring-1 ring-cyan-200/10">
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG estatico da marca */}
                  <img src="/vozup-logo-dark.svg" alt="VozUP" className="h-6 w-auto" />
                </div>
              )}
            </div>

            <button
              onClick={toggleSidebar}
              className="hidden size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200/70 hover:bg-white/10 hover:text-white lg:flex"
              title={isCollapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={isCollapsed ? "Expandir menu" : "Recolher menu"}
            >
              <ToggleIcon size={18} />
            </button>

            <button
              onClick={closeMobileSidebar}
              className="flex size-9 items-center justify-center rounded-lg text-slate-200/70 hover:bg-white/10 hover:text-white lg:hidden"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className={cn("min-w-0 flex-1 overflow-y-auto px-4 py-3", showFullContent ? "" : "px-2")}>
          {showFullContent ? (
            <p className="mb-4 px-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-200/70">
              Instituto UP
            </p>
          ) : null}
          <ul className={cn("m-0 flex list-none flex-col gap-2", !showFullContent ? "items-center" : "")}>
            {visiblePrimaryLinks.map((link) => renderNavLink(link))}
          </ul>

          {showFullContent && visibleSecondaryLinks.length > 0 ? (
            <div className="mt-5 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setIsMoreOpen((value) => !value)}
                className="flex h-10 w-full items-center justify-between gap-2 rounded-lg px-4 text-xs font-bold uppercase tracking-wide text-slate-200/70 transition hover:bg-white/10 hover:text-white"
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
                <ul className="m-0 mt-2 flex list-none flex-col gap-1.5">
                  {visibleSecondaryLinks.map((link) => renderNavLink(link, { secondary: true }))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {visibleVozupLinks.length > 0 && (
            <div className="mt-5 border-t border-white/10 pt-4">
              {showFullContent ? (
                <p className="mb-2 px-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-200/70">
                  VozUP
                </p>
              ) : (
                <div className="mb-1 flex justify-center">
                  <KeyRound size={16} className="text-slate-200/75" aria-label="VozUP" />
                </div>
              )}
              <ul className={cn("m-0 flex list-none flex-col gap-2", !showFullContent ? "items-center" : "")}>
                {visibleVozupLinks.map((link) => renderNavLink(link, { vozup: true }))}
              </ul>
            </div>
          )}
        </nav>

        <section className="relative flex flex-shrink-0 flex-col gap-3 border-t border-white/10 px-5 py-5 shadow-[0_-12px_30px_rgba(2,19,37,0.18)]">
          <div
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-lg px-1 py-1 text-slate-100/80",
              !showFullContent ? "justify-center" : ""
            )}
          >
            <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/25 text-sm font-black text-cyan-100 ring-1 ring-cyan-300/20">
              {getInitials(currentUser)}
            </div>
            {showFullContent ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold leading-5 text-white">
                  {currentUser?.name || "Usuário"}
                </p>
                <p className="truncate text-xs text-slate-200/60">
                  {currentUser?.email || "Sessao autenticada"}
                </p>
              </div>
            ) : null}
          </div>

          <form action="/logout" method="post">
            <button
              type="submit"
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-slate-100/80 transition hover:bg-white/10 hover:text-white",
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
