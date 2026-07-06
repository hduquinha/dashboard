import { NextResponse, type NextRequest } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { FinanceFilters } from "@/types/finance";

export function requireFinanceAccess(request: NextRequest): NextResponse | null {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    throw error;
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "view.finance")) {
    return NextResponse.json({ error: "Sem permissao para acessar financeiro." }, { status: 403 });
  }

  return null;
}

export function parseId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("ID invalido.");
  }
  return parsed;
}

export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function parseNumberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseFinanceFilters(searchParams: URLSearchParams): FinanceFilters {
  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    branchId: parseNumberParam(searchParams.get("branchId")),
    courseId: parseNumberParam(searchParams.get("courseId")),
    categoryId: parseNumberParam(searchParams.get("categoryId")),
    sellerId: parseNumberParam(searchParams.get("sellerId")),
    paymentMethodId: parseNumberParam(searchParams.get("paymentMethodId")),
  };
}

export function financeError(error: unknown, fallback = "Falha ao processar financeiro.") {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}
