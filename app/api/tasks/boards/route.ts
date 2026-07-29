import { NextResponse, type NextRequest } from "next/server";
import { requireTasks, requireTasksAdmin } from "@/lib/tasksApi";
import { createBoard, listBoards, userCanAccessSector } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireTasks(request);
  if (!auth.ok) return auth.response;
  const sectorId = Number(new URL(request.url).searchParams.get("sectorId") ?? "");
  if (!Number.isFinite(sectorId)) return NextResponse.json({ error: "sectorId invalido" }, { status: 400 });
  if (!(await userCanAccessSector(auth.user, sectorId))) {
    return NextResponse.json({ error: "Sem acesso a este setor." }, { status: 403 });
  }
  const boards = await listBoards(sectorId);
  return NextResponse.json({ boards });
}

export async function POST(request: NextRequest) {
  const auth = requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const sectorId = Number(body?.sectorId);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!Number.isFinite(sectorId) || !name) {
    return NextResponse.json({ error: "sectorId e nome sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessSector(auth.user, sectorId))) {
    return NextResponse.json({ error: "Sem acesso a este setor." }, { status: 403 });
  }
  const board = await createBoard({ sectorId, name, description: body?.description ?? null });
  return NextResponse.json({ board });
}
