import { NextResponse, type NextRequest } from "next/server";
import { actorOf, requireTasks } from "@/lib/tasksApi";
import { getTask, userCanAccessTask } from "@/lib/tasks";
import { createChecklist, logActivity } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const taskId = Number(body?.taskId);
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: "taskId invalido." }, { status: 400 });
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const items = Array.isArray(body?.items) ? body.items.map(String) : [];
  const checklist = await createChecklist(taskId, String(body?.name ?? "Checklist"), items);
  const task = await getTask(taskId);
  await logActivity({
    taskId,
    boardId: task?.boardId ?? null,
    actor: await actorOf(auth.user),
    action: "checklist_created",
    detail: { name: checklist.name },
  });
  return NextResponse.json({ checklist });
}
