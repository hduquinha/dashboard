import { NextResponse, type NextRequest } from "next/server";
import { requireCampaignsAccess } from "../utils";
import { getLeadsForAds } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  // `adId` pode trazer vários ids separados por vírgula: um card é um criativo,
  // e o mesmo criativo roda em vários conjuntos (cada um com seu ad_id).
  const adId = searchParams.get("adId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!adId || !from || !to) {
    return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
  }

  const adIds = adId.split(",").map((id) => id.trim()).filter(Boolean);
  if (adIds.length === 0) {
    return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
  }

  try {
    const leads = await getLeadsForAds(adIds, { from, to });
    return NextResponse.json({ leads });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar leads do anuncio." },
      { status: 500 }
    );
  }
}
