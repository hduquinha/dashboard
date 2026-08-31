import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { registerLeadObjection } from "@/lib/commercial";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Objeção do lead que foi para o repique (coluna Desinteresse). */
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

    const result = await registerLeadObjection(session.user, inscricaoId, {
      reasons: body?.reasons,
      note: body?.note,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar a objecao." },
      { status: 400 }
    );
  }
}
