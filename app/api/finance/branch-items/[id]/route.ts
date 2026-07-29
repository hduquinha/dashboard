import { NextResponse, type NextRequest } from "next/server";
import { deleteBranchItem, updateBranchItem } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const entityId = parseId(id);
    await auditFinance(request, { entity: "branch_item", action: "update", entityId }, () =>
      updateBranchItem(entityId, body)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar item da filial.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const entityId = parseId(id);
    await auditFinance(request, { entity: "branch_item", action: "delete", entityId }, () =>
      deleteBranchItem(entityId)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir item da filial.");
  }
}
