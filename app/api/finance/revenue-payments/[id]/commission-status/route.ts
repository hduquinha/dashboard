import { NextResponse, type NextRequest } from "next/server";
import { setPaymentCommissionStatus } from "@/lib/finance";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../../utils";
import type { CommissionStatus } from "@/types/finance";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const status: CommissionStatus = body.status === "paga" ? "paga" : "disponivel";
    await setPaymentCommissionStatus(parseId(id), status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar status da comissão.");
  }
}
