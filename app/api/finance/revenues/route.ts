import { NextResponse, type NextRequest } from "next/server";
import { createRevenue, listRevenues, type RevenueInput } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseFinanceFilters, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const revenues = await listRevenues(parseFinanceFilters(searchParams));
  return NextResponse.json({ revenues });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = (await readJsonBody(request)) as unknown as RevenueInput;
    const id = await auditFinance(request, { entity: "revenue", action: "create" }, () =>
      createRevenue(body)
    );
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar receita.");
  }
}
