import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { userCanAccessBoard } from "@/lib/tasks";
import { listBoardActivity } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

/** Feed de atividade do quadro inteiro. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number((await params).id);
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  return NextResponse.json({ activity: await listBoardActivity(boardId) });
}
