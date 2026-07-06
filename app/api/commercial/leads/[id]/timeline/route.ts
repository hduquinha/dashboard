import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { listCommercialLeadTimeline, logCommercialLeadActivity } from "@/lib/commercial";

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const [{ id }, cookieStore] = await Promise.all([context.params, cookies()]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const events = await listCommercialLeadTimeline(parseId(id));
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar a linha do tempo." },
      { status: 400 }
    );
  }
}

/** Registro manual de atividade (WhatsApp, ligacao, e-mail, anotacao). */
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

    const inscricaoId = parseId(id);
    await logCommercialLeadActivity(session.user, inscricaoId, body?.kind, body?.description);
    const events = await listCommercialLeadTimeline(inscricaoId);
    return NextResponse.json({ ok: true, events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar atividade." },
      { status: 400 }
    );
  }
}
