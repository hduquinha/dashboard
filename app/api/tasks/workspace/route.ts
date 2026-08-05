import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { listWorkspaceBoards } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** Visão de workspace: todos os quadros que o usuário enxerga, com contadores. */
export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ boards: await listWorkspaceBoards(auth.user) });
}
