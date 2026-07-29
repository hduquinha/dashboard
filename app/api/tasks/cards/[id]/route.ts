import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { moveTask, setTaskAssignees, setTaskLabels, updateTask, userCanAccessTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const taskId = Number((await params).id);
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));

  // Mover entre colunas / reordenar
  if (body?.action === "move" && Array.isArray(body?.orderedTaskIds)) {
    try {
      await moveTask(
        taskId,
        typeof body.columnId === "number" ? body.columnId : null,
        body.orderedTaskIds.filter((n: unknown) => typeof n === "number")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao mover a tarefa.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // Atualização de campos
  if (
    body?.title !== undefined ||
    body?.description !== undefined ||
    body?.priority !== undefined ||
    body?.dueDate !== undefined ||
    body?.completed !== undefined ||
    body?.archived !== undefined
  ) {
    await updateTask(taskId, {
      title: body?.title,
      description: body?.description,
      priority: body?.priority,
      dueDate: body?.dueDate,
      completed: body?.completed,
      archived: body?.archived,
    });
  }
  if (Array.isArray(body?.assigneeIds)) {
    await setTaskAssignees(taskId, body.assigneeIds.filter((n: unknown) => typeof n === "number"));
  }
  if (Array.isArray(body?.labelIds)) {
    await setTaskLabels(taskId, body.labelIds.filter((n: unknown) => typeof n === "number"));
  }
  return NextResponse.json({ ok: true });
}
