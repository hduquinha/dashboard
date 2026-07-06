import { type NextRequest, NextResponse } from "next/server";
import { assertAuthorizationHeader } from "@/lib/auth";
import { syncRecentFacebookLeads } from "@/lib/facebookLeadAds";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAuthorizationHeader(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.FACEBOOK_LEAD_SYNC_ENABLED === "false") {
    return NextResponse.json({ ok: true, disabled: true });
  }

  try {
    const result = await syncRecentFacebookLeads({
      leadLimit: Number.parseInt(process.env.FACEBOOK_LEAD_SYNC_LIMIT ?? "25", 10),
      formLimit: Number.parseInt(process.env.FACEBOOK_LEAD_SYNC_FORM_LIMIT ?? "50", 10),
    });
    console.log("[facebook-lead-sync] sincronização concluída", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[facebook-lead-sync] falha na sincronização", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro ao sincronizar leads Meta",
      },
      { status: 500 }
    );
  }
}
