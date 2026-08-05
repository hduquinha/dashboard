import { NextResponse, type NextRequest } from "next/server";
import { deleteEnrollmentPayment, updateEnrollmentPayment } from "@/lib/finance";
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
    const enrollment = await auditFinance(
      request,
      { entity: "enrollment_payment", action: "update", entityId: paymentId },
      () => updateEnrollmentPayment(paymentId, body)
    );
    return NextResponse.json({ enrollment });
  } catch (error) {
    return financeError(error, "Falha ao atualizar pagamento da matrícula.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const paymentId = parseId(id);
    const enrollment = await auditFinance(
      request,
      { entity: "enrollment_payment", action: "delete", entityId: paymentId },
      () => deleteEnrollmentPayment(paymentId)
    );
    return NextResponse.json({ enrollment });
  } catch (error) {
    return financeError(error, "Falha ao excluir pagamento da matrícula.");
  }
}
