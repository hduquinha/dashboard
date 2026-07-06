import { NextResponse, type NextRequest } from "next/server";
import { deleteFixedExpense, updateFixedExpense } from "@/lib/finance";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    await updateFixedExpense(parseId(id), await readJsonBody(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar despesa fixa.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    await deleteFixedExpense(parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir despesa fixa.");
  }
}
