"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import CampaignAdsGallery from "@/components/CampaignAdsGallery";
import CampaignCompareTab from "@/components/CampaignCompareTab";
import CampaignDailyTab from "@/components/CampaignDailyTab";
import CampaignGroupsTab from "@/components/CampaignGroupsTab";
import CampaignHoursTab from "@/components/CampaignHoursTab";
import CampaignLeadYieldTab from "@/components/CampaignLeadYieldTab";
import CampaignMonthlyReportTab from "@/components/CampaignMonthlyReportTab";
import CampaignOverviewTab from "@/components/CampaignOverviewTab";
import CampaignIntelligenceTab from "@/components/CampaignIntelligenceTab";
import CampaignCustomizeMenu from "@/components/CampaignCustomizeMenu";
import CampaignReachTab from "@/components/CampaignReachTab";
import CampaignSectionNavigation, {
  CAMPAIGN_TAB_OPTIONS,
} from "@/components/CampaignSectionNavigation";
import LeadProfileLauncher from "@/components/LeadProfileLauncher";
import MetaReconciliationPanel from "@/components/MetaReconciliationPanel";
import { PURPOSE_LABELS, type CampaignPurposeFilter } from "@/lib/campaignObjectives";
import type { MonthlyReport } from "@/lib/monthlyReport";
import type { InstagramProfileSeries } from "@/lib/instagramProfiles";
import type { TrainingOption } from "@/types/training";
import CampaignTableTab from "@/components/CampaignTableTab";
import RecentLeadsTab from "@/components/RecentLeadsTab";
import SellerPerformanceTab from "@/components/SellerPerformanceTab";
import type {
  AdLeadDetail,
  CampaignGroup,
  CampanhasTab,
  DailyAdRow,
  DailySeriesPoint,
  FunnelStageDef,
  FunnelStagePoint,
  KpiTotals,
  MetaAdsFilters,
  MetaAdsStatusFilter,
  MetaReconciliation,
  PeriodReachData,
  RecentAdLead,
  SellerAdPerformance,
  SyncRunSummary,
} from "@/types/metaAds";

