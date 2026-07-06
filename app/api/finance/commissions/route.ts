import { NextResponse, type NextRequest } from "next/server";
import { createCommission, currentMonth, getCommissionPanel, listCommissions, type CommissionInput } from "@/lib/finance";
import { financeError, parseFinanceFilters, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const filters = parseFinanceFilters(searchParams);
  const month = searchParams.get("month") || filters.to || currentMonth();
  const [commissions, panel] = await Promise.all([
    listCommissions(filters),
    getCommissionPanel(month),
  ]);
  return NextResponse.json({ commissions, panel });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const id = await createCommission((await readJsonBody(request)) as unknown as CommissionInput);
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar comissao.");
  }
}
