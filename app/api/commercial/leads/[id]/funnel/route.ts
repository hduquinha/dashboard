import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { moveLeadToFunnel } from "@/lib/commercial";

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

export async function PATCH(request: Request, context: RouteContext) {
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

    const funnelId = Number.parseInt(String(body?.funnelId ?? ""), 10);
    if (!Number.isFinite(funnelId) || funnelId < 1) {
      return NextResponse.json({ error: "Funil invalido." }, { status: 400 });
    }

    await moveLeadToFunnel(session.user, parseId(id), funnelId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao mover lead de funil." },
      { status: 400 }
    );
  }
}
