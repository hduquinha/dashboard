import { NextResponse, type NextRequest } from "next/server";
import { createFixedExpense, currentMonth, listFixedExpenses, type FixedExpenseInput } from "@/lib/finance";
import { financeError, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") || currentMonth();
  const fixedExpenses = await listFixedExpenses(month);
  return NextResponse.json({ fixedExpenses });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const id = await createFixedExpense((await readJsonBody(request)) as unknown as FixedExpenseInput);
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar despesa fixa.");
  }
}
