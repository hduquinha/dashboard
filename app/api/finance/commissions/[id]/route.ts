import { NextResponse, type NextRequest } from "next/server";
import { deleteCommission } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseId, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const entityId = parseId(id);
    await auditFinance(request, { entity: "commission", action: "delete", entityId }, () =>
      deleteCommission(entityId)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir comissao.");
  }
}
