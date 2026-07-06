import { NextResponse, type NextRequest } from "next/server";
import { assertAuthenticatedRequest, getRequestDashboardSession } from "@/lib/auth";
import { deleteSubscription, parseSubscriptionInput, saveSubscription } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

/** Registra (ou atualiza) a inscrição de push deste aparelho. */
export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  let subscription;
  try {
    const body = await request.json();
    subscription = parseSubscriptionInput(body?.subscription ?? body);
  } catch {
    subscription = null;
  }
  if (!subscription) {
    return NextResponse.json({ error: "Inscricao de push invalida." }, { status: 400 });
  }

  try {
    const session = getRequestDashboardSession(request);
    await saveSubscription(
      subscription,
      session?.user?.email ?? null,
      request.headers.get("user-agent")
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao salvar inscricao de push:", error);
    return NextResponse.json({ error: "Falha ao salvar inscricao." }, { status: 500 });
  }
}

/** Remove a inscrição de push deste aparelho (logout / permissão revogada). */
export async function DELETE(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  let endpoint: string | null = null;
  try {
    const body = await request.json();
    if (typeof body?.endpoint === "string") endpoint = body.endpoint;
  } catch {
    endpoint = null;
  }
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint obrigatorio." }, { status: 400 });
  }

  try {
    await deleteSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao remover inscricao de push:", error);
    return NextResponse.json({ error: "Falha ao remover inscricao." }, { status: 500 });
  }
}
