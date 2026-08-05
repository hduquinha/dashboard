import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { deleteChecklist, updateChecklist, userCanAccessChecklist } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessChecklist(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body?.name === "string") await updateChecklist(id, body.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessChecklist(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteChecklist(id);
  return NextResponse.json({ ok: true });
}
