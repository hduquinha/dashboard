import { NextResponse, type NextRequest } from "next/server";
import { requireTasksAdmin } from "@/lib/tasksApi";
import { userCanAccessBoard } from "@/lib/tasks";
import { createWebhook, listWebhooks } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const boardId = Number(new URL(request.url).searchParams.get("boardId") ?? "");
  if (!Number.isFinite(boardId) || !(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  return NextResponse.json({ webhooks: await listWebhooks(boardId) });
}

export async function POST(request: NextRequest) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const boardId = Number(body?.boardId);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!Number.isFinite(boardId) || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "boardId e url (http/https) sao obrigatorios." }, { status: 400 });
  }
  if (!(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const webhook = await createWebhook({
    boardId,
    url,
    events: Array.isArray(body?.events) ? body.events.map(String) : [],
  });
  return NextResponse.json({ webhook });
}
