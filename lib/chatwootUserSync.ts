import { getPool } from "@/lib/db";
import { listTeamMembers, type TeamMember } from "@/lib/teamAuth";
import {
  createChatwootAgent,
  isChatwootConfigured,
  listChatwootAgents,
  updateChatwootAgent,
  type ChatwootAgent,
} from "@/lib/chatwoot";

const SCHEMA = "dashboard";

/**
 * Sincronização de usuários dashboard -> Chatwoot (Fase 2). A dashboard é a
 * fonte da verdade: cada team_member ativo deve ter um agente correspondente no
 * Chatwoot (casado por e-mail). Papel: super_master/admin -> administrator;
 * member -> agent. O id do agente fica em team_members.chatwoot_agent_id.
 *
 * Fire-and-forget: chamado após criar/editar um team_member, NUNCA lança pra não
 * derrubar o fluxo de usuários da dashboard.
 */

function chatwootRoleFor(member: Pick<TeamMember, "role">): "agent" | "administrator" {
  return member.role === "super_master" || member.role === "admin" ? "administrator" : "agent";
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

async function saveAgentId(memberId: number, agentId: number | null): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.team_members SET chatwoot_agent_id = $2 WHERE id = $1`,
    [memberId, agentId]
  );
}

export interface SyncAgentPlan {
  memberId: number;
  email: string;
  name: string;
  action: "match" | "create" | "update-role" | "skip-no-email";
  chatwootAgentId?: number;
  detail?: string;
}

/** Calcula o que fazer com um membro perante a lista atual de agentes. */
function planForMember(member: TeamMember, agentsByEmail: Map<string, ChatwootAgent>): SyncAgentPlan {
  const email = normalizeEmail(member.email);
  if (!email) {
    return { memberId: member.id, email: "", name: member.name, action: "skip-no-email" };
  }
  const existing = agentsByEmail.get(email);
  const desiredRole = chatwootRoleFor(member);
  if (!existing) {
    return { memberId: member.id, email, name: member.name, action: "create", detail: desiredRole };
  }
  if (existing.role !== desiredRole) {
    return {
      memberId: member.id,
      email,
      name: member.name,
      action: "update-role",
      chatwootAgentId: existing.id,
      detail: `${existing.role} -> ${desiredRole}`,
    };
  }
  return { memberId: member.id, email, name: member.name, action: "match", chatwootAgentId: existing.id };
}

/**
 * Sincroniza TODOS os membros ativos. Com dryRun=true não escreve nada (nem no
 * Chatwoot, nem no mapeamento) — só devolve o plano, pra revisão.
 */
export async function backfillChatwootAgents(
  options: { dryRun?: boolean } = {}
): Promise<{ ok: boolean; error?: string; plans: SyncAgentPlan[] }> {
  if (!isChatwootConfigured()) {
    return { ok: false, error: "Chatwoot não configurado.", plans: [] };
  }
  const dryRun = options.dryRun ?? false;

  const agentsRes = await listChatwootAgents();
  if (!agentsRes.ok) {
    return { ok: false, error: `Falha ao listar agentes: ${agentsRes.error}`, plans: [] };
  }
  const agentsByEmail = new Map(agentsRes.data.map((a) => [normalizeEmail(a.email), a]));

  const members = await listTeamMembers({ activeOnly: true });
  const plans = members.map((m) => planForMember(m, agentsByEmail));

  if (dryRun) {
    return { ok: true, plans };
  }

  for (const plan of plans) {
    try {
      if (plan.action === "create") {
        const member = members.find((m) => m.id === plan.memberId)!;
        const created = await createChatwootAgent({
          name: member.name,
          email: plan.email,
          role: chatwootRoleFor(member),
        });
        if (created.ok) {
          plan.chatwootAgentId = created.data.id;
          await saveAgentId(plan.memberId, created.data.id);
        } else {
          plan.detail = `erro ao criar: ${created.error}`;
        }
      } else if (plan.action === "update-role" && plan.chatwootAgentId) {
        const member = members.find((m) => m.id === plan.memberId)!;
        await updateChatwootAgent(plan.chatwootAgentId, { role: chatwootRoleFor(member) });
        await saveAgentId(plan.memberId, plan.chatwootAgentId);
      } else if (plan.action === "match" && plan.chatwootAgentId) {
        await saveAgentId(plan.memberId, plan.chatwootAgentId);
      }
    } catch {
      // auditoria de sync não pode derrubar nada; segue pro próximo.
      plan.detail = "exceção durante o sync";
    }
  }

  return { ok: true, plans };
}

/**
 * Sincroniza UM membro (chamado após create/update de team_member). Nunca lança.
 */
export async function syncTeamMemberToChatwoot(member: TeamMember): Promise<void> {
  if (!isChatwootConfigured() || !member.active) return;
  try {
    const agentsRes = await listChatwootAgents();
    if (!agentsRes.ok) return;
    const agentsByEmail = new Map(agentsRes.data.map((a) => [normalizeEmail(a.email), a]));
    const plan = planForMember(member, agentsByEmail);

    if (plan.action === "create") {
      const created = await createChatwootAgent({
        name: member.name,
        email: plan.email,
        role: chatwootRoleFor(member),
      });
      if (created.ok) await saveAgentId(member.id, created.data.id);
    } else if (plan.action === "update-role" && plan.chatwootAgentId) {
      await updateChatwootAgent(plan.chatwootAgentId, { role: chatwootRoleFor(member) });
      await saveAgentId(member.id, plan.chatwootAgentId);
    } else if (plan.chatwootAgentId) {
      await saveAgentId(member.id, plan.chatwootAgentId);
    }
  } catch {
    // silencioso de propósito.
  }
}
