import { NextResponse, type NextRequest } from "next/server";
import { deleteRevenuePayment, updateRevenuePayment } from "@/lib/finance";
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
    const paymentId = parseId(id);
    await auditFinance(
      request,
      { entity: "revenue_payment", action: "update", entityId: paymentId },
      () => updateRevenuePayment(paymentId, body)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar pagamento.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const paymentId = parseId(id);
    await auditFinance(
      request,
      { entity: "revenue_payment", action: "delete", entityId: paymentId },
      () => deleteRevenuePayment(paymentId)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir pagamento.");
  }
}
