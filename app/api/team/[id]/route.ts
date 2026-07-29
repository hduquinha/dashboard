import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import {
  hasPermission,
  isSuperMaster,
  normalizePermissionList,
  normalizeTeamRole,
  type PermissionKey,
  type TeamRole,
} from "@/lib/permissions";
import { deleteTeamMember, getTeamMemberById, listTeamMembers, updateTeamMember } from "@/lib/teamAuth";

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
  if (!hasPermission(session.user, "admin.users")) {
    return NextResponse.json({ error: "Sem permissao para editar usuarios." }, { status: 403 });
  }

  let memberId: number;
  try {
    memberId = parseId(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Id invalido." }, { status: 400 });
  }

  const existing = await getTeamMemberById(memberId);
  if (!existing) {
    return NextResponse.json({ error: "Integrante da equipe nao encontrado." }, { status: 404 });
  }

  const changingOwnAccess =
    memberId === session.user.id &&
    (body?.active === false ||
      (typeof body?.role === "string" && body.role !== session.user.role) ||
      Array.isArray(body?.permissions));

  if (changingOwnAccess) {
    return NextResponse.json({ error: "Voce nao pode reduzir ou trocar seu proprio acesso." }, { status: 400 });
  }

  const update: {
    name?: string;
    role?: TeamRole;
    active?: boolean;
    password?: string;
    priorityLevel?: number;
    permissions?: PermissionKey[];
    institutoUpOnly?: boolean;
  } = {};

  if (typeof body?.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body?.role === "string") update.role = normalizeTeamRole(body.role);
  if (typeof body?.active === "boolean") update.active = body.active;
  if (typeof body?.institutoUpOnly === "boolean") update.institutoUpOnly = body.institutoUpOnly;
  if (typeof body?.priorityLevel === "number" && Number.isFinite(body.priorityLevel)) {
    update.priorityLevel = Math.max(0, Math.min(100, Math.round(body.priorityLevel)));
  }
  if (Array.isArray(body?.permissions)) {
    update.permissions = normalizePermissionList(body.permissions);
  }
  if (typeof body?.password === "string" && body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Senha deve ter pelo menos 8 caracteres." }, { status: 400 });
    }
    update.password = body.password;
  }

  const touchesPermissions =
    update.permissions !== undefined ||
    update.priorityLevel !== undefined ||
    update.role !== undefined ||
    update.institutoUpOnly !== undefined;
  if (touchesPermissions && !hasPermission(session.user, "admin.permissions")) {
    return NextResponse.json({ error: "Sem permissao para alterar poderes." }, { status: 403 });
  }
  if ((update.role === "super_master" || existing.role === "super_master") && !isSuperMaster(session.user)) {
    return NextResponse.json({ error: "Apenas super master pode alterar super master." }, { status: 403 });
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

export async function DELETE(_request: Request, context: RouteContext) {
  const [{ id }, cookieStore] = await Promise.all([context.params, cookies()]);
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.users")) {
    return NextResponse.json({ error: "Sem permissao para excluir usuarios." }, { status: 403 });
  }

  let memberId: number;
  try {
    memberId = parseId(id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Id invalido." }, { status: 400 });
  }

  if (memberId === session.user.id) {
    return NextResponse.json({ error: "Voce nao pode excluir seu proprio usuario." }, { status: 400 });
  }

  const existing = await getTeamMemberById(memberId);
  if (!existing) {
    return NextResponse.json({ error: "Integrante da equipe nao encontrado." }, { status: 404 });
  }

  if (existing.role === "super_master") {
    if (!isSuperMaster(session.user)) {
      return NextResponse.json({ error: "Apenas super master pode excluir outro super master." }, { status: 403 });
    }

    const activeSuperMasters = (await listTeamMembers({ activeOnly: true })).filter(
      (member) => member.role === "super_master"
    );
    if (existing.active && activeSuperMasters.length <= 1) {
      return NextResponse.json(
        { error: "Nao e possivel excluir o ultimo super master ativo." },
        { status: 400 }
      );
    }
  }

  try {
    await deleteTeamMember(memberId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao excluir integrante.";
    return NextResponse.json({ error: message }, { status: /nao encontrado/i.test(message) ? 404 : 400 });
  }
}
