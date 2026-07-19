import { type NextRequest, NextResponse } from "next/server";
import { assertAuthorizationHeader } from "@/lib/auth";
import { runMetaAdsSync } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAuthorizationHeader(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.META_ADS_SYNC_ENABLED === "false") {
    return NextResponse.json({ ok: true, disabled: true });
  }

  try {
    const result = await runMetaAdsSync();
    console.log("[meta-ads-sync] sincronização concluída", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[meta-ads-sync] falha na sincronização", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro ao sincronizar métricas de campanha Meta",
      },
      { status: 500 }
    );
  }
}
