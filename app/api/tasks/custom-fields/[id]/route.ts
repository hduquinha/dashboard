import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { deleteCustomField, updateCustomField, userCanAccessCustomField } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessCustomField(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  await updateCustomField(id, {
    name: body?.name,
    options: Array.isArray(body?.options) ? body.options.map(String) : undefined,
    showOnCard: typeof body?.showOnCard === "boolean" ? body.showOnCard : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessCustomField(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteCustomField(id);
  return NextResponse.json({ ok: true });
}
