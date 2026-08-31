import { NextRequest, NextResponse } from "next/server";
import { sendContractOtp } from "@/lib/contracts";
import { clientIp } from "../route";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Rota PÚBLICA que dispara o código de verificação.
 *
 * Não recebe destinatário: o e-mail sai para o endereço do CADASTRO, lido do
 * snapshot do contrato. Aceitar um endereço do corpo da requisição faria o
 * segundo fator apontar para onde o visitante quisesse — que é o mesmo que não
 * ter segundo fator.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  const result = await sendContractOtp(token, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      maskedEmail: result.maskedEmail,
      ttlMinutes: result.ttlMinutes,
    });
  }

  const status =
    result.reason === "nao_encontrado"
      ? 404
      : result.reason === "indisponivel"
        ? 409
        : result.reason === "muitos_envios"
          ? 429
          : result.reason === "falha_envio"
            ? 502
            : 422;

  return NextResponse.json({ ok: false, reason: result.reason, error: result.message }, { status });
}
