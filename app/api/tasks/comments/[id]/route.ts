import { NextResponse, type NextRequest } from "next/server";
import { actorOf, requireTasks } from "@/lib/tasksApi";
import { isSuperMaster } from "@/lib/permissions";
import { userCanAccessTask } from "@/lib/tasks";
import { deleteComment, taskIdOfComment, toggleReaction, updateComment } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

async function guard(request: NextRequest, commentId: number) {
  const auth = await requireTasks(request);
  if (!auth.ok) return { fail: auth.response } as const;
  const taskId = await taskIdOfComment(commentId);
  if (taskId === null || !(await userCanAccessTask(auth.user, taskId))) {
    return { fail: NextResponse.json({ error: "Sem acesso." }, { status: 403 }) } as const;
  }
  return { user: auth.user, taskId } as const;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const commentId = Number((await params).id);
  const check = await guard(request, commentId);
  if ("fail" in check) return check.fail;
  const body = await request.json().catch(() => ({}));
  const actor = await actorOf(check.user);

  // Reação de emoji (o mesmo endpoint: é sempre "mexer neste comentário").
  if (typeof body?.emoji === "string" && actor.email) {
    await toggleReaction(commentId, actor.email, body.emoji.slice(0, 8));
    return NextResponse.json({ ok: true });
  }

  if (typeof body?.body === "string") {
    const ok = await updateComment(commentId, body.body, actor.email);
    if (!ok) return NextResponse.json({ error: "Só o autor pode editar o comentário." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const commentId = Number((await params).id);
  const check = await guard(request, commentId);
  if ("fail" in check) return check.fail;
  const actor = await actorOf(check.user);
  // Super master apaga qualquer comentário; os demais, só o próprio.
  const ok = await deleteComment(commentId, actor.email, isSuperMaster(check.user));
  if (!ok) return NextResponse.json({ error: "Só o autor pode excluir o comentário." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
