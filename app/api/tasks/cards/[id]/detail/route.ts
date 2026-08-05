import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { getTask, userCanAccessTask } from "@/lib/tasks";
import { getTaskDetail } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

/** Tudo que vive dentro do card: checklists, comentários, anexos e histórico. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const taskId = Number((await params).id);
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const [task, detail] = await Promise.all([getTask(taskId), getTaskDetail(taskId)]);
  if (!task) return NextResponse.json({ error: "Tarefa nao encontrada." }, { status: 404 });
  return NextResponse.json({ task, ...detail });
}
