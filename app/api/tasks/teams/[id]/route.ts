import { NextResponse, type NextRequest } from "next/server";
import { requireTasksMaster } from "@/lib/tasksApi";
import { deleteTeam, setTeamMembers, updateTeam } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const teamId = Number(id);
  const body = await request.json().catch(() => ({}));
  await updateTeam(teamId, { name: body?.name, description: body?.description, color: body?.color });
  if (Array.isArray(body?.memberIds)) {
    await setTeamMembers(teamId, body.memberIds.filter((n: unknown) => typeof n === "number"));
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await deleteTeam(Number(id));
  return NextResponse.json({ ok: true });
}
