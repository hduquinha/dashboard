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
  const statusRaw = searchParams.get("status") ?? "active";
  return {
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    status: isStatusFilter(statusRaw) ? statusRaw : "active",
    search: searchParams.get("q") || undefined,
  };
}
