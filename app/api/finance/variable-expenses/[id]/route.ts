import { NextResponse, type NextRequest } from "next/server";
import { deleteVariableExpense, updateVariableExpense } from "@/lib/finance";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    await updateVariableExpense(parseId(id), await readJsonBody(request));
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
    await deleteVariableExpense(parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir despesa variavel.");
  }
}
