import { NextResponse, type NextRequest } from "next/server";
import { deleteVariableExpense, updateVariableExpense } from "@/lib/finance";
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
    await auditFinance(request, { entity: "variable_expense", action: "update", entityId }, () =>
      updateVariableExpense(entityId, body)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar despesa variavel.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const entityId = parseId(id);
    await auditFinance(request, { entity: "variable_expense", action: "delete", entityId }, () =>
      deleteVariableExpense(entityId)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir despesa variavel.");
  }
}
