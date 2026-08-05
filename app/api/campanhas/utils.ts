import { NextResponse, type NextRequest } from "next/server";
import { assertAuthenticatedRequest, getRequestDashboardSession, UnauthorizedError } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { MetaAdsFilters, MetaAdsStatusFilter } from "@/types/metaAds";

export function requireCampaignsAccess(request: NextRequest): NextResponse | null {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    throw error;
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "view.campaigns")) {
    return NextResponse.json({ error: "Sem permissao para acessar metricas de campanha." }, { status: 403 });
  }

  return null;
}

function isStatusFilter(value: string): value is MetaAdsStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}

export function parseMetaAdsFilters(searchParams: URLSearchParams): MetaAdsFilters {
  // Mesmo padrão da página: "todas". Status é filtro de listagem, não de
  // contabilidade — quem foi pausado ontem gastou dentro do período do mesmo
  // jeito e precisa entrar na conta (ver DELIVERED_OR_HAS_LEAD em lib/metaAds).
  const statusRaw = searchParams.get("status") ?? "all";
  return {
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    status: isStatusFilter(statusRaw) ? statusRaw : "all",
    search: searchParams.get("q") || undefined,
  };
}
