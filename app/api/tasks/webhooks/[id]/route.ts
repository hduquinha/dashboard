import { NextResponse, type NextRequest } from "next/server";
import { requireTasksAdmin } from "@/lib/tasksApi";
import { userCanAccessBoard } from "@/lib/tasks";
import { boardIdOfWebhook, deleteWebhook } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const boardId = await boardIdOfWebhook(id);
  if (boardId === null || !(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteWebhook(id);
  return NextResponse.json({ ok: true });
}
