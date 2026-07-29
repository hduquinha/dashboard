import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, getRequestDashboardSession, UnauthorizedError } from "@/lib/auth";
import { deleteFinanceAuditEvent, getFinanceAuditEvent } from "@/lib/financeAudit";
import { hasPermission } from "@/lib/permissions";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Detalhe de um evento: traz o estado completo antes e depois, que fica fora
 * da listagem por ser pesado. E o que a tela abre quando o usuario clica em
 * "Ver alterações".
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const event = await getFinanceAuditEvent(parseId(id));
    if (!event) {
      return NextResponse.json({ error: "Evento não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ event });
  } catch (error) {
    return financeError(error, "Falha ao carregar evento de auditoria.");
  }
}

/**
 * Remove um evento do registro. Diferente do resto do modulo financeiro,
 * exige sessao real com `admin.audit` — token de servico nao apaga histórico.
 * A remocao vira um evento `purge`, que por sua vez nao pode ser removido.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const session = getRequestDashboardSession(request);
  if (!session?.user || !hasPermission(session.user, "admin.audit")) {
    return NextResponse.json(
      { error: "Apenas usuários com permissão de auditoria podem remover eventos." },
      { status: 403 }
    );
  }

  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    throw error;
  }

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const reason = typeof body.reason === "string" ? body.reason : null;
    const result = await deleteFinanceAuditEvent(parseId(id), session.user, reason);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return financeError(error, "Falha ao remover evento do registro.");
  }
}
