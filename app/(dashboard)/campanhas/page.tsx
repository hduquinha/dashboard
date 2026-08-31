import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CampanhasClient from "./CampanhasClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { matchesPurposeFilter, parsePurposeFilter } from "@/lib/campaignObjectives";
import { listRecruitersWithDbNames, listTrainingFilterOptions } from "@/lib/db";
import { getLatestGoogleAdsSyncRuns } from "@/lib/googleAds";
import { getGoogleAdsReport, type GoogleAdsReport } from "@/lib/googleAdsReport";
import { getReportSegments, type ReportSegmentsData } from "@/lib/reportSegments";
import type { LeadLocationOption } from "@/lib/leadLocation";
import { getInstagramProfileSeries, type InstagramProfileSeries } from "@/lib/instagramProfiles";
import type { MonthlyReport } from "@/lib/monthlyReport";
import { loadCampaignReport } from "@/lib/monthlyReportData";
import { hasPermission } from "@/lib/permissions";
import { ttlCache } from "@/lib/serverCache";
import { getUiPreferences, readPositiveNumber, readString } from "@/lib/uiPreferences";
import {
  computeKpiTotals,
  buildHierarchyTree,
  getAdLeadDetails,
  getAdLeadLocations,
  getAdsHierarchy,
  getDailyAdRows,
  getDailySeries,
  getDefaultFunnelStages,
  getFunnelBreakdown,
  getLatestSyncRuns,
  getMetaAdsToday,
  getMetaReconciliation,
  getPeriodReach,
  getRecentAdLeads,
  getSellerAdPerformance,
  shiftIsoDate,
} from "@/lib/metaAds";
import type {
  AdLeadDetail,
  CampanhasTab,
  DailyAdRow,
  MetaAdsFilters,
  MetaAdsStatusFilter,
  RecentAdLead,
  SellerAdPerformance,
} from "@/types/metaAds";

export const metadata: Metadata = {
  title: "Métricas de Campanha",
  description: "Gasto, leads e qualificação real por anúncio do Meta Ads.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** IDs vêm da URL para o link do relatório poder ser salvo/compartilhado.
 * Mantemos uma lista curta e sem duplicatas antes de ela chegar às consultas. */
function pickIdList(value: string | string[] | undefined): string[] {
  return [...new Set(pick(value).split(",").map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 200))].slice(0, 100);
}

function isStatusFilter(value: string): value is MetaAdsStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}

function isCampanhasTab(value: string): value is CampanhasTab {
  return (
    value === "geral" ||
    value === "inteligencia" ||
    value === "relatorio" ||
    value === "comparativos" ||
    value === "alcance" ||
    value === "grupos" ||
    value === "horarios" ||
    value === "diario" ||
    value === "tabela" ||
    value === "anuncios" ||
    value === "leads" ||
    value === "rendimento" ||
    value === "vendedores" ||
    value === "google"
  );
}

/**
 * Presets iguais aos do gerenciador da Meta: "Últimos 7 dias" lá são os 7 dias
 * FECHADOS, terminando ontem — hoje fica de fora porque o dia ainda está
 * rodando. Enquanto esta tela contava até hoje, comparar as duas telas lado a
 * lado sempre dava número diferente (faltava um dia inteiro na ponta e sobrava
 * um dia pela metade na outra). Quem quiser o dia corrente tem o preset "Hoje".
 */
function resolvePeriod(
  preset: string,
  customFrom: string,
  customTo: string
): { preset: "hoje" | "7d" | "14d" | "30d" | "custom"; from: string; to: string } {
  const today = getMetaAdsToday();
  const yesterday = shiftIsoDate(today, -1);

  if (preset === "custom" && customFrom && customTo) {
    return { preset: "custom", from: customFrom, to: customTo };
  }
  if (preset === "hoje") {
    return { preset: "hoje", from: today, to: today };
  }
  if (preset === "14d") {
    return { preset: "14d", from: shiftIsoDate(today, -14), to: yesterday };
  }
  if (preset === "30d") {
    return { preset: "30d", from: shiftIsoDate(today, -30), to: yesterday };
  }
  return { preset: "7d", from: shiftIsoDate(today, -7), to: yesterday };
}

