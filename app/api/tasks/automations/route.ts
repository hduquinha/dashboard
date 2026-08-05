import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksAdmin } from "@/lib/tasksApi";
import { userCanAccessBoard } from "@/lib/tasks";
import { createAutomation, listAutomations, type AutomationKind } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

const KINDS: AutomationKind[] = ["rule", "button", "schedule"];

export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const boardId = Number(new URL(request.url).searchParams.get("boardId") ?? "");
  if (!Number.isFinite(boardId) || !(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  return NextResponse.json({ automations: await listAutomations(boardId) });
}

/** Criar automação exige tasks.admin: é regra que age sozinha no quadro. */
export async function POST(request: NextRequest) {
  const auth = await requireTasksAdmin(request);
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
  const automation = await createAutomation({
    boardId,
    kind: KINDS.includes(body?.kind) ? body.kind : "rule",
    name,
    trigger: body?.trigger ?? { type: "card_created" },
    actions: Array.isArray(body?.actions) ? body.actions : [],
    scheduleKind: body?.scheduleKind ?? null,
    scheduleTime: body?.scheduleTime ?? null,
    scheduleWeekday: typeof body?.scheduleWeekday === "number" ? body.scheduleWeekday : null,
    scheduleDay: typeof body?.scheduleDay === "number" ? body.scheduleDay : null,
  });
  return NextResponse.json({ automation });
}
