import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksAdmin } from "@/lib/tasksApi";
import { getBoardData, sectorIdOfBoard, updateBoard, userCanAccessSector } from "@/lib/tasks";

export const dynamic = "force-dynamic";

async function assertBoardAccess(request: NextRequest, boardId: number, user: Parameters<typeof userCanAccessSector>[0]) {
  const sectorId = await sectorIdOfBoard(boardId);
  if (sectorId === null) return false;
  return userCanAccessSector(user, sectorId);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number((await params).id);
  if (!(await assertBoardAccess(request, boardId, auth.user))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const data = await getBoardData(boardId);
  if (!data) return NextResponse.json({ error: "Quadro nao encontrado." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const boardId = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  await updateBoard(boardId, { name: body?.name, description: body?.description, archived: body?.archived });
  return NextResponse.json({ ok: true });
}
