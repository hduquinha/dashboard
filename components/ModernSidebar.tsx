"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Backpack,
  BarChart3,
  Bell,
  BookOpen,
  ClipboardCheck,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Columns3,
  Compass,
  FileSearch,
  FileSignature,
  Filter,
  GraduationCap,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map,
  Megaphone,
  Network,
  PiggyBank,
  PanelLeftClose,
  PanelLeftOpen,
  School,
  ShieldCheck,
  Tags,
  Target,
  Ticket,
  TrendingUp,
  Users,
  Video,
  WalletCards,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FIXED_NAV_LINKS, NAV_SECTIONS, type NavLink } from "@/lib/navLinks";
import type { DashboardUser } from "@/lib/auth";
import { canViewNavLink } from "@/lib/permissions";

/**
 * Um ícone por item do menu — todos os itens, sem exceção.
 *
 * Faltavam dez chaves aqui e elas caíam no `LayoutDashboard` do fallback: o
 * menu exibia o MESMO desenho em Tarefas, Alunos, Turmas, Campanhas, Catálogo,
 * Funis, Cupons e nas duas auditorias, o que apagava a diferença entre as
 * seções. Ao criar um item novo em `lib/navLinks.ts`, registre o ícone aqui
 * também — o fallback existe só para não quebrar, não como padrão aceitável.
 */
const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  // Instituto UP
  home: LayoutDashboard,
  crm: Target,
  produtividade: Columns3,
  distribuicao: Inbox,
  treinamentos: CalendarDays,
  tarefas: ListChecks,
  "tarefas-auditoria": History,
  recrutadores: Compass,
  anamnese: ClipboardList,
  relatorios: BarChart3,
  "encontro-online": Video,
  cupons: Ticket,
  rede: Network,
  usuarios: ShieldCheck,
  funis: Filter,
  // VozUP
  "vozup-leads": Users,
  "vozup-rotas": Map,
  "vozup-auditoria": FileSearch,
  alunos: GraduationCap,
  turmas: BookOpen,
  chamada: ClipboardCheck,
  "vozup-financeiro": PiggyBank,
  matriculas: WalletCards,
  contratos: FileSignature,
  catalogo: Tags,
  campanhas: TrendingUp,
  // Fora das duas marcas
  notificacoes: Bell,
  // Pastas do menu
  "secao-instituto-up": School,
  "secao-pedagogico": Backpack,
  "secao-midia": Megaphone,
  "secao-financeiro": PiggyBank,
  "secao-admin": ShieldCheck,
};

/** Onde fica guardado quais pastas o usuário deixou abertas. */
const OPEN_SECTIONS_KEY = "vozup:menu-pastas-abertas";

/**
 * Entrada fixa do menu, fora de NAV_LINKS: notificação não pertence a
 * Instituto UP nem VozUP (é do usuário) e todo mundo que loga tem a sua.
 */
const NOTIFICATIONS_LINK: NavLink = {
  key: "notificacoes",
  href: "/notificacoes",
  label: "Notificações",
  description: "Avisos de leads novos, atribuições e leads parados",
};

