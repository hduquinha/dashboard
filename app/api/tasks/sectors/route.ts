import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksMaster, currentMemberId } from "@/lib/tasksApi";
import { createSector, listSectorsForUser, setSectorTeams } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const sectors = await listSectorsForUser(auth.user);
  return NextResponse.json({ sectors });
}

export async function POST(request: NextRequest) {
  const auth = requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Nome do setor obrigatorio." }, { status: 400 });
  const createdBy = await currentMemberId(auth.user);
  const sector = await createSector({
    name,
    description: body?.description ?? null,
    color: body?.color,
    icon: body?.icon ?? null,
    openToAll: typeof body?.openToAll === "boolean" ? body.openToAll : undefined,
    createdBy,
  });
  if (Array.isArray(body?.teamIds)) {
    await setSectorTeams(sector.id, body.teamIds.filter((n: unknown) => typeof n === "number"));
  }
  return NextResponse.json({ sector });
}
