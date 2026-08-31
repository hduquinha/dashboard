import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { distributeTriageLeads, type TriageDistributionStrategy } from "@/lib/triageDistribution";

export const dynamic = "force-dynamic";

function parseIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Math.trunc(Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0);
}

export async function POST(request: Request) {
  const [cookieStore, body] = await Promise.all([cookies(), request.json().catch(() => ({}))]);
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const strategy: TriageDistributionStrategy =
    body?.strategy === "round_robin" ? "round_robin" : "single";
  const countRaw = Math.trunc(Number(body?.count));

  try {
    const result = await distributeTriageLeads(session.user, {
      leadIds: parseIdList(body?.leadIds),
      count: Number.isFinite(countRaw) && countRaw > 0 ? countRaw : undefined,
      onlyNamed: body?.onlyNamed === true,
      sellerIds: parseIdList(body?.sellerIds),
      strategy,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao distribuir a triagem.";
    return NextResponse.json({ error: message }, { status: message.includes("administradores") ? 403 : 400 });
  }
}
