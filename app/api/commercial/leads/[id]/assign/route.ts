import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { assignCommercialLead, getCommercialWorkspace } from "@/lib/commercial";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Lead invalido.");
  }
  return parsed;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const [{ id }, cookieStore, body] = await Promise.all([
      context.params,
      cookies(),
      request.json().catch(() => ({})),
    ]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    const sellerId = Number.parseInt(String(body?.sellerId ?? ""), 10);
    if (!Number.isFinite(sellerId) || sellerId < 1) {
      throw new Error("Vendedor invalido.");
    }

    const result = await assignCommercialLead(session.user, parseId(id), sellerId);
    const commercial = await getCommercialWorkspace(session.user);
    return NextResponse.json({ ok: true, seller: result.seller, commercial });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao repassar lead." },
      { status: 400 }
    );
  }
}
