import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { approveTriageLead } from "@/lib/commercial";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * "Aprovar" o lead da triagem: ele sai da pasta Triagem e entra no funil de
 * trabalho do vendedor, mantendo o responsável. Ao contrário de mover de funil
 * (só supervisor), o próprio vendedor pode fazer isto nos leads dele — é a ação
 * central do fluxo de triagem.
 */
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

    const inscricaoId = Number.parseInt(id, 10);
    if (!Number.isFinite(inscricaoId) || inscricaoId < 1) {
      return NextResponse.json({ error: "Lead invalido." }, { status: 400 });
    }

    const funnelIdRaw = Number.parseInt(String(body?.funnelId ?? ""), 10);
    const result = await approveTriageLead(
      session.user,
      inscricaoId,
      Number.isFinite(funnelIdRaw) && funnelIdRaw > 0 ? funnelIdRaw : null
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao aprovar lead da triagem." },
      { status: 400 }
    );
  }
}
