import { NextResponse, type NextRequest } from "next/server";
import { getRequestDashboardSession } from "@/lib/auth";
import { createRevenuePayment, listRevenuePayments, type RevenuePaymentInput } from "@/lib/finance";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const payments = await listRevenuePayments(parseId(id));
    return NextResponse.json({ payments });
  } catch (error) {
    return financeError(error, "Falha ao carregar pagamentos.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const session = getRequestDashboardSession(request);
    const input = body as unknown as RevenuePaymentInput;
    input.createdByUserId = session?.user.id ?? null;
    input.createdByName = session?.user.name ?? null;
    const result = await createRevenuePayment(parseId(id), input);
    return NextResponse.json(result);
  } catch (error) {
    return financeError(error, "Falha ao lançar pagamento.");
  }
}
