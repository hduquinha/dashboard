import { NextResponse, type NextRequest } from "next/server";
import { actorOf, currentMemberId, requireTasks } from "@/lib/tasksApi";
import { createTask, userCanAccessBoard } from "@/lib/tasks";
import { applyCardTemplate, logActivity, userCanAccessTemplate } from "@/lib/taskDetails";
import { notifyTaskMembers, runAutomations } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const createdBy = await currentMemberId(auth.user);
  const actor = await actorOf(auth.user);

  // Criar a partir de um template de card (o "Card Template" do Trello).
  if (body?.templateId) {
    const templateId = Number(body.templateId);
    if (!(await userCanAccessTemplate(auth.user, templateId))) {
      return NextResponse.json({ error: "Sem acesso a este modelo." }, { status: 403 });
    }
    const task = await applyCardTemplate({
      templateId,
      columnId: typeof body?.columnId === "number" ? body.columnId : null,
      createdBy,
      titleOverride: typeof body?.title === "string" ? body.title : undefined,
    });
    if (!task) return NextResponse.json({ error: "Modelo nao encontrado." }, { status: 404 });
    await logActivity({
      taskId: task.id,
      boardId: task.boardId,
      actor,
      action: "card_created",
      detail: { fromTemplate: true },
    });
    await runAutomations({
      type: "card_created",
      boardId: task.boardId,
      taskId: task.id,
      columnId: task.columnId,
      actor,
    });
    return NextResponse.json({ task });
  }

  const boardId = Number(body?.boardId);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!Number.isFinite(boardId) || !title) {
    return NextResponse.json({ error: "boardId e titulo sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const assigneeIds: number[] = Array.isArray(body?.assigneeIds)
    ? body.assigneeIds.filter((n: unknown) => typeof n === "number")
    : [];
  const task = await createTask({
    boardId,
    columnId: typeof body?.columnId === "number" ? body.columnId : null,
    title,
    description: body?.description ?? null,
    priority: body?.priority,
    startDate: body?.startDate ?? null,
    dueDate: body?.dueDate ?? null,
    coverColor: body?.coverColor ?? null,
    assigneeIds,
    labelIds: Array.isArray(body?.labelIds) ? body.labelIds.filter((n: unknown) => typeof n === "number") : [],
    createdBy,
  });

  await logActivity({ taskId: task.id, boardId, actor, action: "card_created", detail: { title } });
  if (assigneeIds.length > 0) {
    await notifyTaskMembers(assigneeIds, task, "task_assigned", `${actor.name} criou uma tarefa para você.`);
  }
  await runAutomations({ type: "card_created", boardId, taskId: task.id, columnId: task.columnId, actor });

  return NextResponse.json({ task });
}
