import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { listArchivedColumns, listArchivedTasks, userCanAccessBoard } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** Itens arquivados do quadro (cards e colunas), para restaurar ou excluir. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number((await params).id);
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const [tasks, columns] = await Promise.all([listArchivedTasks(boardId), listArchivedColumns(boardId)]);
  return NextResponse.json({ tasks, columns });
}
