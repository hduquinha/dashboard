import { NextResponse, type NextRequest } from "next/server";
import { setCommissionInstallmentStatus } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";
import type { InstallmentStatus } from "@/types/finance";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const status: InstallmentStatus = body.status === "pago" ? "pago" : "pendente";
    const entityId = parseId(id);
    await auditFinance(
      request,
      { entity: "commission_installment", action: "status", entityId, note: `Parcela marcada como ${status}` },
      () => setCommissionInstallmentStatus(entityId, status)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar parcela da comissao.");
  }
}
