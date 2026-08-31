import { NextRequest, NextResponse } from "next/server";
import { getContractByToken, registerContractOpened } from "@/lib/contracts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Rota PÚBLICA: é por ela que o aluno lê o contrato antes de assinar.
 *
 * Não tem sessão nem permissão de propósito — quem tem o link tem acesso ao
 * documento, e o link só existe no telefone/e-mail para onde a escola mandou.
 * O `middleware.ts` não protege `/api/*`, então a única defesa aqui é o token:
 * 192 bits de entropia e prazo de validade.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const contract = await getContractByToken(token);
  if (!contract) {
    return NextResponse.json({ error: "Contrato nao encontrado." }, { status: 404 });
  }

  await registerContractOpened(token, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ contract }, { headers: { "Cache-Control": "no-store" } });
}

/** IP real de quem assinou — o Caddy entrega em X-Forwarded-For. */
export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}
