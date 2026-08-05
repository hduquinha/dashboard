import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { createCustomField, CUSTOM_FIELD_TYPES, listCustomFields, userCanAccessBoard } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number(new URL(request.url).searchParams.get("boardId") ?? "");
  if (!Number.isFinite(boardId) || !(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  return NextResponse.json({ fields: await listCustomFields(boardId) });
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
  const type = CUSTOM_FIELD_TYPES.includes(body?.type) ? body.type : "text";
  const field = await createCustomField({
    boardId,
    name,
    type,
    options: Array.isArray(body?.options) ? body.options.map(String) : [],
    showOnCard: Boolean(body?.showOnCard),
  });
  return NextResponse.json({ field });
}
