import { NextResponse, type NextRequest } from "next/server";
import { requireTasksMaster } from "@/lib/tasksApi";
import { revokeApiToken } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTasksMaster(request);
  if (!auth.ok) return auth.response;
  await revokeApiToken(Number((await params).id));
  return NextResponse.json({ ok: true });
}
