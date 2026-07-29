import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, currentMemberId } from "@/lib/tasksApi";
import { createTask, userCanAccessBoard } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const boardId = Number(body?.boardId);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!Number.isFinite(boardId) || !title) {
    return NextResponse.json({ error: "boardId e titulo sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const createdBy = await currentMemberId(auth.user);
  const task = await createTask({
    boardId,
    columnId: typeof body?.columnId === "number" ? body.columnId : null,
    title,
    description: body?.description ?? null,
    priority: body?.priority,
    dueDate: body?.dueDate ?? null,
    assigneeIds: Array.isArray(body?.assigneeIds) ? body.assigneeIds.filter((n: unknown) => typeof n === "number") : [],
    labelIds: Array.isArray(body?.labelIds) ? body.labelIds.filter((n: unknown) => typeof n === "number") : [],
    createdBy,
  });
  return NextResponse.json({ task });
}