export default async function CampanhasPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.campaigns")) {
    redirect("/");
  }

  const resolved = await Promise.resolve(searchParams);
  const { preset, from, to } = resolvePeriod(pick(resolved.periodo) || "7d", pick(resolved.from), pick(resolved.to));
  // Padrão "todas": o gerenciador da Meta também abre em "Todos os anúncios".
  // Abrir em "Ativas" escondia o gasto de quem foi pausado dentro do período e
  // fazia o investimento da tela nascer menor que o da Meta.
  const statusRaw = pick(resolved.status) || "all";
  const status: MetaAdsStatusFilter = isStatusFilter(statusRaw) ? statusRaw : "all";
  const search = pick(resolved.q) || undefined;
  const tabRaw = pick(resolved.aba) || "inteligencia";
  const tab: CampanhasTab = isCampanhasTab(tabRaw) ? tabRaw : "inteligencia";
  const selectedCampaignId = pick(resolved.campanha) || null;
  const selectedAdsetId = pick(resolved.conjunto) || null;
  // Recorte por localização do lead. Vale só para as abas em que cada linha é
  // uma pessoa: gasto e alcance não têm quebra por cidade na API da Meta.
  const location = pick(resolved.local) || null;

  const purposeFilter = parsePurposeFilter(pick(resolved.tipo));

  const filters: MetaAdsFilters = { from, to, status, search };

  const [allAdRows, periodReach, reconciliation, syncRuns, stageDefs, trainingOptions, recruiterOptions] = await Promise.all([
    getAdsHierarchy(filters),
    // Alcance é a única métrica que não se soma: a Meta deduplica pessoas na
    // janela inteira. Vem dela, por conta/campanha/conjunto (ver getPeriodReach).
    getPeriodReach(from, to),
    // Confere a janela contra o gerenciador a cada abertura da tela e
    // ressincroniza sozinha se o gasto não fechar.
    getMetaReconciliation(from, to),
    Promise.all([getLatestSyncRuns(5), getLatestGoogleAdsSyncRuns(5)]).then(([metaRuns, googleRuns]) =>
      [...metaRuns, ...googleRuns].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 10)
    ),
    getDefaultFunnelStages(),
    ttlCache("dashboard:training-options", 60_000, () => listTrainingFilterOptions()),
    ttlCache("dashboard:recruiter-options", 60_000, () => listRecruitersWithDbNames()),
  ]);

  // Captação × engajamento: o filtro corta os anúncios ANTES de tudo, então
  // todas as abas (KPIs, funil, série, leads) enxergam o mesmo universo. Sem
  // isso a campanha de engajamento entraria nas médias de custo por lead.
  const adRows = allAdRows.filter((row) => matchesPurposeFilter(row.campaignPurpose, purposeFilter));
  const purposeCounts = {
    captacao: allAdRows.filter((row) => row.campaignPurpose !== "engajamento").length,
    engajamento: allAdRows.filter((row) => row.campaignPurpose === "engajamento").length,
  };

  const hierarchy = buildHierarchyTree(adRows);

  // KPIs/funil/série da Visão Geral respeitam o recorte de campanha/conjunto
  // escolhido (via querystring, compartilhado entre as abas) — sem isso,
  // "filtrar por campanha" não mudaria nenhum número, só a galeria de cards.
  const scopedAdRows = adRows.filter(
    (row) =>
      (!selectedCampaignId || row.campaignId === selectedCampaignId) &&
      (!selectedAdsetId || row.adsetId === selectedAdsetId)
  );
  const scopedAdIds = scopedAdRows.map((row) => row.adId);
  const kpis = computeKpiTotals(scopedAdRows);

  const [series, initialFunnel] = await Promise.all([
    getDailySeries(filters, scopedAdIds),
    getFunnelBreakdown(scopedAdIds, filters),
  ]);

  // "Últimos Leads", "Vendedores", "Dia a dia", "Horários" e "Grupos" só
  // carregam dados quando estão em foco — são consultas extras que não valem em
  // toda navegação. Quando uma campanha ou conjunto está selecionado, a
  // lista/agregado respeita o mesmo recorte das outras abas (via scopedAdIds);
  // sem seleção, cobre a conta inteira.
  const hasScope = Boolean(selectedCampaignId || selectedAdsetId);
  const scopeArg = hasScope ? { scopedAdIds } : {};

  let recentLeads: RecentAdLead[] = [];
  let sellerPerformance: SellerAdPerformance[] = [];
  let dailyRows: DailyAdRow[] = [];
  let adLeads: AdLeadDetail[] = [];
  let instagramProfiles: InstagramProfileSeries[] = [];
  let locationOptions: LeadLocationOption[] = [];
  let monthlyReport: MonthlyReport | null = null;
  let googleReport: GoogleAdsReport | null = null;
  let reportSegments: ReportSegmentsData | null = null;
  let reportCampaigns: Array<{ campaignId: string; campaignName: string }> = [];
  let reportIncludedCampaignIds: string[] = [];
  let reportTicket: number | null = null;
  let reportSaleStage: string | null = null;
  if (tab === "relatorio") {
    const prefs = await (session ? getUiPreferences(session.user.email, "campanhas") : Promise.resolve({}));
    reportTicket = readPositiveNumber(prefs, "ticketMedio");
    reportSaleStage = readString(prefs, "saleStageKey");
    // A seleção mora só no relatório: os demais painéis continuam mostrando
    // a conta toda. Se já havia campanha/conjunto escolhido em outra aba,
    // esse escopo também é respeitado aqui.
    const chosenCampaignIds = selectedCampaignId ? [selectedCampaignId] : pickIdList(resolved.relatorioCampanhas);
    const candidateGroups = hierarchy.filter(
      (group) =>
        (!selectedCampaignId || group.campaignId === selectedCampaignId) &&
        (!selectedAdsetId || group.adsets.some((adset) => adset.adsetId === selectedAdsetId))
    );
    reportCampaigns = candidateGroups.map((group) => ({ campaignId: group.campaignId, campaignName: group.campaignName }));
    const candidateIds = new Set(reportCampaigns.map((campaign) => campaign.campaignId));
    reportIncludedCampaignIds = chosenCampaignIds.filter((campaignId) => candidateIds.has(campaignId));
    const reportScopeCampaignIds = selectedCampaignId ? [selectedCampaignId] : reportIncludedCampaignIds;
    // Funil por origem: mesma janela do relatório, consulta própria (o
    // relatório do Meta é por anúncio; este é por canal de captação). Google
    // entra junto — o documento impresso mostra os dois lado a lado, e sem
    // isto o card "Meta × Google" só apareceria em quem já tinha clicado na
    // aba Google Ads antes de abrir o Relatório.
    [reportSegments, googleReport] = await Promise.all([
      getReportSegments(from, to),
      getGoogleAdsReport(from, to).catch(() => null),
    ]);
    monthlyReport = await loadCampaignReport({
      filters,
      purposeFilter,
      campaignIds: reportScopeCampaignIds,
      adsetId: selectedAdsetId,
      ticketMedio: reportTicket,
      saleStageKey: reportSaleStage,
      // Faturamento é dado do Financeiro: só entra para quem tem acesso a ele.
      includeFinance: !session || hasPermission(session.user, "view.finance"),
    });
  } else if (tab === "leads") {
    [recentLeads, locationOptions] = await Promise.all([
      getRecentAdLeads(filters, { ...scopeArg, limit: 80, location }),
      getAdLeadLocations(filters, hasScope ? scopedAdIds : undefined),
    ]);
  } else if (tab === "vendedores") {
    sellerPerformance = await getSellerAdPerformance(filters, scopeArg);
  } else if (tab === "diario") {
    dailyRows = await getDailyAdRows(filters, scopedAdIds);
  } else if (tab === "alcance") {
    instagramProfiles = await getInstagramProfileSeries(from, to);
  } else if (tab === "google") {
    // Google Ads vive fora do universo da Meta: nao passa por `filters` porque
    // status/busca/proposito sao conceitos da hierarquia da Meta. So o periodo
    // e compartilhado, para as duas telas falarem da mesma janela.
    googleReport = await getGoogleAdsReport(from, to);
  } else if (tab === "horarios" || tab === "grupos") {
    // Uma pessoa por linha; a aba Horários agrega por hora e a Grupos agrega
    // por destino a partir do mesmo conjunto, sem consulta separada.
    [adLeads, locationOptions] = await Promise.all([
      getAdLeadDetails(filters, scopedAdIds, location),
      getAdLeadLocations(filters, scopedAdIds),
    ]);
  }

  return (
    <CampanhasClient
      filters={filters}
      preset={preset}
      tab={tab}
      selectedCampaignId={selectedCampaignId}
      selectedAdsetId={selectedAdsetId}
      hierarchy={hierarchy}
      kpis={kpis}
      periodReach={periodReach}
      reconciliation={reconciliation}
      // O alcance da Meta é por conta/campanha/conjunto inteiros: qualquer
      // recorte que corte anúncios por dentro (status, busca, propósito) não
      // tem alcance deduplicado publicado, e a tela avisa em vez de inventar.
      periodReachExact={status === "all" && !search && purposeFilter === "todas"}
      series={series}
      syncRuns={syncRuns}
      stageDefs={stageDefs}
      initialFunnel={initialFunnel}
      recentLeads={recentLeads}
      sellerPerformance={sellerPerformance}
      dailyRows={dailyRows}
      adLeads={adLeads}
      location={location}
      locationOptions={locationOptions}
      instagramProfiles={instagramProfiles}
      monthlyReport={monthlyReport}
      reportCampaigns={reportCampaigns}
      reportIncludedCampaignIds={reportIncludedCampaignIds}
      reportTicket={reportTicket}
      reportSaleStage={reportSaleStage}
      purposeFilter={purposeFilter}
      purposeCounts={purposeCounts}
      googleReport={googleReport}
      reportSegments={reportSegments}
      trainingOptions={trainingOptions}
      recruiterOptions={recruiterOptions}
    />
  );
}
