import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession, type DashboardUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { memberIdForEmail } from "@/lib/leadTasks";
import { userCanAccessBoard } from "@/lib/tasks";
import { getPool } from "@/lib/db";
import {
  archiveTaskMetric,
  createTaskMetric,
  deleteProductionEntry,
  getProductionEntry,
  listTaskMetrics,
  listTaskProduction,
  saveProduction,
  METRIC_UNITS,
  type MetricUnit,
} from "@/lib/taskProduction";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface Auth {
  user: DashboardUser;
}

async function requireAuth(): Promise<{ error: NextResponse } | Auth> {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }) };
  if (!hasPermission(session.user, "view.tasks")) {
    return { error: NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 }) };
  }
  return { user: session.user };
}

/**
 * O acesso é sempre resolvido pelo QUADRO da tarefa, reusando a mesma regra de
 * setor/equipe do módulo /tarefas. Sem isso, saber o id de uma tarefa bastaria
 * para ler ou lançar produção em setor alheio.
 */
async function taskBoardId(taskId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM dashboard.tasks WHERE id = $1`,
    [taskId]
  );
  return rows[0]?.board_id ?? null;
}

async function assertTaskAccess(user: DashboardUser, taskId: number): Promise<NextResponse | null> {
  const boardId = await taskBoardId(taskId);
  if (!boardId) return NextResponse.json({ error: "Tarefa nao encontrada." }, { status: 404 });
  if (!(await userCanAccessBoard(user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  return null;
}

/** Indicadores + histórico paginado de uma tarefa recorrente. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  const taskId = Number(params.get("taskId"));
  if (!Number.isFinite(taskId) || taskId < 1) {
    return NextResponse.json({ error: "Tarefa invalida." }, { status: 400 });
  }

  const denied = await assertTaskAccess(auth.user, taskId);
  if (denied) return denied;

  const limit = Number(params.get("limit")) || 30;
  const offset = Number(params.get("offset")) || 0;
  const [metrics, history, memberId] = await Promise.all([
    listTaskMetrics(taskId),
    listTaskProduction(taskId, { limit, offset }),
    memberIdForEmail(auth.user.email),
  ]);

  // A UI usa isto só para mostrar/esconder o botão de remover; quem decide de
  // verdade é o gate do DELETE mais abaixo.
  const canManageAny = hasPermission(auth.user, "tasks.admin") || auth.user.isSupervisor;
  return NextResponse.json({
    metrics,
    ...history,
    memberId,
    memberName: auth.user.name ?? auth.user.email,
    canManageAny,
  });
}

/** Cria indicador (`action: "metric"`) ou grava a produção de um dia. */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const taskId = Number(body.taskId);
    if (!Number.isFinite(taskId) || taskId < 1) throw new Error("Tarefa invalida.");

    const denied = await assertTaskAccess(auth.user, taskId);
    if (denied) return denied;

    if (body.action === "metric") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new Error("Informe o nome do indicador.");
      const unit = METRIC_UNITS.includes(body.unit as MetricUnit) ? (body.unit as MetricUnit) : "inteiro";
      const metricId = await createTaskMetric({ taskId, name, unit });
      return NextResponse.json({ metricId, metrics: await listTaskMetrics(taskId) });
    }

    const entryDate = typeof body.entryDate === "string" ? body.entryDate : "";
    if (!DATE_PATTERN.test(entryDate)) throw new Error("Informe a data do registro.");

    // Quem lança para si mesmo é o padrão; supervisor/admin pode lançar pela
    // equipe, e é por isso que created_by fica separado de member_id.
    const ownMemberId = await memberIdForEmail(auth.user.email);
    const canLogForOthers = hasPermission(auth.user, "tasks.admin") || auth.user.isSupervisor;
    const requested = Number(body.memberId);
    const memberId =
      Number.isFinite(requested) && requested > 0 && canLogForOthers ? requested : ownMemberId;
    if (!memberId) throw new Error("Seu usuario nao esta na equipe; nao da para registrar producao.");

    const rawValues = (body.values ?? {}) as Record<string, unknown>;
    const values: Record<number, number | string | boolean | null> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      const metricId = Number(key);
      if (!Number.isFinite(metricId)) continue;
      values[metricId] = value === null || value === "" ? null : (value as number | string | boolean);
    }

    const result = await saveProduction({
      taskId,
      memberId,
      entryDate,
      note: typeof body.note === "string" ? body.note.trim() || null : null,
      createdBy: ownMemberId,
      values,
    });

    return NextResponse.json({
      ...result,
      entry: await getProductionEntry(result.entryId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar a producao." },
      { status: 400 }
    );
  }
}

/** Remove um registro de produção ou arquiva um indicador. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const params = new URL(request.url).searchParams;
    const metricId = Number(params.get("metricId"));
    const entryId = Number(params.get("entryId"));

    if (Number.isFinite(metricId) && metricId > 0) {
      const { rows } = await getPool().query<{ task_id: number }>(
        `SELECT task_id FROM dashboard.task_metrics WHERE id = $1`,
        [metricId]
      );
      if (!rows[0]) throw new Error("Indicador nao encontrado.");
      const denied = await assertTaskAccess(auth.user, rows[0].task_id);
      if (denied) return denied;
      await archiveTaskMetric(metricId);
      return NextResponse.json({ ok: true });
    }

    if (!Number.isFinite(entryId) || entryId < 1) throw new Error("Registro invalido.");
    const entry = await getProductionEntry(entryId);
    if (!entry) throw new Error("Registro nao encontrado.");
    const denied = await assertTaskAccess(auth.user, entry.taskId);
    if (denied) return denied;

    // Só o dono do registro (ou quem administra) apaga produção alheia.
    const ownMemberId = await memberIdForEmail(auth.user.email);
    const canManageAny = hasPermission(auth.user, "tasks.admin") || auth.user.isSupervisor;
    if (!canManageAny && entry.memberId !== ownMemberId) {
      return NextResponse.json({ error: "Este registro nao e seu." }, { status: 403 });
    }

    await deleteProductionEntry(entryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover." },
      { status: 400 }
    );
  }
}
