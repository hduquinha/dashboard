import { NextResponse, type NextRequest } from "next/server";
import { assertAuthorizationHeader, UnauthorizedError } from "@/lib/auth";
import { dispatchOverdueInstallmentAlerts } from "@/lib/financeAlerts";

export const dynamic = "force-dynamic";

/**
 * Disparada periodicamente por server.js (loopback) para marcar as parcelas de
 * matrícula que venceram e avisar o financeiro. Mesmo padrão do merge sweep e
 * do alerta de lead parado. Não é destinada a uso pelo navegador.
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
    const result = await dispatchOverdueInstallmentAlerts();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[finance-overdue] Erro ao marcar parcelas vencidas:", err);
    return NextResponse.json({ error: "Erro ao marcar parcelas vencidas" }, { status: 500 });
  }
}
