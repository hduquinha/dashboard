import { NextResponse, type NextRequest } from "next/server";
import { actorOf, currentMemberId, requireTasks } from "@/lib/tasksApi";
import { getPool } from "@/lib/db";
import { getTask, userCanAccessTask } from "@/lib/tasks";
import { createComment, extractMentions, logActivity } from "@/lib/taskDetails";
import { notifyTaskMembers } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

/**
 * Descobre quem foi citado com @ no comentário. Casa pelo primeiro nome ou
 * pelo email — é assim que a pessoa escreve na prática ("@ana", "@ana.silva").
 */
async function resolveMentions(names: string[]): Promise<number[]> {
  if (names.length === 0) return [];
  const { rows } = await getPool().query<{ id: number; name: string; email: string }>(
    `SELECT id, name, email FROM dashboard.team_members WHERE active`
  );
  const ids = new Set<number>();
  for (const mention of names) {
    for (const member of rows) {
      const first = (member.name ?? "").split(" ")[0]?.toLowerCase();
      const emailUser = (member.email ?? "").split("@")[0]?.toLowerCase();
      if (mention === first || mention === emailUser || mention === (member.email ?? "").toLowerCase()) {
        ids.add(member.id);
      }
    }
  }
  return [...ids];
}

export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const taskId = Number(body?.taskId);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!Number.isFinite(taskId) || !text) {
    return NextResponse.json({ error: "taskId e corpo sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessTask(auth.user, taskId))) {
    return NextResponse.json({ error: "Sem acesso a esta tarefa." }, { status: 403 });
  }

  const actor = await actorOf(auth.user);
  const memberId = await currentMemberId(auth.user);
  const comment = await createComment({
    taskId,
    memberId,
    authorName: actor.name,
    authorEmail: actor.email,
    body: text,
  });

  const task = await getTask(taskId);
  await logActivity({ taskId, boardId: task?.boardId ?? null, actor, action: "comment_added", detail: {} });

  if (task) {
    const mentioned = await resolveMentions(extractMentions(text));
    if (mentioned.length > 0) {
      await notifyTaskMembers(mentioned, task, "task_mention", `${actor.name} citou você: ${text.slice(0, 120)}`);
    }
    // Quem é responsável pelo card fica sabendo do comentário, menos quem
    // escreveu (ninguém precisa de aviso do próprio comentário).
    const others = task.assigneeIds.filter((id) => id !== memberId && !mentioned.includes(id));
    if (others.length > 0) {
      await notifyTaskMembers(others, task, "task_mention", `${actor.name} comentou: ${text.slice(0, 120)}`);
    }
  }

  return NextResponse.json({ comment });
}
