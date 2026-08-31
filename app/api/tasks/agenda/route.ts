import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getMemberAgenda, isTaskAssignee, memberIdForEmail } from "@/lib/leadTasks";
import { getTask, moveTask, syncTaskCompletionColumn, updateTask } from "@/lib/tasks";
import { actorOf } from "@/lib/tasksApi";
import { logActivity } from "@/lib/taskDetails";
import { logLeadTimelineEvent } from "@/lib/commercial";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Agenda de tarefas de quem está logado — é o que o Kanban do vendedor
 * espelha em forma de lista. Supervisor pode olhar a de outra pessoa passando
 * `memberId`; vendedor só vê a própria.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "view.tasks")) {
    return NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 });
  }

  const ownMemberId = await memberIdForEmail(session.user.email);
  const requested = Number(new URL(request.url).searchParams.get("memberId"));
  const canSeeOthers = hasPermission(session.user, "tasks.admin") || session.user.isSupervisor;
  const memberId = Number.isFinite(requested) && requested > 0 && canSeeOthers ? requested : ownMemberId;

  if (!memberId) {
    // Usuário sem cadastro em team_members não tem tarefas atribuídas a ele.
    return NextResponse.json({
      agenda: { tasks: [], columns: [], counts: { atrasada: 0, hoje: 0, proxima: 0, semData: 0 } },
      memberId: null,
    });
  }

  const agenda = await getMemberAgenda(memberId);
  return NextResponse.json({ agenda, memberId });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(["baixa", "media", "alta", "urgente"]);

/**
 * Edição de prazo/prioridade pela lista. É a MESMA tarefa da ficha do lead e do
 * quadro em /tarefas — por isso passa pelo `updateTask` do módulo, sem consulta
 * própria: mudar por aqui é mudar lá, não existe cópia para sincronizar.
 *
 * `null` explícito apaga o campo; a chave ausente não mexe nele (é o contrato
 * que o `updateTask` já implementa com as flags "touch").
 */
function parseSchedulePatch(body: Record<string, unknown>) {
  const patch: { dueDate?: string | null; dueTime?: string | null; priority?: "baixa" | "media" | "alta" | "urgente" } = {};

  if (body.dueDate !== undefined) {
    if (body.dueDate === null) {
      patch.dueDate = null;
    } else if (typeof body.dueDate === "string" && DATE_PATTERN.test(body.dueDate)) {
      patch.dueDate = body.dueDate;
    } else {
      throw new Error("Data invalida.");
    }
  }

  if (body.dueTime !== undefined) {
    if (body.dueTime === null || body.dueTime === "") {
      patch.dueTime = null;
    } else if (typeof body.dueTime === "string" && TIME_PATTERN.test(body.dueTime)) {
      patch.dueTime = body.dueTime;
    } else {
      throw new Error("Horario invalido.");
    }
  }

  // Hora sem data não tem como ser ordenada nem cobrada — mesma regra que a
  // criação pela ficha do lead já aplica.
  if (patch.dueTime && patch.dueDate === null) {
    throw new Error("Informe a data junto com o horario.");
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority)) {
      throw new Error("Prioridade invalida.");
    }
    patch.priority = body.priority as "baixa" | "media" | "alta" | "urgente";
  }

  return patch;
}

/**
 * Quem pode mexer nesta tarefa: o responsável por ela, quem administra Tarefas ou
 * supervisor. O gate vive no servidor de propósito — esconder o botão na tela não
 * impede uma chamada direta à rota.
 */
async function assertCanManageTask(
  session: NonNullable<ReturnType<typeof getDashboardSession>>,
  taskId: number
): Promise<NextResponse | null> {
  const canManageAny = hasPermission(session.user, "tasks.admin") || session.user.isSupervisor;
  if (canManageAny) return null;
  const ownMemberId = await memberIdForEmail(session.user.email);
  if (!ownMemberId || !(await isTaskAssignee(taskId, ownMemberId))) {
    return NextResponse.json({ error: "Esta tarefa nao e sua." }, { status: 403 });
  }
  return null;
}

/** Muda fase, prazo, prioridade ou conclusão da tarefa, direto da lista. */
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "view.tasks")) {
    return NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const taskId = Number(body.taskId);
    if (!Number.isFinite(taskId) || taskId < 1) throw new Error("Tarefa invalida.");

    const denied = await assertCanManageTask(session, taskId);
    if (denied) return denied;

    if (body.columnId !== undefined) {
      const columnId = body.columnId === null ? null : Number(body.columnId);
      // Lista não tem ordem própria: manda só a tarefa movida e o moveTask
      // recoloca no fim da coluna de destino.
      await moveTask(taskId, columnId, [taskId]);
    }

    const schedule = parseSchedulePatch(body);
    if (Object.keys(schedule).length > 0) {
      await updateTask(taskId, schedule);
    }

    if (typeof body.completed === "boolean") {
      await updateTask(taskId, { completed: body.completed });
      // Concluir pela agenda tem que levar o card para a coluna de conclusão do
      // quadro, igual a tela /tarefas faz — sem isso a tarefa saía da agenda
      // mas continuava parada em "Backlog" no quadro.
      await syncTaskCompletionColumn(taskId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar a tarefa." },
      { status: 400 }
    );
  }
}

/**
 * Exclui a tarefa direto da agenda do Kanban.
 *
 * É a MESMA tarefa do quadro em /tarefas — some dos dois lugares, porque cópia não
 * existe. Exclusão definitiva (e não arquivamento) porque o caso de uso aqui é o
 * inverso do arquivo: tarefa criada errada, duplicada ou que não deveria existir. Por
 * isso a saída fica registrada duas vezes: no histórico do quadro (`card_deleted`) e,
 * quando a tarefa é de um lead, na linha do tempo dele — apagar um compromisso sem
 * deixar rastro é como o "sumiu do nada" nasce.
 */
export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "view.tasks")) {
    return NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const fromQuery = Number(url.searchParams.get("taskId"));
    const body = fromQuery > 0 ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const taskId = fromQuery > 0 ? fromQuery : Number(body.taskId);
    if (!Number.isFinite(taskId) || taskId < 1) throw new Error("Tarefa invalida.");

    const denied = await assertCanManageTask(session, taskId);
    if (denied) return denied;

    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "Tarefa nao encontrada." }, { status: 404 });

    await getPool().query(`DELETE FROM dashboard.tasks WHERE id = $1`, [taskId]);

    const actor = await actorOf(session.user);
    await logActivity({
      boardId: task.boardId,
      actor,
      action: "card_deleted",
      detail: { title: task.title, via: "agenda" },
    }).catch(() => undefined);

    if (task.inscricaoId) {
      await logLeadTimelineEvent(session.user, task.inscricaoId, "task_deleted", {
        taskId,
        taskTitle: task.title,
        dueDate: task.dueDate,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir a tarefa." },
      { status: 400 }
    );
  }
}
