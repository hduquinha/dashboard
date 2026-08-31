import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksAdmin } from "@/lib/tasksApi";
import { getBoardData, updateBoard, userCanAccessBoard } from "@/lib/tasks";
import { memberIdForEmail } from "@/lib/leadTasks";

export const dynamic = "force-dynamic";

async function assertBoardAccess(boardId: number, user: Parameters<typeof userCanAccessBoard>[0]) {
  return userCanAccessBoard(user, boardId);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number((await params).id);
  if (!(await assertBoardAccess(boardId, auth.user))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  // O selo "Pendente hoje" de cada rotina é individual — ver getBoardData.
  const data = await getBoardData(boardId, await memberIdForEmail(auth.user.email));
  if (!data) return NextResponse.json({ error: "Quadro nao encontrado." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const boardId = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  await updateBoard(boardId, {
    name: body?.name,
    description: body?.description,
    archived: body?.archived,
    visibility: body?.visibility,
  });
  return NextResponse.json({ ok: true });
}
