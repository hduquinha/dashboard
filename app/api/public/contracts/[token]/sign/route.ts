import { NextRequest, NextResponse } from "next/server";
import { signContractByToken } from "@/lib/contracts";
import { clientIp } from "../route";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Rota PÚBLICA de assinatura.
 *
 * Toda a decisão de aceitar ou recusar mora em `signContractByToken` →
 * `evaluateSignAttempt` (puro e testado). Aqui só se traduz HTTP: 404 para
 * link inexistente, 409 para contrato que não pode mais ser assinado, 422 para
 * dado que a pessoa pode corrigir e tentar de novo.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await signContractByToken(token, {
    name: typeof body.name === "string" ? body.name : "",
    cpf: typeof body.cpf === "string" ? body.cpf : "",
    accepted: body.accepted === true,
    reachedEnd: body.reachedEnd === true,
    otpCode: typeof body.otpCode === "string" ? body.otpCode : "",
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, contractId: result.contractId });
  }

  const status =
    result.reason === "nao_encontrado"
      ? 404
      : result.reason === "ja_assinado" || result.reason === "cancelado" || result.reason === "expirado"
        ? 409
        : result.reason === "muitas_tentativas"
          ? 429
          : 422;

  return NextResponse.json({ ok: false, reason: result.reason, error: result.message }, { status });
}
