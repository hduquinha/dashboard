import { NextResponse, type NextRequest } from "next/server";
import { getRequestDashboardSession } from "@/lib/auth";
import { hasPermission, isSuperMaster, type PermissionUser } from "@/lib/permissions";

export interface TasksAuthOk {
  ok: true;
  user: PermissionUser;
}
export interface TasksAuthFail {
  ok: false;
  response: NextResponse;
}

/** Exige sessão logada + view.tasks. Devolve o usuário para escopo de acesso. */
export function requireTasks(request: NextRequest): TasksAuthOk | TasksAuthFail {
  const session = getRequestDashboardSession(request);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }) };
  }
  if (!hasPermission(session.user, "view.tasks")) {
    return { ok: false, response: NextResponse.json({ error: "Sem acesso a Tarefas." }, { status: 403 }) };
  }
  return { ok: true, user: session.user };
}

/** Exige tasks.admin (criar/editar setores, equipes, quadros). */
export function requireTasksAdmin(request: NextRequest): TasksAuthOk | TasksAuthFail {
  const base = requireTasks(request);
  if (!base.ok) return base;
  if (!hasPermission(base.user, "tasks.admin")) {
    return { ok: false, response: NextResponse.json({ error: "Sem permissao para administrar Tarefas." }, { status: 403 }) };
  }
  return base;
}

/**
 * Exige super_master. Usado no que decide QUEM VÊ O QUÊ (setores, equipes e seus
 * membros): só o master mexe nisso. Quadros, colunas e cards seguem em
 * `requireTasksAdmin` — administrar o conteúdo de uma área é outra coisa.
 */
export function requireTasksMaster(request: NextRequest): TasksAuthOk | TasksAuthFail {
  const base = requireTasks(request);
  if (!base.ok) return base;
  if (!isSuperMaster(base.user)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Apenas um super master pode alterar setores e equipes." },
        { status: 403 }
      ),
    };
  }
  return base;
}

/** Id do team_member correspondente ao usuário logado (por email). */
export async function currentMemberId(user: PermissionUser): Promise<number | null> {
  const { getPool } = await import("@/lib/db");
  const email = user.email?.trim().toLowerCase();
  if (!email) return null;
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT id FROM dashboard.team_members WHERE LOWER(email) = $1 LIMIT 1`,
    [email]
  );
  return rows[0]?.id ?? null;
}
