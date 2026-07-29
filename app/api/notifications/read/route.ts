import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { markAppNotificationsRead } from "@/lib/appNotifications";
import { assertSameOrigin, getRequestDashboardSession, UnauthorizedError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Marca notificacoes do usuario logado como lidas. Com `ids`, so as
 * informadas; sem nada (ou `all: true`), todas as pendentes.
 */
export async function POST(request: NextRequest) {
  const session = getRequestDashboardSession(request);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    throw error;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : undefined;

    const updated = await markAppNotificationsRead(email, body.all === true ? undefined : ids);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error("[notifications] falha ao marcar como lida:", error);
    return NextResponse.json({ error: "Erro ao atualizar notificacoes" }, { status: 500 });
  }
}
