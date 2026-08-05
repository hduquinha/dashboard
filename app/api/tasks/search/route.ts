import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { searchTasks } from "@/lib/taskSearch";

export const dynamic = "force-dynamic";

function numbers(value: string | null): number[] {
  return (value ?? "")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n));
}

export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const results = await searchTasks(auth.user, {
    text: params.get("q") ?? undefined,
    labelIds: numbers(params.get("labels")),
    memberIds: numbers(params.get("members")),
    priority: (params.get("priority") ?? "").split(",").filter(Boolean),
    status: params.get("status") ?? undefined,
    boardId: params.get("boardId") ? Number(params.get("boardId")) : null,
    sectorId: params.get("sectorId") ? Number(params.get("sectorId")) : null,
    includeArchived: params.get("archived") === "1",
  });
  return NextResponse.json({ results });
}
