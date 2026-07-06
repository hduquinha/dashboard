import { NextResponse, type NextRequest } from "next/server";
import { createVariableExpense, listVariableExpenses, type VariableExpenseInput } from "@/lib/finance";
import { financeError, parseFinanceFilters, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const variableExpenses = await listVariableExpenses(parseFinanceFilters(searchParams));
  return NextResponse.json({ variableExpenses });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const id = await createVariableExpense((await readJsonBody(request)) as unknown as VariableExpenseInput);
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar despesa variavel.");
  }
}
