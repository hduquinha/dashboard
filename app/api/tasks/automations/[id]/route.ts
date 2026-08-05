import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksAdmin } from "@/lib/tasksApi";
import { deleteAutomation, updateAutomation, userCanAccessAutomation } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessAutomation(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  await updateAutomation(id, {
    name: body?.name,
    enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
    trigger: body?.trigger,
    actions: Array.isArray(body?.actions) ? body.actions : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessAutomation(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteAutomation(id);
  return NextResponse.json({ ok: true });
}

/**
 * Aciona um botão de automação sobre um card. Diferente de criar a regra,
 * apertar o botão é uso normal do quadro — basta view.tasks.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessAutomation(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const taskId = Number(body?.taskId);
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: "taskId obrigatorio." }, { status: 400 });

  const { getAutomation, runActions } = await import("@/lib/taskAutomations");
  const { userCanAccessTask } = await import("@/lib/tasks");
  const { actorOf } = await import("@/lib/tasksApi");
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }
  const automation = await getAutomation(id);
  if (!automation) return NextResponse.json({ error: "Automacao nao encontrada." }, { status: 404 });
  const applied = await runActions(automation, taskId, await actorOf(auth.user));
  return NextResponse.json({ ok: true, applied });
}
