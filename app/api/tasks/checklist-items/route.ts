import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { createChecklistItem, userCanAccessChecklist } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const checklistId = Number(body?.checklistId);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!Number.isFinite(checklistId) || !text) {
    return NextResponse.json({ error: "checklistId e texto sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessChecklist(auth.user, checklistId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const item = await createChecklistItem(checklistId, text, {
    memberId: typeof body?.memberId === "number" ? body.memberId : null,
    dueDate: body?.dueDate ?? null,
  });
  return NextResponse.json({ item });
}
