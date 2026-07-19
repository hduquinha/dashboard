import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { createFunnel, listFunnelsForUser } from "@/lib/funnels";
import type { CommercialStageKind } from "@/types/inscricao";
import type { FunnelStageInput } from "@/types/funnel";

export const dynamic = "force-dynamic";

const STAGE_KINDS: CommercialStageKind[] = ["entry", "normal", "won", "lost"];

function parseStages(value: unknown): FunnelStageInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    return {
      id: typeof raw.id === "number" ? raw.id : null,
      label: typeof raw.label === "string" ? raw.label : "",
      kind: STAGE_KINDS.includes(raw.kind as CommercialStageKind) ? (raw.kind as CommercialStageKind) : "normal",
      color: typeof raw.color === "string" ? raw.color : undefined,
    };
  });
}

function parseSellerIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is number => typeof id === "number");
}

export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const funnels = await listFunnelsForUser(session.user);
  return NextResponse.json({ funnels });
}

export async function POST(request: Request) {
  try {
    const [cookieStore, body] = await Promise.all([cookies(), request.json().catch(() => ({}))]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const funnel = await createFunnel(session.user, {
      name: typeof body?.name === "string" ? body.name : "",
      stages: parseStages(body?.stages),
      sellerIds: parseSellerIds(body?.sellerIds),
    });
    return NextResponse.json({ funnel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar funil." },
      { status: 400 }
    );
  }
}
