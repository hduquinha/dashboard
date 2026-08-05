import { NextResponse, type NextRequest } from "next/server";
import { getRequestDashboardSession } from "@/lib/auth";
import { acknowledgePasswordResetPrompt } from "@/lib/teamAuth";

export async function POST(request: NextRequest) {
  const session = getRequestDashboardSession(request);
  if (!session?.user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  await acknowledgePasswordResetPrompt(session.user.id);
  return NextResponse.json({ ok: true });
}
