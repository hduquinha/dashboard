import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CampanhasClient from "./CampanhasClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getLatestGoogleAdsSyncRuns } from "@/lib/googleAds";
import { hasPermission } from "@/lib/permissions";
import {
  computeKpiTotals,
  buildHierarchyTree,
  getAdsHierarchy,
  getDailySeries,
  getDefaultFunnelStages,
  getFunnelBreakdown,
  getLatestSyncRuns,
  getMetaAdsToday,
  getRecentAdLeads,
  getSellerAdPerformance,
  shiftIsoDate,
} from "@/lib/metaAds";
import type {
  CampanhasTab,
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

function isStatusFilter(value: string): value is MetaAdsStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}

function isCampanhasTab(value: string): value is CampanhasTab {
  return (
    value === "geral" ||
    value === "tabela" ||
    value === "anuncios" ||
    value === "leads" ||
    value === "vendedores"
  );
}

/** Presets: 7d/14d/30d contam o dia de hoje como o último dia da janela. */
function resolvePeriod(
  preset: string,
  customFrom: string,
  customTo: string
): { preset: "7d" | "14d" | "30d" | "custom"; from: string; to: string } {
  const today = getMetaAdsToday();

  if (preset === "custom" && customFrom && customTo) {
    return { preset: "custom", from: customFrom, to: customTo };
  }
  if (preset === "14d") {
    return { preset: "14d", from: shiftIsoDate(today, -13), to: today };
  }
  if (preset === "30d") {
    return { preset: "30d", from: shiftIsoDate(today, -29), to: today };
  }
  return { preset: "7d", from: shiftIsoDate(today, -6), to: today };
}

export default async function CampanhasPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.campaigns")) {
    redirect("/");
  }

  const resolved = await Promise.resolve(searchParams);
  const { preset, from, to } = resolvePeriod(pick(resolved.periodo) || "7d", pick(resolved.from), pick(resolved.to));
  const statusRaw = pick(resolved.status) || "active";
  const status: MetaAdsStatusFilter = isStatusFilter(statusRaw) ? statusRaw : "active";
  const search = pick(resolved.q) || undefined;
  const tabRaw = pick(resolved.aba) || "geral";
  const tab: CampanhasTab = isCampanhasTab(tabRaw) ? tabRaw : "geral";
  const selectedCampaignId = pick(resolved.campanha) || null;
  const selectedAdsetId = pick(resolved.conjunto) || null;

  const filters: MetaAdsFilters = { from, to, status, search };

  const [adRows, syncRuns, stageDefs] = await Promise.all([
    getAdsHierarchy(filters),
    Promise.all([getLatestSyncRuns(5), getLatestGoogleAdsSyncRuns(5)]).then(([metaRuns, googleRuns]) =>
      [...metaRuns, ...googleRuns].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 10)
    ),
    getDefaultFunnelStages(),
  ]);

  const hierarchy = buildHierarchyTree(adRows);

  // KPIs/funil/série da Visão Geral respeitam o recorte de campanha/conjunto
  // escolhido (via querystring, compartilhado entre as 3 abas) — sem isso,
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

  // "Últimos Leads" e "Vendedores" só carregam dados quando estão em foco —
  // são consultas extras que não valem em toda navegação. Quando uma campanha
  // ou conjunto está selecionado, a lista/agregado respeita o mesmo recorte das
  // outras abas (via scopedAdIds); sem seleção, cobre a conta inteira.
  const hasScope = Boolean(selectedCampaignId || selectedAdsetId);
  const scopeArg = hasScope ? { scopedAdIds } : {};

  let recentLeads: RecentAdLead[] = [];
  let sellerPerformance: SellerAdPerformance[] = [];
  if (tab === "leads") {
    recentLeads = await getRecentAdLeads(filters, { ...scopeArg, limit: 80 });
  } else if (tab === "vendedores") {
    sellerPerformance = await getSellerAdPerformance(filters, scopeArg);
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
      series={series}
      syncRuns={syncRuns}
      stageDefs={stageDefs}
      initialFunnel={initialFunnel}
      recentLeads={recentLeads}
      sellerPerformance={sellerPerformance}
    />
  );
}
