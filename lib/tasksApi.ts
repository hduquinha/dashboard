import { NextResponse, type NextRequest } from "next/server";
import { getRequestDashboardSession } from "@/lib/auth";
import { hasPermission, isSuperMaster, type PermissionUser } from "@/lib/permissions";

export interface TasksAuthOk {
  ok: true;
  user: PermissionUser;
  /** true quando a chamada veio de um token de API, não de um navegador. */
  viaToken?: boolean;
}
export interface TasksAuthFail {
  ok: false;
  response: NextResponse;
}

/**
 * Resolve o usuário da requisição: primeiro o cookie de sessão do dashboard;
 * se não houver, um token de API (`Authorization: Bearer vzp_...`), que é o
 * que permite automatizar tarefas por fora (n8n, scripts, integrações).
 */
async function resolveUser(request: NextRequest): Promise<{ user: PermissionUser; viaToken: boolean } | null> {
  const session = getRequestDashboardSession(request);
  if (session) return { user: session.user, viaToken: false };

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("vzp_")) return null;

  const { resolveApiToken } = await import("@/lib/taskAutomations");
  const resolved = await resolveApiToken(token);
  if (!resolved) return null;

  const { getTeamMemberByEmail } = await import("@/lib/teamAuth");
  const member = await getTeamMemberByEmail(resolved.email);
  if (!member) return null;
  return { user: member, viaToken: true };
}

/** Exige sessão (ou token) + view.tasks. Devolve o usuário para escopo de acesso. */
export async function requireTasks(request: NextRequest): Promise<TasksAuthOk | TasksAuthFail> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { ok: false, response: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }) };
  }
  if (!hasPermission(resolved.user, "view.tasks")) {
    return { ok: false, response: NextResponse.json({ error: "Sem acesso a Tarefas." }, { status: 403 }) };
  }
  return { ok: true, user: resolved.user, viaToken: resolved.viaToken };
}

/** Exige tasks.admin (criar/editar setores, equipes, quadros). */
export async function requireTasksAdmin(request: NextRequest): Promise<TasksAuthOk | TasksAuthFail> {
  const base = await requireTasks(request);
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
export async function requireTasksMaster(request: NextRequest): Promise<TasksAuthOk | TasksAuthFail> {
  const base = await requireTasks(request);
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

/**
 * Quem aparece no histórico ("Fulano moveu o card"). `PermissionUser` só tem
 * email — o nome bonito vem de `team_members`, com o email como plano B.
 */
export async function actorOf(user: PermissionUser): Promise<{ name: string; email: string | null }> {
  const email = user.email?.trim().toLowerCase() ?? null;
  if (!email) return { name: "Alguém", email: null };
  const { getPool } = await import("@/lib/db");
  const { rows } = await getPool().query<{ name: string }>(
    `SELECT name FROM dashboard.team_members WHERE LOWER(email) = $1 LIMIT 1`,
    [email]
  );
  return { name: rows[0]?.name || email, email };
}
