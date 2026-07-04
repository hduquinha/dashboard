import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import {
  distributeNextLeads,
  getProductivityWorkspace,
  saveProductivityLeadAgents,
} from "@/lib/productivity";

export const dynamic = "force-dynamic";

function unauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);

  try {
    const workspace = await getProductivityWorkspace(session?.user ?? null);
    return NextResponse.json({ distribution: workspace.distribution });
  } catch (error) {
    console.error("Failed to load lead distribution", error);
    return NextResponse.json({ error: "Falha ao carregar distribuicao" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);

  try {
    const body = (await request.json()) as {
      agents?: Array<{ chatwootUserId: number; active: boolean; position: number }>;
    };
    await saveProductivityLeadAgents(session?.user ?? null, body.agents ?? []);
    const workspace = await getProductivityWorkspace(session?.user ?? null);
    return NextResponse.json({ distribution: workspace.distribution });
  } catch (error) {
    console.error("Failed to save lead distribution order", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar ordem" },
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
    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const assigned = await distributeNextLeads(session?.user ?? null, body.limit ?? 1);
    const workspace = await getProductivityWorkspace(session?.user ?? null);
    return NextResponse.json({
      distribution: {
        ...workspace.distribution,
        lastAssignments: assigned,
      },
    });
  } catch (error) {
    console.error("Failed to distribute leads", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao distribuir leads" },
      { status: 400 }
    );
  }
}
