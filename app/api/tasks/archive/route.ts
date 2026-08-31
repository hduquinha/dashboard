import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import {
  archiveToCsv,
  getArchiveSummary,
  getTaskArchiveScope,
  listArchiveMonths,
  listArchivedTasksByMonth,
  type TaskArchiveFilters,
} from "@/lib/tasksArchive";

export const dynamic = "force-dynamic";

function positiveInt(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseFilters(params: URLSearchParams): TaskArchiveFilters {
  const month = params.get("month");
  return {
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
    boardId: positiveInt(params.get("board")),
    memberId: positiveInt(params.get("member")),
    search: params.get("q") || null,
  };
}

/**
 * Arquivo mensal: tarefas concluídas de um mês, dos quadros que o usuário pode
 * abrir. `format=csv` devolve o mês inteiro em planilha.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;

  const filters = parseFilters(params);
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "60", 10) || 60, 1), 200);
  const offset = Math.max(Number.parseInt(params.get("offset") ?? "0", 10) || 0, 0);

  try {
    const scope = await getTaskArchiveScope(auth.user);

    if (params.get("format") === "csv") {
      const { tasks } = await listArchivedTasksByMonth(scope, filters, { limit: 5000, offset: 0 });
      const name = `tarefas-concluidas-${filters.month ?? "todos-os-meses"}.csv`;
      return new NextResponse(archiveToCsv(tasks), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      });
    }

    const [{ tasks, hasMore }, summary, months] = await Promise.all([
      listArchivedTasksByMonth(scope, filters, { limit, offset }),
      params.get("summary") === "1" ? getArchiveSummary(scope, filters) : Promise.resolve(null),
      params.get("months") === "1" ? listArchiveMonths(scope) : Promise.resolve(null),
    ]);

    return NextResponse.json({ tasks, hasMore, summary, months });
  } catch (error) {
    console.error("[tasks] falha ao carregar o arquivo mensal", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar o arquivo." },
      { status: 500 }
    );
  }
}
