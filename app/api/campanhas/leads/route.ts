import { NextResponse, type NextRequest } from "next/server";
import { requireCampaignsAccess } from "../utils";
import { getLeadsForAd } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("adId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!adId || !from || !to) {
    return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
  }

  try {
    const leads = await getLeadsForAd(adId, { from, to });
    return NextResponse.json({ leads });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar leads do anuncio." },
      { status: 500 }
    );
  }
}
