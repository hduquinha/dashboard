import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { deleteColumn, updateColumn, userCanAccessColumn } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const columnId = Number((await params).id);
  if (!(await userCanAccessColumn(auth.user, columnId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  await updateColumn(columnId, { name: body?.name, color: body?.color });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const columnId = Number((await params).id);
  if (!(await userCanAccessColumn(auth.user, columnId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteColumn(columnId);
  return NextResponse.json({ ok: true });
}
