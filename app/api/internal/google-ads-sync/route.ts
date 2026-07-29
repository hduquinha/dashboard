import { type NextRequest, NextResponse } from "next/server";
import { assertAuthorizationHeader } from "@/lib/auth";
import { runGoogleAdsSync } from "@/lib/googleAds";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAuthorizationHeader(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.GOOGLE_ADS_SYNC_ENABLED === "false") {
    return NextResponse.json({ ok: true, disabled: true });
  }

  try {
    const result = await runGoogleAdsSync();
    console.log("[google-ads-sync] sincronização concluída", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[google-ads-sync] falha na sincronização", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro ao sincronizar métricas de campanha Google Ads",
      },
      { status: 500 }
    );
  }
}
