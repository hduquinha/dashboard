import { NextResponse, type NextRequest } from "next/server";
import {
  getFinanceAuditFilterOptions,
  getFinanceAuditLog,
  getFinanceAuditSummary,
} from "@/lib/financeAudit";
import type { FinanceAuditAction, FinanceAuditFilters } from "@/types/financeAudit";
import { financeError, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

const VALID_ACTIONS: FinanceAuditAction[] = ["create", "update", "delete", "attach", "status"];

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Feed do Registro de Auditoria financeiro. Mesma permissao do resto do
 * modulo (`view.finance`): quem enxerga o dinheiro enxerga quem mexeu nele.
 */
export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const filters: FinanceAuditFilters = {
      from: searchParams.get("from") || null,
      to: searchParams.get("to") || null,
      entities: parseList(searchParams.get("entities")),
      actions: parseList(searchParams.get("actions")).filter((action): action is FinanceAuditAction =>
        VALID_ACTIONS.includes(action as FinanceAuditAction)
      ),
      actorEmail: searchParams.get("actor") || null,
      search: searchParams.get("search") || null,
    };

    const limit = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const offset = Number.parseInt(searchParams.get("offset") ?? "", 10);

    const [log, summary, options] = await Promise.all([
      getFinanceAuditLog(filters, {
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
      getFinanceAuditSummary(filters),
      getFinanceAuditFilterOptions(),
    ]);

    return NextResponse.json({ ...log, summary, options });
  } catch (error) {
    return financeError(error, "Falha ao carregar registro de auditoria.");
  }
}
