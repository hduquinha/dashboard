import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppNotificationFeed } from "@/lib/appNotifications";
import { getRequestDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Feed de notificacoes do usuario logado (sino do menu e pagina
 * /notificacoes). Sempre por sessao — nao aceita token de servico, porque
 * "minhas notificacoes" so faz sentido com um usuario identificado.
 */
export async function GET(request: NextRequest) {
  const session = getRequestDashboardSession(request);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const limitRaw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
    const onlyUnread = request.nextUrl.searchParams.get("unread") === "1";

    const feed = await getAppNotificationFeed(email, {
      limit: Number.isFinite(limitRaw) ? limitRaw : 30,
      onlyUnread,
    });

    return NextResponse.json(feed);
  } catch (error) {
    console.error("[notifications] falha ao carregar feed:", error);
    return NextResponse.json({ error: "Erro ao carregar notificacoes" }, { status: 500 });
  }
}
