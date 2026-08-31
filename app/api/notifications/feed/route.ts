import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppNotificationFeed } from "@/lib/appNotifications";
import { getRequestDashboardSession } from "@/lib/auth";
import { canReceiveNewLeadNotifications } from "@/lib/leadNotificationAudience";
import { countArrivalQueues } from "@/lib/manualDistribution";

export const dynamic = "force-dynamic";

/**
 * Feed de notificacoes do usuario logado (sino do menu e pagina
 * /notificacoes). Sempre por sessao — nao aceita token de servico, porque
 * "minhas notificacoes" so faz sentido com um usuario identificado.
 *
 * Carrega junto quantos leads estao esperando na Chegada de Leads, que e o que
 * acende o aviso naquele item do menu. So para quem realmente distribui leads:
 * mesmo gate do aviso de lead novo.
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
    const canSeeArrivalQueue = canReceiveNewLeadNotifications(session?.user);

    const [feed, arrivalQueue] = await Promise.all([
      getAppNotificationFeed(email, {
        limit: Number.isFinite(limitRaw) ? limitRaw : 30,
        onlyUnread,
      }),
      // Um erro na contagem nao pode derrubar o feed: o sino continua
      // funcionando e o item da Chegada so fica sem o aviso neste ciclo.
      canSeeArrivalQueue
        ? countArrivalQueues().catch((error) => {
            console.error("[notifications] falha ao contar a fila da Chegada:", error);
            return null;
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ ...feed, arrivalQueue });
  } catch (error) {
    console.error("[notifications] falha ao carregar feed:", error);
    return NextResponse.json({ error: "Erro ao carregar notificacoes" }, { status: 500 });
  }
}
