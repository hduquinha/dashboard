import { NextResponse, type NextRequest } from "next/server";
import { assertAuthenticatedRequest, getRequestDashboardSession, UnauthorizedError } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getAuditLog, getAuditSummary, type AuditLogFilters } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

function requireAuditAccess(request: NextRequest): NextResponse | null {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    throw error;
  }
  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "admin.audit")) {
    return NextResponse.json({ error: "Sem permissao para o registro de auditoria." }, { status: 403 });
  }
  return null;
}

function parseFilters(params: URLSearchParams): AuditLogFilters {
  const typesRaw = params.get("types");
  return {
    from: params.get("from") || null,
    to: params.get("to") || null,
    types: typesRaw ? typesRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
    actorEmail: params.get("actor") || null,
    search: params.get("q") || null,
  };
}

export async function GET(request: NextRequest) {
  const denied = requireAuditAccess(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10);
  const withSummary = searchParams.get("summary") === "1";

  try {
    const [{ events, hasMore }, summary] = await Promise.all([
      getAuditLog(filters, {
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
      withSummary ? getAuditSummary(filters) : Promise.resolve(null),
    ]);
    return NextResponse.json({ events, hasMore, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar o registro de auditoria." },
      { status: 500 }
    );
  }
}
