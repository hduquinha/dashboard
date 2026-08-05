import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { createLabel, userCanAccessBoard } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const boardId = Number(body?.boardId);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const color = typeof body?.color === "string" && HEX.test(body.color) ? body.color : "#64748b";
  if (!Number.isFinite(boardId) || !name) {
    return NextResponse.json({ error: "boardId e nome sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const label = await createLabel(boardId, name, color);
  return NextResponse.json({ label });
}