interface CampanhasClientProps {
  filters: MetaAdsFilters;
  preset: "hoje" | "7d" | "14d" | "30d" | "custom";
  tab: CampanhasTab;
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  hierarchy: CampaignGroup[];
  kpis: KpiTotals;
  /** Alcance deduplicado da Meta para a janela, por conta/campanha/conjunto. */
  periodReach: PeriodReachData;
  /** Conferência da janela contra o gerenciador (ver getMetaReconciliation). */
  reconciliation: MetaReconciliation;
  /** O recorte atual corresponde a um objeto inteiro da Meta (sem filtro de
   * status, busca ou propósito) — só aí o alcance dela vale para esta tela. */
  periodReachExact: boolean;
  series: DailySeriesPoint[];
  syncRuns: SyncRunSummary[];
  stageDefs: FunnelStageDef[];
  initialFunnel: FunnelStagePoint[];
  recentLeads: RecentAdLead[];
  sellerPerformance: SellerAdPerformance[];
  /** Linhas (dia × anúncio) da aba "Dia a dia"; vem vazio nas outras abas. */
  dailyRows: DailyAdRow[];
  /** Um lead por linha, das abas "Horários" e "Grupos"; vazio nas outras. */
  adLeads: AdLeadDetail[];
  /** Série de seguidores do Instagram; só vem na aba Alcance. */
  instagramProfiles: InstagramProfileSeries[];
  /** Relatório do mês; só vem na aba Relatório mensal. */
  monthlyReport: MonthlyReport | null;
  /** Meses com entrega registrada, para o seletor do relatório. */
  reportMonths: string[];
  /** Ticket médio salvo pela pessoa, usado para estimar o retorno. */
  reportTicket: number | null;
  /** Etapa do funil que a operação considera venda fechada. */
  reportSaleStage: string | null;
  purposeFilter: CampaignPurposeFilter;
  /** Quantos anúncios existem de cada tipo no período, para o filtro dizer se
   * há campanha de engajamento no ar em vez de mostrar uma aba vazia. */
  purposeCounts: { captacao: number; engajamento: number };
  /** Repassados à ficha do lead, que é a mesma do /crm. */
  trainingOptions: TrainingOption[];
  recruiterOptions: Array<{ code: string; name: string }>;
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

const PERIOD_OPTIONS: Array<{ key: "hoje" | "7d" | "14d" | "30d" | "custom"; label: string; hint: string }> = [
  { key: "hoje", label: "Hoje", hint: "Só o dia corrente, ainda em andamento." },
  { key: "7d", label: "7 dias", hint: "Últimos 7 dias fechados (termina ontem), igual ao gerenciador da Meta." },
  { key: "14d", label: "14 dias", hint: "Últimos 14 dias fechados (termina ontem), igual ao gerenciador da Meta." },
  { key: "30d", label: "30 dias", hint: "Últimos 30 dias fechados (termina ontem), igual ao gerenciador da Meta." },
  { key: "custom", label: "Personalizado", hint: "Escolher as datas de início e fim." },
];

/** "2026-07-27" → "27 jul". */
function formatIsoDayShort(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

const PURPOSE_FILTER_OPTIONS: Array<{ key: CampaignPurposeFilter; label: string; hint: string }> = [
  { key: "todas", label: "Tudo", hint: "Captação e engajamento juntos." },
  { key: "captacao", label: PURPOSE_LABELS.captacao, hint: "Só campanhas com formulário, que geram lead." },
  { key: "engajamento", label: PURPOSE_LABELS.engajamento, hint: "Só campanhas de aparecer: alcance, visualização e interação." },
];

// "Todas" primeiro e como padrão: é o recorte que fecha com a Meta. Os outros
// dois filtram a LISTAGEM por status de hoje e, com isso, deixam de somar parte
// do que foi gasto no período — daí o aviso ao lado.
const STATUS_OPTIONS: Array<{ key: MetaAdsStatusFilter; label: string; hint: string }> = [
  { key: "all", label: "Todas", hint: "Tudo que entregou no período — é este recorte que bate com o gerenciador da Meta." },
  { key: "active", label: "Ativas", hint: "Só anúncios ativos agora. Esconde o gasto de quem foi pausado dentro do período." },
  { key: "inactive", label: "Inativas", hint: "Só anúncios pausados/encerrados agora." },
];

export default function CampanhasClient({
  filters,
  preset,
  tab,
  selectedCampaignId,
  selectedAdsetId,
  hierarchy,
  kpis,
  periodReach,
  periodReachExact,
  reconciliation,
  series,
  syncRuns,
  stageDefs,
  initialFunnel,
  recentLeads,
  sellerPerformance,
  dailyRows,
  adLeads,
  instagramProfiles,
  monthlyReport,
  reportMonths,
  reportTicket,
  reportSaleStage,
  purposeFilter,
  purposeCounts,
  trainingOptions,
  recruiterOptions,
}: CampanhasClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.search ?? "");
  const [customFrom, setCustomFrom] = useState(filters.from);
  const [customTo, setCustomTo] = useState(filters.to);
  const [syncing, setSyncing] = useState(false);
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  // As preferências chegam depois do primeiro paint (uma chamada só): a tela
  // abre completa e some o que a pessoa escondeu, em vez de piscar vazia.
  useEffect(() => {
    let active = true;
    fetch("/api/ui-prefs?scope=campanhas")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { prefs?: { hiddenTabs?: unknown } } | null) => {
        if (!active || !Array.isArray(data?.prefs?.hiddenTabs)) return;
        setHiddenTabs(data.prefs.hiddenTabs.filter((item): item is string => typeof item === "string"));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function handleHiddenTabsChange(next: string[]) {
    setHiddenTabs(next);
    setPrefsSaving(true);
    setPrefsError(null);
    try {
      const response = await fetch("/api/ui-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "campanhas", prefs: { hiddenTabs: next } }),
      });
      if (!response.ok) throw new Error("Não deu para salvar agora.");
    } catch (error) {
      setPrefsError(error instanceof Error ? error.message : "Não deu para salvar agora.");
    } finally {
      setPrefsSaving(false);
    }
  }

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function handlePeriodClick(key: "hoje" | "7d" | "14d" | "30d" | "custom") {
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
    updateQuery({ aba: key === "inteligencia" ? null : key });
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
    <LeadProfileLauncher trainingOptions={trainingOptions} recruiterOptions={recruiterOptions}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[rgb(var(--slate-12))] print:hidden">Métricas de Campanha</h1>
          <p className="text-sm text-[rgb(var(--slate-10))] print:hidden">
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

      {/* Período e busca ficam sempre visíveis; controles menos usados ficam
          recolhidos para a página começar limpa. */}
      <section
        aria-label="Filtros das métricas de campanha"
        className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3 print:hidden"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="Período das métricas">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={preset === option.key}
                title={option.hint}
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

          {/* Deixar a janela escrita na tela é o que permite conferir contra o
              gerenciador sem adivinhar se "7 dias" inclui hoje. */}
          <span className="text-xs text-[rgb(var(--slate-10))]">
            {filters.from === filters.to
              ? formatIsoDayShort(filters.from)
              : `${formatIsoDayShort(filters.from)} – ${formatIsoDayShort(filters.to)}`}
          </span>

          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Data inicial"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-xs"
              />
              <span className="text-xs text-[rgb(var(--slate-9))]">até</span>
              <input
                type="date"
                aria-label="Data final"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
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
          ) : null}

          <form onSubmit={handleSearchSubmit} className="ml-auto flex min-w-[15rem] flex-1 items-center gap-2 sm:max-w-md">
            <label htmlFor="campaign-search" className="sr-only">
              Buscar campanha, conjunto ou anúncio
            </label>
            <input
              id="campaign-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar campanha, conjunto ou anúncio..."
              className="min-w-0 flex-1 rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="min-h-9 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-1.5 text-xs font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))]"
            >
              Buscar
            </button>
          </form>

          {isPending ? <span className="text-xs text-[rgb(var(--slate-9))]">Atualizando…</span> : null}
        </div>

        <details className="mt-3 border-t border-[rgb(var(--border-weak))] pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]">
            <SlidersHorizontal className="h-4 w-4" />
            Mais filtros e personalização
            {filters.status !== "all" || purposeFilter !== "todas" ? (
              <span className="rounded-full bg-[rgb(var(--blue-3))] px-2 py-0.5 text-[10px] text-[rgb(var(--blue-11))]">
                filtro ativo
              </span>
            ) : null}
          </summary>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="Status efetivo dos anúncios">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={filters.status === option.key}
                  title={option.hint}
                  onClick={() => updateQuery({ status: option.key === "all" ? null : option.key })}
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

            {purposeCounts.engajamento > 0 && purposeCounts.captacao > 0 ? (
              <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" aria-label="Tipo de campanha">
                {PURPOSE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={purposeFilter === option.key}
                    title={option.hint}
                    onClick={() => updateQuery({ tipo: option.key === "todas" ? null : option.key })}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      purposeFilter === option.key
                        ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                        : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            <CampaignCustomizeMenu
              items={CAMPAIGN_TAB_OPTIONS.map((option) => ({
                key: option.key,
                label: option.label,
                description: option.description,
                locked: option.key === "inteligencia",
              }))}
              hidden={hiddenTabs}
              onChange={handleHiddenTabsChange}
              saving={prefsSaving}
              error={prefsError}
            />
          </div>
        </details>
      </section>

      <MetaReconciliationPanel data={reconciliation} />

      <CampaignSectionNavigation tab={tab} hiddenTabs={hiddenTabs} onChange={handleTabChange} />

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

      {tab === "inteligencia" && (
        <CampaignIntelligenceTab
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          periodReach={periodReach}
          periodReachExact={periodReachExact}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "relatorio" && monthlyReport && (
        <CampaignMonthlyReportTab
          report={monthlyReport}
          months={reportMonths}
          stageDefs={stageDefs}
          ticketMedio={reportTicket}
          saleStageKey={reportSaleStage}
          onMonthChange={(month) => updateQuery({ mes: month })}
        />
      )}

      {tab === "comparativos" && (
        <CampaignCompareTab
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "alcance" && (
        <CampaignReachTab
          hierarchy={hierarchy}
          series={series}
          instagramProfiles={instagramProfiles}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          periodReach={periodReach}
          periodReachExact={periodReachExact}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "grupos" && (
        <CampaignGroupsTab
          hierarchy={hierarchy}
          leads={adLeads}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "horarios" && (
        <CampaignHoursTab
          leads={adLeads}
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "diario" && (
        <CampaignDailyTab
          rows={dailyRows}
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={handleCampaignChange}
          onAdsetChange={handleAdsetChange}
        />
      )}

      {tab === "tabela" && <CampaignTableTab hierarchy={hierarchy} filters={filters} stageDefs={stageDefs} />}

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

      {/* Os dados vêm por conta própria (uma pessoa por linha, com a trilha de
          etapas): o recorte desta aba é por ORIGEM do formulário, não por
          anúncio, então ela não usa a hierarquia de campanhas das outras. */}
      {tab === "rendimento" && <CampaignLeadYieldTab from={filters.from} to={filters.to} />}

      {tab === "vendedores" && (
        <SellerPerformanceTab sellers={sellerPerformance} scoped={Boolean(selectedCampaignId || selectedAdsetId)} />
      )}
    </div>
    </LeadProfileLauncher>
  );
}
