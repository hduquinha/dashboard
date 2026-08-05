import { NextResponse, type NextRequest } from "next/server";
import { getTaskOverview } from "@/lib/tasks";
import { requireTasks } from "@/lib/tasksApi";

export const dynamic = "force-dynamic";

/** Dados consolidados da aba Geral, restritos aos quadros visíveis ao usuário. */
export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(await getTaskOverview(auth.user));
}
