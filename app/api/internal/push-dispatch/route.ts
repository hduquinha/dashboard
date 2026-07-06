import { NextResponse, type NextRequest } from "next/server";
import { assertAuthorizationHeader, UnauthorizedError } from "@/lib/auth";
import { dispatchNewLeadPushes } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

/**
 * Disparada periodicamente por server.js (loopback) para enviar web push de
 * leads novos aos aparelhos inscritos. Nao e destinada a uso pelo navegador.
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
    const result = await dispatchNewLeadPushes();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[push-dispatch] Erro ao despachar notificacoes:", err);
    return NextResponse.json({ error: "Erro ao despachar notificacoes push" }, { status: 500 });
  }
}
