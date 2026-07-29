import { NextResponse, type NextRequest } from "next/server";
import { createVariableExpense, listVariableExpenses, type VariableExpenseInput } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseFinanceFilters, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const filters = parseFinanceFilters(searchParams);
  const month = searchParams.get("month");
  const variableExpenses = await listVariableExpenses(
    month && !filters.from && !filters.to ? { ...filters, from: month, to: month } : filters
  );
  return NextResponse.json({ variableExpenses });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = (await readJsonBody(request)) as unknown as VariableExpenseInput;
    const id = await auditFinance(request, { entity: "variable_expense", action: "create" }, () =>
      createVariableExpense(body)
    );
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar despesa variavel.");
  }
}
