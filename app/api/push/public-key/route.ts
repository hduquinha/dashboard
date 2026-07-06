import { NextResponse, type NextRequest } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { getVapidKeys } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

/** Chave pública VAPID usada pelo navegador para se inscrever no push. */
export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const { publicKey } = await getVapidKeys();
    return NextResponse.json({ publicKey });
  } catch (error) {
    console.error("Erro ao obter chave publica de push:", error);
    return NextResponse.json({ error: "Falha ao obter chave de push." }, { status: 500 });
  }
}
