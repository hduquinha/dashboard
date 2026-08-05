import { NextResponse, type NextRequest } from "next/server";
import { getRequestDashboardSession } from "@/lib/auth";
import { resetOwnPassword } from "@/lib/teamAuth";

export async function PATCH(request: NextRequest) {
  const session = getRequestDashboardSession(request);
  if (!session?.user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
  if (password !== confirmation) return NextResponse.json({ error: "As senhas não coincidem." }, { status: 400 });
  try {
    await resetOwnPassword(session.user.id, password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível alterar a senha." }, { status: 400 });
  }
}
