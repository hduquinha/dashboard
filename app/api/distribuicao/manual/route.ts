import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import {
  distributeManualLeads,
  listManualDistributionFolderCandidates,
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

function normalizeScope(value: unknown): "selected" | "filters" | "folder_block" {
  if (value === "filters") return "filters";
  if (value === "folder_block") return "folder_block";
  return "selected";
}

function normalizeBooleanParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "sim";
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  const { searchParams } = new URL(request.url);

  try {
    const result = await listManualDistributionFolderCandidates(session?.user ?? null, {
      folderKey: searchParams.get("folderKey") ?? undefined,
      block: searchParams.get("block") ?? searchParams.get("bloco") ?? undefined,
      overwriteAssigned: normalizeBooleanParam(searchParams.get("overwriteAssigned")),
      limit: Number(searchParams.get("limit")),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to list manual distribution candidates", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar leads da pasta." },
      { status: 400 }
    );
  }
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
      scope: normalizeScope(body.scope),
      leadIds: Array.isArray(body.leadIds) ? body.leadIds.map(Number) : [],
      filters: normalizeManualDistributionFilters(
        (body.filters && typeof body.filters === "object" ? body.filters : {}) as Record<string, unknown>
      ),
      folderKey: typeof body.folderKey === "string" ? body.folderKey : undefined,
      block: typeof body.block === "string" ? body.block : typeof body.bloco === "string" ? body.bloco : undefined,
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
