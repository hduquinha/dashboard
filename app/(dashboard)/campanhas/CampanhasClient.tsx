"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, LayoutGrid, ListTree, RefreshCw, Sparkles, Users } from "lucide-react";
import CampaignAdsGallery from "@/components/CampaignAdsGallery";
import CampaignOverviewTab from "@/components/CampaignOverviewTab";
import CampaignTableTab from "@/components/CampaignTableTab";
import RecentLeadsTab from "@/components/RecentLeadsTab";
import SellerPerformanceTab from "@/components/SellerPerformanceTab";
import type {
  CampaignGroup,
  CampanhasTab,
  DailySeriesPoint,
  FunnelStageDef,
  FunnelStagePoint,
  KpiTotals,
  MetaAdsFilters,
  MetaAdsStatusFilter,
  RecentAdLead,
  SellerAdPerformance,
  SyncRunSummary,
} from "@/types/metaAds";

interface CampanhasClientProps {
  filters: MetaAdsFilters;
  preset: "7d" | "14d" | "30d" | "custom";
  tab: CampanhasTab;
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  hierarchy: CampaignGroup[];
  kpis: KpiTotals;
  series: DailySeriesPoint[];
  syncRuns: SyncRunSummary[];
  stageDefs: FunnelStageDef[];
  initialFunnel: FunnelStagePoint[];
  recentLeads: RecentAdLead[];
  sellerPerformance: SellerAdPerformance[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

const PERIOD_OPTIONS: Array<{ key: "7d" | "14d" | "30d" | "custom"; label: string }> = [
  { key: "7d", label: "7 dias" },
  { key: "14d", label: "14 dias" },
  { key: "30d", label: "30 dias" },
  { key: "custom", label: "Personalizado" },
];

const STATUS_OPTIONS: Array<{ key: MetaAdsStatusFilter; label: string }> = [
  { key: "active", label: "Ativas" },
  { key: "inactive", label: "Inativas" },
  { key: "all", label: "Todas" },
];

const TAB_OPTIONS: Array<{ key: CampanhasTab; label: string; description: string; icon: typeof Sparkles }> = [
  { key: "geral", label: "Visão Geral", description: "KPIs, funil e gráficos do período", icon: Sparkles },
  { key: "tabela", label: "Campanhas", description: "Abre campanha → conjunto → anúncio", icon: ListTree },
  { key: "anuncios", label: "Anúncios", description: "Criativo, vídeo e resultado por card", icon: LayoutGrid },
  { key: "leads", label: "Últimos Leads", description: "Quem chegou, de qual anúncio e etapa", icon: Inbox },
  { key: "vendedores", label: "Vendedores", description: "Leads e conversão por vendedor", icon: Users },
];

export default function CampanhasClient({
  filters,
  preset,
  tab,
  selectedCampaignId,
  selectedAdsetId,
  hierarchy,
  kpis,
  series,
  syncRuns,
  stageDefs,
  initialFunnel,
  recentLeads,
  sellerPerformance,
}: CampanhasClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.search ?? "");
  const [customFrom, setCustomFrom] = useState(filters.from);
  const [customTo, setCustomTo] = useState(filters.to);
  const [syncing, setSyncing] = useState(false);

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function handlePeriodClick(key: "7d" | "14d" | "30d" | "custom") {
    if (key === "custom") {
      updateQuery({ periodo: "custom", from: customFrom, to: customTo });
    } else {
      updateQuery({ periodo: key, from: null, to: null });
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateQuery({ q: search || null });
  }

  function handleTabChange(key: CampanhasTab) {
    updateQuery({ aba: key === "geral" ? null : key });
  }

  function handleCampaignChange(campaignId: string | null) {
    updateQuery({ campanha: campaignId, conjunto: null });
  }

  function handleAdsetChange(adsetId: string | null) {
    updateQuery({ conjunto: adsetId });
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await fetch("/api/campanhas/sync-now", { method: "POST" });
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  const lastSync = syncRuns[0] ?? null;
  const lastMetaSync = syncRuns.find((run) => !run.syncType.startsWith("google_")) ?? null;
  const lastGoogleSync = syncRuns.find((run) => run.syncType.startsWith("google_")) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[rgb(var(--slate-12))]">Métricas de Campanha</h1>
          <p className="text-sm text-[rgb(var(--slate-10))]">
            Gasto, leads e qualificação real por anúncio. Meta: {timeAgo(lastMetaSync?.finishedAt ?? null)} · Google:{" "}
            {timeAgo(lastGoogleSync?.finishedAt ?? null)}. Última sincronização: {timeAgo(lastSync?.finishedAt ?? null)}
            {lastSync?.status === "error" ? " (última tentativa falhou)" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={syncing}
          className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-2 text-sm font-medium text-[rgb(var(--slate-12))] shadow-sm hover:bg-[rgb(var(--slate-2))] disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Atualizar agora
        </button>
      </div>

      {/* Filtros globais do período e do inventário — compartilhados pelas 3 abas abaixo. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
        <div className="flex flex-wrap gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="Período das métricas">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={preset === option.key}
              onClick={() => handlePeriodClick(option.key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                preset === option.key
                  ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                  : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Data inicial"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-xs"
            />
            <span className="text-xs text-[rgb(var(--slate-9))]">até</span>
            <input
              type="date"
              aria-label="Data final"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => updateQuery({ periodo: "custom", from: customFrom, to: customTo })}
              className="rounded-md bg-[rgb(var(--blue-9))] px-2.5 py-1 text-xs font-medium text-white"
            >
              Aplicar
            </button>
          </div>
        )}

        <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="Status efetivo dos anúncios">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filters.status === option.key}
              onClick={() => updateQuery({ status: option.key })}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                filters.status === option.key
                  ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                  : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} className="ml-auto flex items-center gap-2">
          <label htmlFor="campaign-search" className="sr-only">
            Buscar campanha, conjunto ou anúncio
          </label>
          <input
            id="campaign-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campanha, conjunto ou anúncio..."
            className="rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-1.5 text-xs font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))]"
          >
            Buscar
          </button>
        </form>

        {isPending && <span className="text-xs text-[rgb(var(--slate-9))]">Atualizando…</span>}
      </div>

      {/* Navegação por abas — cada uma é uma tela dedicada dentro do mesmo setor. */}
      <div role="tablist" aria-label="Seções de Métricas de Campanha" className="flex flex-wrap gap-2 border-b border-[rgb(var(--border-weak))]">
        {TAB_OPTIONS.map((option) => {
          const active = tab === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleTabChange(option.key)}
              className={`flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition ${
                active
                  ? "border-[rgb(var(--blue-9))] text-[rgb(var(--blue-11))]"
                  : "border-transparent text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
              }`}
            >
              <option.icon className="h-4 w-4" />
              <span className="flex flex-col items-start leading-tight">
                {option.label}
                <span className="hidden text-[10px] font-normal text-[rgb(var(--slate-9))] sm:block">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {tab === "geral" && (
        <CampaignOverviewTab
          hierarchy={hierarchy}
          kpis={kpis}
          series={series}
          initialFunnel={initialFunnel}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "tabela" && <CampaignTableTab hierarchy={hierarchy} />}

      {tab === "anuncios" && (
        <CampaignAdsGallery
          hierarchy={hierarchy}
          stageDefs={stageDefs}
          filters={{ from: filters.from, to: filters.to }}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "leads" && (
        <RecentLeadsTab leads={recentLeads} scoped={Boolean(selectedCampaignId || selectedAdsetId)} />
      )}

      {tab === "vendedores" && (
        <SellerPerformanceTab sellers={sellerPerformance} scoped={Boolean(selectedCampaignId || selectedAdsetId)} />
      )}
    </div>
  );
}
