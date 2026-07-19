import { NextResponse, type NextRequest } from "next/server";
import { requireCampaignsAccess } from "../utils";
import { runMetaAdsSync } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  try {
    // Ação manual também atualiza os criativos, incluindo URL do formulário.
    // O job automático continua respeitando o TTL para poupar a Graph API.
    const result = await runMetaAdsSync({ forceStructure: true });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao sincronizar campanhas." },
      { status: 500 }
    );
  }
}
