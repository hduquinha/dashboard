import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession, type DashboardUser } from "@/lib/auth";
import { hasPermission, isSuperMaster } from "@/lib/permissions";
import { isProductivityManager } from "@/lib/productivity";
import { getTeamMemberById } from "@/lib/teamAuth";
import { userCanAccessBoard } from "@/lib/tasks";
import { getPool } from "@/lib/db";

/**
 * Portaria do painel de movimentação, compartilhada pela rota de dados e pela
 * de exportação — as duas devolvem o mesmo conteúdo, então precisam da mesma
 * regra. Duplicar o gate é como nasce o vazamento por uma porta só.
 *
 * São duas perguntas diferentes e as duas têm que passar:
 *  1. a pessoa enxerga o QUADRO onde o card mora (regra de setor/equipe do
 *     módulo /tarefas, a mesma de lib/taskProduction);
 *  2. a pessoa pode ver os números DAQUELE vendedor — o próprio dono sempre
 *     pode; os de terceiros exigem gestor.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PanelAccess {
  user: DashboardUser;
  /** Id em team_members do vendedor de quem é o painel. */
  sellerMemberId: number;
  sellerEmail: string;
  sellerName: string;
  isManager: boolean;
  /** Este card registra prospecção no Instagram. */
  instagramEnabled: boolean;
  /** Só o master liga e desliga o Instagram — é ele quem define quem trabalha o direct. */
  canManageInstagram: boolean;
}

export async function requireSession(): Promise<{ error: NextResponse } | { user: DashboardUser }> {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }) };
  if (!hasPermission(session.user, "view.tasks")) {
    return { error: NextResponse.json({ error: "Sem permissao para tarefas." }, { status: 403 }) };
  }
  return { user: session.user };
}

export function canSeeEveryone(user: DashboardUser): boolean {
  return isProductivityManager(user) || hasPermission(user, "crm.view_all_leads");
}

/** Resolve o card do painel: existe, o usuário alcança o quadro, e é de quem? */
export async function requirePanelTask(
  user: DashboardUser,
  taskId: number
): Promise<{ error: NextResponse } | PanelAccess> {
  const { rows } = await getPool().query<{
    board_id: number;
    kind: string;
    panel_member_id: number | null;
    panel_instagram: boolean;
  }>(
    `SELECT board_id, kind, panel_member_id, panel_instagram FROM dashboard.tasks WHERE id = $1`,
    [taskId]
  );
  const task = rows[0];
  if (!task) return { error: NextResponse.json({ error: "Card nao encontrado." }, { status: 404 }) };
  if (task.kind !== "painel_leads") {
    return { error: NextResponse.json({ error: "Este card nao e um painel de leads." }, { status: 400 }) };
  }
  if (!(await userCanAccessBoard(user, task.board_id))) {
    return { error: NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 }) };
  }
  if (!task.panel_member_id) {
    return { error: NextResponse.json({ error: "Este painel ainda nao tem vendedor definido." }, { status: 400 }) };
  }

  const member = await getTeamMemberById(task.panel_member_id);
  if (!member) {
    return { error: NextResponse.json({ error: "Vendedor do painel nao encontrado." }, { status: 404 }) };
  }

  const isManager = canSeeEveryone(user);
  const isSelf = member.email.trim().toLowerCase() === user.email.trim().toLowerCase();
  if (!isManager && !isSelf) {
    return {
      error: NextResponse.json(
        { error: "Voce so pode ver o seu proprio historico de movimentacao." },
        { status: 403 }
      ),
    };
  }

  return {
    user,
    sellerMemberId: member.id,
    sellerEmail: member.email.trim().toLowerCase(),
    sellerName: member.name,
    isManager,
    instagramEnabled: Boolean(task.panel_instagram),
    canManageInstagram: isSuperMaster(user),
  };
}
