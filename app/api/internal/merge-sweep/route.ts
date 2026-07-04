import { NextResponse, type NextRequest } from "next/server";
import { assertAuthorizationHeader, UnauthorizedError } from "@/lib/auth";
import { runMergeSweepOnce } from "@/lib/mergeSweep";

export const dynamic = "force-dynamic";

/**
 * Disparada periodicamente por server.js (loopback) para consumir
 * dashboard.pending_merge_checks. Nao e destinada a uso pelo navegador.
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
    const result = await runMergeSweepOnce();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[merge-sweep] Erro ao processar fila:", err);
    return NextResponse.json({ error: "Erro ao processar fila de merges" }, { status: 500 });
  }
}
