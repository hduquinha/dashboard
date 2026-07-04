import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import {
  distributeManualLeads,
  normalizeManualDistributionFilters,
  type ManualDistributionStrategy,
} from "@/lib/manualDistribution";

export const dynamic = "force-dynamic";

function unauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

function normalizeStrategy(value: unknown): ManualDistributionStrategy {
  return value === "round_robin" ? "round_robin" : "single";
}

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await distributeManualLeads(session?.user ?? null, {
      scope: body.scope === "filters" ? "filters" : "selected",
      leadIds: Array.isArray(body.leadIds) ? body.leadIds.map(Number) : [],
      filters: normalizeManualDistributionFilters(
        (body.filters && typeof body.filters === "object" ? body.filters : {}) as Record<string, unknown>
      ),
      sellerIds: Array.isArray(body.sellerIds) ? body.sellerIds.map(Number) : [Number(body.sellerId)],
      strategy: normalizeStrategy(body.strategy),
      overwriteAssigned: Boolean(body.overwriteAssigned),
      limit: Number(body.limit),
    });

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Failed to distribute manual leads", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao distribuir leads." },
      { status: 400 }
    );
  }
}
