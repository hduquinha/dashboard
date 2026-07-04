import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { getCommercialChannelMetrics } from "@/lib/commercialReports";
import { isProductivityManager } from "@/lib/productivity";

export const dynamic = "force-dynamic";

function unauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

function pickDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  const searchParams = request.nextUrl.searchParams;
  const dateFrom = pickDate(searchParams.get("dateFrom"));
  const dateTo = pickDate(searchParams.get("dateTo"));
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "Periodo invalido" }, { status: 400 });
  }

  const isManager = isProductivityManager(session?.user ?? null);
  const requestedSellerEmail = searchParams.get("sellerEmail");
  const sellerEmail = isManager ? requestedSellerEmail : session?.user?.email ?? null;

  try {
    const matrix = await getCommercialChannelMetrics({ dateFrom, dateTo, sellerEmail });
    return NextResponse.json({ matrix });
  } catch (error) {
    console.error("Failed to load productivity channel metrics", error);
    return NextResponse.json({ error: "Erro ao carregar metricas por canal" }, { status: 500 });
  }
}
