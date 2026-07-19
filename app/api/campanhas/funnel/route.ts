import { NextResponse, type NextRequest } from "next/server";
import { parseMetaAdsFilters, requireCampaignsAccess } from "../utils";
import { getAdIdsForScope, getFunnelBreakdown } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const filters = parseMetaAdsFilters(searchParams);
  if (!filters.from || !filters.to) {
    return NextResponse.json({ error: "Periodo invalido." }, { status: 400 });
  }

  const campaignId = searchParams.get("campaignId");
  const scopedCampaignId = campaignId && campaignId !== "all" ? campaignId : undefined;

  try {
    const adIds = await getAdIdsForScope(filters, scopedCampaignId);
    const stages = await getFunnelBreakdown(adIds, filters);
    return NextResponse.json({ stages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao calcular funil." },
      { status: 500 }
    );
  }
}
