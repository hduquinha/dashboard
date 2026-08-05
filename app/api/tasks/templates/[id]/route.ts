import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { deleteCardTemplate, userCanAccessTemplate } from "@/lib/taskDetails";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!(await userCanAccessTemplate(auth.user, id))) {
    return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  }
  await deleteCardTemplate(id);
  return NextResponse.json({ ok: true });
}
