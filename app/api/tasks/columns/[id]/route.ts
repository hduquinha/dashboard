import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { deleteColumn, updateColumn, userCanAccessColumn } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const columnId = Number((await params).id);
  if (!(await userCanAccessColumn(auth.user, columnId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  await updateColumn(columnId, {
    name: body?.name,
    color: body?.color,
    // wipLimit aceita null de propósito: é assim que se tira o limite.
    wipLimit: body?.wipLimit === undefined ? undefined : body.wipLimit === null ? null : Number(body.wipLimit),
    completesTask: typeof body?.completesTask === "boolean" ? body.completesTask : undefined,
    archived: typeof body?.archived === "boolean" ? body.archived : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const columnId = Number((await params).id);
  if (!(await userCanAccessColumn(auth.user, columnId))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteColumn(columnId);
  return NextResponse.json({ ok: true });
}
