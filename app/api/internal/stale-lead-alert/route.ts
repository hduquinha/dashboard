import { NextResponse, type NextRequest } from "next/server";
import { pruneAppNotifications } from "@/lib/appNotifications";
import { assertAuthorizationHeader, UnauthorizedError } from "@/lib/auth";
import { dispatchStaleLeadAlerts, dispatchUndistributedLeadAlerts } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

/**
 * Disparada periodicamente por server.js (loopback) para avisar os masters
 * de dois tipos de atraso: lead atribuido que ficou parado sem atualizacao, e
 * lead que chegou na Chegada de Leads e ainda nao foi distribuido a ninguem.
 * Nao e destinada a uso pelo navegador.
 */
export async function POST(request: NextRequest) {
  try {
    assertAuthorizationHeader(request.headers.get("authorization"));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  try {
    const [stale, undistributed] = await Promise.all([
      dispatchStaleLeadAlerts(),
      dispatchUndistributedLeadAlerts(),
    ]);

    // Retencao do feed do site: aproveita o ciclo periodico que ja existe.
    pruneAppNotifications().catch((error) => {
      console.error("[stale-lead-alert] falha ao limpar notificacoes antigas:", error);
    });

    return NextResponse.json({ ok: true, stale, undistributed });
  } catch (err) {
    console.error("[stale-lead-alert] Erro ao despachar alertas:", err);
    return NextResponse.json({ error: "Erro ao despachar alertas de lead parado" }, { status: 500 });
  }
}
