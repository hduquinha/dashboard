import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession, type DashboardUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { memberIdForEmail } from "@/lib/leadTasks";
import { listTeamMembers } from "@/lib/teamAuth";
import {
  getProductionSummary,
  listProductionEntries,
  listRecurringTasks,
  type ProductionFilters,
} from "@/lib/taskProduction";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(value: string | null): string | null {
  return value && DATE_PATTERN.test(value) ? value : null;
}

function optionalId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Filtros do relatório, já com o recorte de permissão aplicado.
 *
 * Quem não administra tarefas só enxerga a própria produção — o recorte é
 * feito aqui, no servidor, e não escondendo o seletor na tela: sem isso
 * bastaria trocar `memberId` na URL para ler a produção da equipe inteira.
 */
export async function buildFilters(
  request: NextRequest,
  user: DashboardUser
): Promise<{ filters: ProductionFilters; canSeeEveryone: boolean }> {
  const params = new URL(request.url).searchParams;
  const canSeeEveryone = hasPermission(user, "tasks.admin") || user.isSupervisor;
  const requestedMember = optionalId(params.get("memberId"));
  const ownMemberId = await memberIdForEmail(user.email);

  return {
    canSeeEveryone,
    filters: {
      from: optionalDate(params.get("from")),
      to: optionalDate(params.get("to")),
      taskId: optionalId(params.get("taskId")),
      boardId: optionalId(params.get("boardId")),
      memberId: canSeeEveryone ? requestedMember : ownMemberId,
    },
  };
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "view.tasks")) {
    return NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 });
  }

  const { filters, canSeeEveryone } = await buildFilters(request, session.user);
  const [summary, entries, tasks, members] = await Promise.all([
    getProductionSummary(filters),
    listProductionEntries(filters, { limit: 500 }),
    listRecurringTasks(filters.boardId),
    canSeeEveryone ? listTeamMembers({ activeOnly: true }) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    summary,
    entries,
    tasks,
    members: members.map((member) => ({ id: member.id, name: member.name })),
    canSeeEveryone,
    filters,
  });
}
