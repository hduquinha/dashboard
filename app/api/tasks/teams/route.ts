import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksMaster } from "@/lib/tasksApi";
import { createTeam, listTeams, setTeamMembers } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const teams = await listTeams();
  return NextResponse.json({ teams });
}

export async function POST(request: NextRequest) {
  const auth = requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Nome da equipe obrigatorio." }, { status: 400 });
  const teamId = await createTeam({ name, description: body?.description ?? null, color: body?.color });
  if (Array.isArray(body?.memberIds)) {
    await setTeamMembers(teamId, body.memberIds.filter((n: unknown) => typeof n === "number"));
  }
  return NextResponse.json({ teamId });
}
