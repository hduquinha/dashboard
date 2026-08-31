import {
  createDashboardSessionValue,
  getDashboardSession,
  type DashboardSession,
  type DashboardUser,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isProductivityManager } from "@/lib/productivity";
import { getTeamMemberById, type TeamMember } from "@/lib/teamAuth";

/**
 * Monta o usuário que vai para o cookie a partir do cadastro atual no banco.
 * O cookie continua sendo uma sessão assinada/criptografada, mas deixa de ser
 * a fonte permanente de permissões e flags do usuário.
 */
export function dashboardUserFromTeamMember(member: TeamMember): DashboardUser {
  return {
    id: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
    isSupervisor: isProductivityManager(member) || hasPermission(member, "crm.view_all_leads"),
    priorityLevel: member.priorityLevel,
    permissions: member.permissions,
    institutoUpOnly: member.institutoUpOnly,
  };
}

/**
 * Valida o token existente e reidrata os dados mutáveis do usuário.
 * Retorna null também quando a conta foi desativada ou excluída.
 */
export async function getFreshDashboardSession(
  candidate?: string | null
): Promise<DashboardSession | null> {
  const session = getDashboardSession(candidate);
  if (!session) return null;

  const member = await getTeamMemberById(session.user.id);
  if (!member || !member.active) return null;

  return { ...session, user: dashboardUserFromTeamMember(member) };
}

export function dashboardUsersDiffer(left: DashboardUser, right: DashboardUser): boolean {
  const leftPermissions = Array.isArray(left.permissions) ? left.permissions : [];
  const rightPermissions = Array.isArray(right.permissions) ? right.permissions : [];

  return (
    left.id !== right.id ||
    left.email !== right.email ||
    left.name !== right.name ||
    left.role !== right.role ||
    left.isSupervisor !== right.isSupervisor ||
    left.priorityLevel !== right.priorityLevel ||
    left.institutoUpOnly !== right.institutoUpOnly ||
    leftPermissions.length !== rightPermissions.length ||
    leftPermissions.some((permission, index) => permission !== rightPermissions[index])
  );
}

export function refreshedDashboardSessionValue(session: DashboardSession): string | null {
  return createDashboardSessionValue({
    user: session.user,
    accessFingerprint: session.accessFingerprint,
  });
}
