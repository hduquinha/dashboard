import { NextResponse, type NextRequest } from "next/server";
import { actorOf, requireTasks } from "@/lib/tasksApi";
import { getTask } from "@/lib/tasks";
import {
  deleteChecklistItem,
  logActivity,
  taskIdOfChecklistItem,
  updateChecklistItem,
  userCanAccessChecklistItem,
} from "@/lib/taskDetails";
import { maybeTriggerChecklistComplete } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessChecklistItem(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  await updateChecklistItem(id, {
    text: body?.text,
    done: typeof body?.done === "boolean" ? body.done : undefined,
    memberId: body?.memberId,
    dueDate: body?.dueDate,
  });

  // Marcar o último item pode fechar a checklist inteira — é o gatilho
  // "quando a checklist terminar" das automações.
  if (body?.done === true) {
    const taskId = await taskIdOfChecklistItem(id);
    if (taskId) {
      const task = await getTask(taskId);
      const actor = await actorOf(auth.user);
      await logActivity({ taskId, boardId: task?.boardId ?? null, actor, action: "checklist_item_done", detail: {} });
      if (task) await maybeTriggerChecklistComplete(taskId, task.boardId, actor);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessChecklistItem(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteChecklistItem(id);
  return NextResponse.json({ ok: true });
}
