import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { createColumn, userCanAccessBoard } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const boardId = Number(body?.boardId);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!Number.isFinite(boardId) || !name) {
    return NextResponse.json({ error: "boardId e nome sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const column = await createColumn(boardId, name, body?.color);
  return NextResponse.json({ column });
}
