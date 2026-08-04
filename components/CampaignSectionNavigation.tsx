"use client";

import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  Sparkles,
  Split,
  Target,
  Users,
} from "lucide-react";
import type { CampanhasTab } from "@/types/metaAds";

interface CampaignTabOption {
  key: CampanhasTab;
  label: string;
  description: string;
  icon: typeof Sparkles;
}

interface CampaignNavGroup {
  key: string;
  label: string;
  description: string;
  icon: typeof Sparkles;
  tabs: CampanhasTab[];
}

export const CAMPAIGN_TAB_OPTIONS: CampaignTabOption[] = [
  {
    key: "inteligencia",
    label: "Painel completo",
    description: "Indicadores, funil, criativos e alertas",
    icon: LayoutDashboard,
  },
  { key: "geral", label: "Funil e evolução", description: "Jornada comercial e gráficos do período", icon: Sparkles },
  {
    key: "relatorio",
    label: "Relatório mensal",
    description: "Gasto e retorno do mês, pronto para apresentar",
    icon: FileText,
  },
  { key: "comparativos", label: "Comparativos", description: "Melhores, piores e concentração de resultado", icon: BarChart3 },
  { key: "alcance", label: "Alcance e engajamento", description: "Impressões, vídeo e interações", icon: Eye },
  { key: "grupos", label: "Destinos", description: "Formulário nativo × landing pages", icon: Split },
  { key: "horarios", label: "Horários", description: "Quando os leads chegam e avançam", icon: Clock },
  { key: "diario", label: "Dia a dia", description: "Gasto, leads e custo médio por data", icon: CalendarDays },
  { key: "tabela", label: "Estrutura", description: "Campanha → conjunto → anúncio", icon: ListTree },
  { key: "anuncios", label: "Criativos", description: "Peças, vídeos e resultado por card", icon: LayoutGrid },
  { key: "leads", label: "Últimos leads", description: "Pessoas, anúncios e etapa atual", icon: Inbox },
  {
    key: "rendimento",
    label: "Rendimento do lead",
    description: "Onde cada origem parou no funil, filtro a filtro",
    icon: GitBranch,
  },
  { key: "vendedores", label: "Vendedores", description: "Conversão e valor por vendedor", icon: Users },
];

const NAV_GROUPS: CampaignNavGroup[] = [
  {
    key: "resumo",
    label: "Resumo",
    description: "Decisão e evolução",
    icon: Target,
    tabs: ["inteligencia", "geral", "relatorio"],
  },
  {
    key: "analises",
    label: "Análises",
    description: "Mídia e eficiência",
    icon: BarChart3,
    tabs: ["comparativos", "alcance", "grupos", "horarios", "diario"],
  },
  {
    key: "campanhas",
    label: "Campanhas e anúncios",
    description: "Estrutura e peças",
    icon: LayoutGrid,
    tabs: ["tabela", "anuncios"],
  },
  {
    key: "comercial",
    label: "Leads e vendas",
    description: "Pessoas e equipe",
    icon: Users,
    tabs: ["leads", "rendimento", "vendedores"],
  },
];

const TAB_BY_KEY = new Map(CAMPAIGN_TAB_OPTIONS.map((option) => [option.key, option]));

interface CampaignSectionNavigationProps {
  tab: CampanhasTab;
  hiddenTabs: string[];
  onChange: (tab: CampanhasTab) => void;
}

export default function CampaignSectionNavigation({
  tab,
  hiddenTabs,
  onChange,
}: CampaignSectionNavigationProps) {
  const activeGroup = NAV_GROUPS.find((group) => group.tabs.includes(tab)) ?? NAV_GROUPS[0];
  const visibleGroups = NAV_GROUPS.filter(
    (group) => group.key === activeGroup.key || group.tabs.some((key) => !hiddenTabs.includes(key))
  );
  const activeTabs = activeGroup.tabs
    .filter((key) => key === tab || !hiddenTabs.includes(key))
    .map((key) => TAB_BY_KEY.get(key))
    .filter((option): option is CampaignTabOption => Boolean(option));

  function openGroup(group: CampaignNavGroup) {
    const firstVisible = group.tabs.find((key) => !hiddenTabs.includes(key)) ?? group.tabs[0];
    onChange(firstVisible);
  }

  return (
    <nav
      aria-label="Navegação das métricas de campanha"
      className="overflow-visible rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
    >
      <div className="grid grid-cols-2 gap-1 p-2 lg:grid-cols-4">
        {visibleGroups.map((group) => {
          const active = group.key === activeGroup.key;
          return (
            <button
              key={group.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => openGroup(group)}
              className={`flex min-h-16 items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                active
                  ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                  : "text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
              }`}
            >
              <span
                className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${
                  active ? "bg-[rgb(var(--surface-1))]" : "bg-[rgb(var(--slate-3))]"
                }`}
              >
                <group.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{group.label}</span>
                <span className="mt-0.5 hidden text-[11px] leading-tight text-[rgb(var(--slate-9))] sm:block">
                  {group.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative border-t border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-3 py-3">
        <div className="flex items-start gap-2">
          <div aria-label={`Atalhos de ${activeGroup.label}`} className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {activeTabs.map((option) => {
              const active = option.key === tab;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  title={option.description}
                  onClick={() => onChange(option.key)}
                  className={`flex min-h-10 flex-none items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "border-[rgb(var(--blue-7))] bg-[rgb(var(--surface-1))] text-[rgb(var(--blue-11))] shadow-sm"
                      : "border-transparent text-[rgb(var(--slate-10))] hover:border-[rgb(var(--border-weak))] hover:bg-[rgb(var(--surface-1))]"
                  }`}
                >
                  <option.icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <details className="group relative flex-none">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-2 text-xs font-semibold text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]">
              Todas as visões
              <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-[min(34rem,calc(100vw-3rem))] rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3 shadow-xl">
              <div className="grid gap-3 sm:grid-cols-2">
                {NAV_GROUPS.map((group) => (
                  <div key={group.key}>
                    <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                      {group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.tabs.map((key) => {
                        const option = TAB_BY_KEY.get(key);
                        if (!option) return null;
                        const active = key === tab;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-current={active ? "page" : undefined}
                            onClick={() => onChange(key)}
                            className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left ${
                              active ? "bg-[rgb(var(--blue-3))]" : "hover:bg-[rgb(var(--slate-2))]"
                            }`}
                          >
                            <option.icon className="mt-0.5 h-4 w-4 flex-none text-[rgb(var(--blue-9))]" />
                            <span>
                              <span className="block text-xs font-semibold text-[rgb(var(--slate-12))]">{option.label}</span>
                              <span className="block text-[10px] leading-snug text-[rgb(var(--slate-9))]">{option.description}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
        <p className="mt-1 text-xs text-[rgb(var(--slate-9))]">{TAB_BY_KEY.get(tab)?.description}</p>
      </div>
    </nav>
  );
}