interface ModernSidebarProps {
  currentUser?: DashboardUser | null;
  duplicateCount?: number;
  /** Notificações do site ainda não lidas — badge do item "Notificações". */
  unreadNotifications?: number;
  /**
   * Leads parados na Chegada de Leads. Acende o item do menu (contador + pulso
   * + fundo âmbar) porque lead esperando distribuição é trabalho represado: a
   * equipe precisa ver que tem gente na fila sem abrir a tela.
   */
  arrivalPending?: number;
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
  unreadNotifications = 0,
  arrivalPending = 0,
  isCollapsed,
  toggleSidebar,
  isMobileOpen = false,
  closeMobileSidebar,
}: ModernSidebarProps) {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<string[]>([]);
  const showFullContent = !isCollapsed || isMobileOpen;
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  const isActivePath = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  const visibleFixedLinks = FIXED_NAV_LINKS.filter((link) => canViewNavLink(currentUser, link.key));

  // Pasta sem nenhum item permitido não aparece — quem não tem acesso a nada
  // dentro dela não precisa nem saber que ela existe.
  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => {
        const links = section.links.filter((link) => canViewNavLink(currentUser, link.key));
        return { ...section, links, hasActive: links.some((link) => isActivePath(link.href)) };
      }).filter((section) => section.links.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isActivePath deriva de pathname
    [currentUser, pathname]
  );

  // Estado inicial: o que o usuário deixou aberto da última vez.
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(OPEN_SECTIONS_KEY);
      if (salvo) setOpenSections(JSON.parse(salvo) as string[]);
    } catch {
      // Navegador sem localStorage (aba anônima travada): segue com tudo fechado.
    }
  }, []);

  // A pasta da página aberta abre sozinha — inclusive quando se chega por link
  // direto, notificação ou push.
  //
  // O ajuste é feito DURANTE a renderização, não num efeito: num efeito, o
  // primeiro quadro sairia com a pasta fechada e ela abriria depois, piscando
  // na cara de quem acabou de navegar. É o mesmo padrão do fechamento do menu
  // no celular (ver DashboardLayoutClient).
  const activeSectionKey = visibleSections.find((section) => section.hasActive)?.key;
  const [lastActiveSection, setLastActiveSection] = useState<string | null>(null);
  if (activeSectionKey && activeSectionKey !== lastActiveSection) {
    setLastActiveSection(activeSectionKey);
    if (!openSections.includes(activeSectionKey)) {
      setOpenSections([...openSections, activeSectionKey]);
    }
  }

  function toggleSection(key: string) {
    setOpenSections((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      try {
        window.localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // Sem localStorage a preferência só não sobrevive ao recarregar.
      }
      return next;
    });
  }

  function renderNavLink(link: NavLink, options?: { secondary?: boolean }) {
    const Icon = ICON_MAP[link.key] || LayoutDashboard;
    const isActive = isActivePath(link.href);
    const badgeCount =
      link.key === "home"
        ? duplicateCount
        : link.key === "notificacoes"
        ? unreadNotifications
        : link.key === "distribuicao"
        ? arrivalPending
        : 0;
    const showBadge = badgeCount > 0;
    // Aviso de fila: só a Chegada de Leads pisca. Os outros badges são
    // informativos (duplicados, notificações lidas depois); este é uma chamada
    // para agir agora, e por isso ganha cor e movimento próprios.
    const isArrivalAlert = link.key === "distribuicao" && showBadge;
    const label = link.label;

    return (
      <li key={link.key} className="w-full">
        <Link
          href={link.href}
          title={
            isArrivalAlert
              ? `${label}: ${badgeCount} ${badgeCount === 1 ? "lead esperando" : "leads esperando"} distribuição`
              : !showFullContent
              ? label
              : undefined
          }
          // Fecha o menu no toque, sem esperar a navegação terminar. As páginas
          // são `force-dynamic`: esperar a troca de rota deixava o menu aberto
          // por cima da tela durante todo o render do servidor — que é o
          // "travamento" que a equipe via no celular. Fechando aqui, o usuário
          // vê o esqueleto de carregamento (`loading.tsx`) na hora.
          onClick={closeMobileSidebar}
          className={cn(
            "group flex items-center gap-3 rounded-xl px-3 font-semibold transition",
            options?.secondary ? "h-10 text-sm" : "h-11 text-sm",
            showFullContent ? "w-full" : "mx-auto size-11 justify-center px-0",
            isActive
              ? "bg-cyan-500/20 text-white shadow-[inset_3px_0_0_#08bfe8,0_14px_28px_rgba(6,168,216,0.12)]"
              : isArrivalAlert
              ? "bg-amber-400/15 text-white ring-1 ring-inset ring-amber-300/35 hover:bg-amber-400/25"
              : "text-slate-200/75 hover:bg-white/10 hover:text-white"
          )}
        >
          {/* O ícone mora numa pastilha, não solto sobre o fundo: é o que dá
              relevo ao menu e o que permite o item ativo (e o aviso da Chegada)
              serem lidos pela cor da pastilha, sem depender só do texto. */}
          <span
            className={cn(
              "relative flex flex-shrink-0 items-center justify-center rounded-xl transition",
              options?.secondary ? "size-8" : "size-9",
              isActive
                ? "bg-gradient-to-br from-[#22d3ee] to-[#0b8ba6] text-slate-950 shadow-[0_6px_16px_rgba(8,191,232,0.35)]"
                : isArrivalAlert
                ? "bg-amber-400 text-slate-950 shadow-[0_6px_16px_rgba(251,191,36,0.32)]"
                : "bg-white/[0.06] text-slate-200/70 ring-1 ring-inset ring-white/10 group-hover:bg-white/[0.14] group-hover:text-cyan-100 group-hover:ring-cyan-200/25"
            )}
          >
            <Icon size={options?.secondary ? 16 : 18} strokeWidth={2} />
            {/* Menu recolhido: o número não cabe, então o aviso vira um ponto.
                O da Chegada pulsa para não passar despercebido. */}
            {showBadge && !showFullContent ? (
              <span
                className={cn(
                  "absolute -right-1 -top-1 rounded-full ring-2 ring-[#001526]",
                  isArrivalAlert ? "size-2.5 bg-amber-400" : "size-2 bg-cyan-300"
                )}
              >
                {isArrivalAlert ? (
                  <span className="absolute inset-0 animate-ping rounded-full bg-amber-300" aria-hidden />
                ) : null}
              </span>
            ) : null}
          </span>

          {showFullContent ? (
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{label}</span>
              {showBadge ? (
                <span
                  className={cn(
                    "relative flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-black text-slate-950",
                    isArrivalAlert ? "bg-amber-400" : "bg-cyan-400"
                  )}
                >
                  {isArrivalAlert ? (
                    <span
                      className="absolute inset-0 animate-ping rounded-md bg-amber-400/60"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative">{badgeCount > 99 ? "99+" : badgeCount}</span>
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
        id="menu-lateral"
        // `transition-transform` em vez de `transition-all`: animar "todas as
        // propriedades" força o navegador a recalcular layout a cada quadro e
        // engasga em celular mais fraco. Só o deslize precisa de animação.
        //
        // `pt-[env(safe-area-inset-top)]` e o `pb` equivalente mantêm topo e
        // rodapé do menu fora do notch e da barrinha inicial do iPhone.
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-cyan-200/10 bg-[linear-gradient(180deg,#001b31_0%,#001526_55%,#00111f_100%)] text-white shadow-[18px_0_50px_rgba(1,16,31,0.24)] transition-transform duration-200 ease-out lg:static lg:transition-all print:hidden",
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:pt-0 lg:pb-0",
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

        {/* `overscroll-contain`: ao chegar no fim da lista, o gesto para aqui em
            vez de continuar rolando a página atrás do menu — o encadeamento de
            rolagem do iOS era o que fazia o menu "pular" ao arrastar o dedo. */}
        <nav
          className={cn(
            "min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3",
            showFullContent ? "" : "px-2"
          )}
        >
          <ul
            className={cn(
              "m-0 mb-4 flex list-none flex-col gap-2 border-b border-white/10 pb-4",
              !showFullContent ? "items-center" : ""
            )}
          >
            {renderNavLink(NOTIFICATIONS_LINK)}
            {visibleFixedLinks.map((link) => renderNavLink(link))}
          </ul>

          {/* Pastas: o que não é do dia a dia fica guardado por assunto. Uma
              pasta abre sozinha quando a página aberta está dentro dela — quem
              chegou por link direto não precisa caçar onde o item mora. */}
          {visibleSections.map((section) => {
            const SectionIcon = ICON_MAP[section.icon] ?? LayoutDashboard;
            const isOpen = openSections.includes(section.key);

            if (!showFullContent) {
              // Menu recolhido não tem espaço para a lista: o ícone da pasta
              // abre o menu e já deixa a pasta aberta.
              return (
                <div key={section.key} className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSections((current) =>
                        current.includes(section.key) ? current : [...current, section.key]
                      );
                      toggleSidebar();
                    }}
                    title={section.label}
                    aria-label={`Abrir ${section.label}`}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl transition",
                      section.hasActive
                        ? "bg-cyan-500/20 text-cyan-100"
                        : "text-slate-200/70 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <SectionIcon size={18} />
                  </button>
                </div>
              );
            }

            return (
              <div key={section.key} className="mt-4 border-t border-white/10 pt-3">
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  aria-expanded={isOpen}
                  className={cn(
                    "flex h-10 w-full items-center justify-between gap-2 rounded-xl px-3 text-[11px] font-black uppercase tracking-[0.14em] transition",
                    section.hasActive
                      ? "text-cyan-100 hover:bg-white/10"
                      : "text-slate-200/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-lg ring-1 ring-inset transition",
                        section.hasActive
                          ? "bg-cyan-500/25 text-cyan-100 ring-cyan-200/25"
                          : "bg-white/[0.06] text-slate-200/70 ring-white/10"
                      )}
                    >
                      <SectionIcon size={15} />
                    </span>
                    <span className="truncate">{section.label}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {/* Fechada, a pasta ainda avisa quantos itens tem lá dentro. */}
                    {!isOpen ? (
                      <span className="text-[10px] font-bold text-slate-200/40">
                        {section.links.length}
                      </span>
                    ) : null}
                    <ChevronDown
                      size={14}
                      className={cn("transition-transform", isOpen ? "rotate-180" : "")}
                    />
                  </span>
                </button>

                {isOpen ? (
                  <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 pl-2">
                    {section.links.map((link) => renderNavLink(link, { secondary: true }))}
                  </ul>
                ) : null}
              </div>
            );
          })}
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
