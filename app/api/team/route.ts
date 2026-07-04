import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { createTeamMember, listTeamMembers } from "@/lib/teamAuth";

export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Apenas administradores podem ver a equipe." }, { status: 403 });
  }

  const members = await listTeamMembers();
  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Apenas administradores podem cadastrar integrantes." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "admin" ? "admin" : "member";
  const institutoUpOnly = body?.institutoUpOnly === true;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail invalido." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Nome obrigatorio." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  try {
    const member = await createTeamMember({ email, name, password, role, institutoUpOnly });
    return NextResponse.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar integrante.";
    const isDuplicate = /duplicate key|unique/i.test(message);
    return NextResponse.json(
      { error: isDuplicate ? "Ja existe um integrante com esse e-mail." : message },
      { status: 400 }
    );
  }
}
