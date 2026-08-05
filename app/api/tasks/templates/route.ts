import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { userCanAccessBoard } from "@/lib/tasks";
import { createCardTemplate, listCardTemplates } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number(new URL(request.url).searchParams.get("boardId") ?? "");
  if (!Number.isFinite(boardId) || !(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  return NextResponse.json({ templates: await listCardTemplates(boardId) });
}

export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
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
  const template = await createCardTemplate(boardId, name, body?.payload ?? {});
  return NextResponse.json({ template });
}
