import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { listTriagePool } from "@/lib/triageDistribution";

export const dynamic = "force-dynamic";

/** Leads da triagem ainda sem responsável — o bolo que o admin vai repartir. */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);

  try {
    const pool = await listTriagePool(session.user, {
      search: searchParams.get("search") ?? undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      onlyNamed: searchParams.get("onlyNamed") === "1",
    });
    return NextResponse.json({ ok: true, ...pool });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar a triagem.";
    return NextResponse.json({ error: message }, { status: message.includes("administradores") ? 403 : 400 });
  }
}
