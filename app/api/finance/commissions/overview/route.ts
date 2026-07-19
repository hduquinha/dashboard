import { NextResponse, type NextRequest } from "next/server";
import { getCommissionsOverview } from "@/lib/finance";
import { financeError, parseFinanceFilters, requireFinanceAccess } from "../../utils";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const overview = await getCommissionsOverview(parseFinanceFilters(searchParams));
    return NextResponse.json(overview);
  } catch (error) {
    return financeError(error, "Falha ao carregar visão geral de comissões.");
  }
}
