import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { deleteLabel, updateLabel, userCanAccessLabel } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const labelId = Number((await params).id);
  if (!(await userCanAccessLabel(auth.user, labelId))) {
    return NextResponse.json({ error: "Sem acesso a esta etiqueta." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  await updateLabel(labelId, {
    name: typeof body?.name === "string" ? body.name : undefined,
    color: typeof body?.color === "string" && HEX.test(body.color) ? body.color : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const labelId = Number((await params).id);
  if (!(await userCanAccessLabel(auth.user, labelId))) {
    return NextResponse.json({ error: "Sem acesso a esta etiqueta." }, { status: 403 });
  }
  await deleteLabel(labelId);
  return NextResponse.json({ ok: true });
}
