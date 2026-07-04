import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { updateTeamMember } from "@/lib/teamAuth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Integrante invalido.");
  }
  return parsed;
}

export async function PATCH(request: Request, context: RouteContext) {
  const [{ id }, cookieStore, body] = await Promise.all([
    context.params,
    cookies(),
    request.json().catch(() => ({})),
  ]);

  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Apenas administradores podem editar a equipe." }, { status: 403 });
  }

  let memberId: number;
  try {
    memberId = parseId(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Id invalido." }, { status: 400 });
  }

  if (memberId === session.user.id && body?.active === false) {
    return NextResponse.json({ error: "Voce nao pode desativar sua propria conta." }, { status: 400 });
  }

  const update: {
    name?: string;
    role?: "admin" | "member";
    active?: boolean;
    password?: string;
    institutoUpOnly?: boolean;
  } = {};

  if (typeof body?.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (body?.role === "admin" || body?.role === "member") update.role = body.role;
  if (typeof body?.active === "boolean") update.active = body.active;
  if (typeof body?.institutoUpOnly === "boolean") update.institutoUpOnly = body.institutoUpOnly;
  if (typeof body?.password === "string" && body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Senha deve ter pelo menos 8 caracteres." }, { status: 400 });
    }
    update.password = body.password;
  }

  try {
    const member = await updateTeamMember(memberId, update);
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar integrante." },
      { status: 400 }
    );
  }
}
