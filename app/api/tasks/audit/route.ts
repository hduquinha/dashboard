import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import {
  getTaskAuditFilterOptions,
  getTaskAuditLog,
  getTaskAuditScope,
  getTaskAuditSummary,
  type TaskAuditFilters,
} from "@/lib/tasksAudit";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseFilters(params: URLSearchParams): TaskAuditFilters {
  const actions = params
    .get("actions")
    ?.split(",")
    .map((action) => action.trim())
    .filter(Boolean);

  return {
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to")),
    boardId: parsePositiveInt(params.get("board")),
    actions,
    actorEmail: params.get("actor") || null,
    search: params.get("q") || null,
  };
}

/** Registro consolidado das ações em todos os quadros que o usuário pode acessar. */
export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params);
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const withSummary = params.get("summary") === "1";
  const withOptions = params.get("options") === "1";

  try {
    const scope = await getTaskAuditScope(auth.user);
    const [{ events, hasMore }, summary, options] = await Promise.all([
      getTaskAuditLog(scope, filters, { limit, offset }),
      withSummary ? getTaskAuditSummary(scope, filters) : Promise.resolve(null),
      withOptions ? getTaskAuditFilterOptions(scope) : Promise.resolve(null),
    ]);
    return NextResponse.json({ events, hasMore, summary, options });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar a auditoria de tarefas." },
      { status: 500 }
    );
  }
}
