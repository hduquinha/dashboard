import { NextResponse, type NextRequest } from "next/server";
import { requireTasksMaster } from "@/lib/tasksApi";
import { getSectorTeamIds, setSectorTeams, updateSector } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const teamIds = await getSectorTeamIds(Number(id));
  return NextResponse.json({ teamIds });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const sectorId = Number(id);
  const body = await request.json().catch(() => ({}));
  await updateSector(sectorId, {
    name: body?.name,
    description: body?.description,
    color: body?.color,
    icon: body?.icon,
    archived: body?.archived,
    openToAll: typeof body?.openToAll === "boolean" ? body.openToAll : undefined,
  });
  if (Array.isArray(body?.teamIds)) {
    await setSectorTeams(sectorId, body.teamIds.filter((n: unknown) => typeof n === "number"));
  }
  return NextResponse.json({ ok: true });
}
