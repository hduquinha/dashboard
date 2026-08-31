import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession, type DashboardUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  findRecentDuplicateTask,
  listBoardsForLeadTasks,
  listLeadTasks,
  memberIdForEmail,
} from "@/lib/leadTasks";
import { createTask } from "@/lib/tasks";
import { logLeadTimelineEvent } from "@/lib/commercial";
import { listInscricoesByIds } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Lead invalido.");
  return parsed;
}

async function requireTaskAccess(): Promise<
  { error: NextResponse; user: null } | { error: null; user: DashboardUser }
> {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), user: null };
  }
  // Quem trabalha o lead cria tarefa dele; o modulo /tarefas continua gated
  // pelo view.tasks para o resto (quadros, setores, equipes).
  if (!hasPermission(session.user, "view.tasks")) {
    return {
      error: NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 }),
      user: null,
    };
  }
  return { error: null, user: session.user };
}

/** Tarefas do lead + quadros disponiveis para criar uma nova. */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTaskAccess();
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const leadId = parseId(id);
    const [tasks, boards, memberId] = await Promise.all([
      listLeadTasks(leadId),
      listBoardsForLeadTasks(auth.user),
      memberIdForEmail(auth.user.email),
    ]);
    return NextResponse.json({ tasks, boards, memberId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar as tarefas." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireTaskAccess();
  if (auth.error) return auth.error;

  try {
    const [{ id }, body] = await Promise.all([
      context.params,
      request.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    ]);
    const leadId = parseId(id);

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw new Error("Informe o que precisa ser feito.");

    const boardId = Number(body.boardId);
    if (!Number.isFinite(boardId) || boardId < 1) throw new Error("Escolha o quadro da tarefa.");

    // O quadro tem que estar entre os que o usuario enxerga — sem isso uma
    // chamada a mao criaria tarefa em setor a que ele nao tem acesso.
    const boards = await listBoardsForLeadTasks(auth.user);
    const board = boards.find((candidate) => candidate.id === boardId);
    if (!board) throw new Error("Sem acesso a este quadro.");

    const columnId = Number(body.columnId);
    const column = board.columns.find((candidate) => candidate.id === columnId);

    const dueDate = typeof body.dueDate === "string" && DATE_PATTERN.test(body.dueDate) ? body.dueDate : null;
    const dueTime = typeof body.dueTime === "string" && TIME_PATTERN.test(body.dueTime) ? body.dueTime : null;
    if (dueTime && !dueDate) throw new Error("Informe a data junto com o horario.");

    const assigneeIds = Array.isArray(body.assigneeIds)
      ? body.assigneeIds.map(Number).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    // Sem responsavel indicado, a tarefa vai para quem cuida do lead — e a
    // agenda dele que precisa mostrar a ligacao de retorno. Sem vendedor
    // atribuido, fica com quem criou. Tarefa sem dono nao aparece na agenda de
    // ninguem e morre na lista.
    // Requisição repetida (duplo-clique, retry do navegador) devolve a tarefa
    // que já foi criada em vez de criar outra igual.
    const duplicateId = await findRecentDuplicateTask({ inscricaoId: leadId, title, dueDate, dueTime });
    if (duplicateId !== null) {
      const existentes = await listLeadTasks(leadId);
      return NextResponse.json({ task: existentes.find((item) => item.id === duplicateId) ?? null, duplicate: true });
    }

    const creatorMember = await memberIdForEmail(auth.user.email);
    const [lead] = await listInscricoesByIds([leadId]);
    const ownerMember = await memberIdForEmail(lead?.commercial?.assignedSellerEmail ?? null);
    const finalAssignees =
      assigneeIds.length > 0
        ? assigneeIds
        : [ownerMember ?? creatorMember].filter((value): value is number => typeof value === "number");

    const task = await createTask({
      boardId,
      columnId: column?.id ?? board.columns[0]?.id ?? null,
      title,
      description: typeof body.description === "string" ? body.description : null,
      priority: typeof body.priority === "string" ? (body.priority as "baixa" | "media" | "alta") : undefined,
      dueDate,
      dueTime,
      inscricaoId: leadId,
      assigneeIds: finalAssignees,
      createdBy: creatorMember,
    });

    await logLeadTimelineEvent(auth.user, leadId, "task_created", {
      taskId: task.id,
      title,
      dueDate,
      dueTime,
      boardId,
      boardName: board.name,
    });

    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar a tarefa." },
      { status: 400 }
    );
  }
}
