import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import {
  DEFAULT_PRIORITY_BY_ROLE,
  defaultPermissionsForRole,
  hasPermission,
  isSuperMaster,
  normalizePermissionList,
  normalizeTeamRole,
} from "@/lib/permissions";
import { createTeamMember, listTeamMembers } from "@/lib/teamAuth";

export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.users")) {
    return NextResponse.json({ error: "Sem permissao para ver usuarios." }, { status: 403 });
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
  if (!hasPermission(session.user, "admin.users")) {
    return NextResponse.json({ error: "Sem permissao para cadastrar usuarios." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = normalizeTeamRole(body?.role);
  const canManagePermissions = hasPermission(session.user, "admin.permissions");
  const priorityLevel =
    typeof body?.priorityLevel === "number" && Number.isFinite(body.priorityLevel)
      ? Math.max(0, Math.min(100, Math.round(body.priorityLevel)))
      : DEFAULT_PRIORITY_BY_ROLE[role];
  const institutoUpOnly = body?.institutoUpOnly === true;
  const permissions = Array.isArray(body?.permissions)
    ? normalizePermissionList(body.permissions)
    : defaultPermissionsForRole(role, { institutoUpOnly });

  if (!canManagePermissions && (role !== "member" || Array.isArray(body?.permissions))) {
    return NextResponse.json({ error: "Sem permissao para alterar poderes." }, { status: 403 });
  }
  if (role === "super_master" && !isSuperMaster(session.user)) {
    return NextResponse.json({ error: "Apenas super master pode criar outro super master." }, { status: 403 });
  }

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
    const member = await createTeamMember({
      email,
      name,
      password,
      role,
      priorityLevel,
      permissions,
      institutoUpOnly,
    });
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
