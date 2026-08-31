import type { DashboardUser } from "@/lib/auth";
import { applyCommercialLeadAssignment, listCommercialSellers } from "@/lib/commercial";
import { getTriageFunnel } from "@/lib/funnels";
import { getPool, listInscricoes } from "@/lib/db";
import { isProductivityManager } from "@/lib/productivity";
import { describeLeadSource } from "@/lib/leadFields";
import { notifySellerTriageBatch } from "@/lib/pushNotifications";
import type { InscricaoItem } from "@/types/inscricao";

/**
 * Distribuição da Triagem de Leads.
 *
 * A triagem é a lista fria/importada (ver migração 021 e o funil `is_triage`):
 * ela não entra no CRM geral e por regra da cartilha NÃO passa pela Chegada de
 * Leads, que só recebe captação Meta/Google. Por isso a distribuição dela vive
 * aqui, num caminho próprio: o administrador reparte o bolo entre os
 * vendedores, o lead continua dentro do funil de triagem (a atribuição o coloca
 * na etapa de entrada do funil ATUAL dele) e só sai de lá quando o vendedor
 * aprova — `approveTriageLead` em lib/commercial.ts.
 */

export type TriageDistributionStrategy = "single" | "round_robin";

export interface TriageCandidate {
  id: number;
  name: string | null;
  phone: string | null;
  city: string | null;
  createdAt: string;
  origem: string | null;
  assignedSellerId: number | null;
  assignedSellerName: string | null;
}

export interface TriagePoolResult {
  funnelId: number;
  funnelName: string;
  candidates: TriageCandidate[];
  /** Total de leads sem responsável na triagem (independente do que veio na página). */
  total: number;
  limit: number;
}

export interface TriageSellerLoad {
  sellerId: number;
  sellerName: string;
  sellerEmail: string;
  total: number;
}

export interface TriageOverview {
  funnelId: number;
  funnelName: string;
  /** Leads da triagem ainda sem dono (só preenchido para gestão). */
  unassigned: number;
  /** Total já distribuído (só preenchido para gestão). */
  assigned: number;
  /** Quantos estão com quem pediu — é o número que o vendedor precisa ver. */
  mine: number;
  bySeller: TriageSellerLoad[];
}

export interface TriageDistributionInput {
  /** Leads escolhidos a dedo na lista. Quando vazio, usa `count`. */
  leadIds?: number[];
  /** Pega os N leads mais antigos sem responsável. */
  count?: number;
  /** Junto com `count`: só pega contato que tem nome, pulando os que vieram só com telefone. */
  onlyNamed?: boolean;
  sellerIds: number[];
  strategy: TriageDistributionStrategy;
}

export interface TriageDistributionResult {
  assigned: Array<{ inscricaoId: number; sellerId: number; sellerName: string }>;
  skipped: Array<{ inscricaoId: number; reason: string }>;
  failed: Array<{ inscricaoId: number; reason: string }>;
}

/** Teto por lote: distribuir a lista inteira de uma vez trava a requisição. */
const MAX_BATCH = 500;
const DEFAULT_LIMIT = 100;

function assertManager(user: DashboardUser | null | undefined): void {
  if (!isProductivityManager(user)) {
    throw new Error("Apenas administradores podem distribuir a triagem.");
  }
}

async function requireTriageFunnel() {
  const funnel = await getTriageFunnel();
  if (!funnel) {
    throw new Error("Nenhum funil de triagem configurado.");
  }
  return funnel;
}

function candidateFromItem(item: InscricaoItem): TriageCandidate {
  return {
    id: item.id,
    name: item.nome,
    phone: item.telefone,
    city: item.cidade,
    createdAt: item.criadoEm,
    origem: describeLeadSource(item.payload).origem ?? null,
    assignedSellerId: item.commercial?.assignedSellerId ?? null,
    assignedSellerName: item.commercial?.assignedSellerName ?? null,
  };
}

function safeLimit(value: number | undefined, max = MAX_BATCH): number {
  if (!Number.isFinite(value) || !value || value < 1) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(value), max);
}

/** Lista os leads da triagem ainda sem responsável — o "bolo" a repartir. */
export async function listTriagePool(
  user: DashboardUser | null | undefined,
  options: { search?: string; limit?: number; onlyNamed?: boolean } = {}
): Promise<TriagePoolResult> {
  assertManager(user);
  const funnel = await requireTriageFunnel();
  const limit = safeLimit(options.limit);

  const result = await listInscricoes({
    page: 1,
    pageSize: limit,
    orderBy: "criado_em",
    orderDirection: "asc",
    filters: {
      funnelId: funnel.id,
      unassignedOnly: true,
      comNome: options.onlyNamed || undefined,
      caracteristica: options.search?.trim() || undefined,
    },
  });

  return {
    funnelId: funnel.id,
    funnelName: funnel.name,
    candidates: result.data.map(candidateFromItem),
    total: result.total,
    limit,
  };
}

/**
 * Quantos leads a triagem tem parados e como estão repartidos hoje.
 *
 * Os três totais vêm de `listInscricoes` (mesma fonte do quadro e da lista de
 * distribuição) porque são números que o usuário compara na tela: contar direto
 * em `commercial_leads` daria 878 onde a lista mostra 872 — a diferença é a
 * deduplicação por pessoa, e um contador que ninguém consegue alcançar destrói
 * a confiança no resto. Já a carga por vendedor sai da agregada bruta, que é
 * uma consulta só em vez de uma por vendedor; ela aparece isolada no modal de
 * distribuição, nunca lado a lado com os totais acima.
 */
export async function getTriageOverview(
  user: DashboardUser | null | undefined
): Promise<TriageOverview | null> {
  const funnel = await getTriageFunnel();
  if (!funnel) return null;

  const myEmail = (user?.email ?? "").trim().toLowerCase();
  const [unassignedRes, assignedRes, mineRes] = await Promise.all([
    listInscricoes({ page: 1, pageSize: 1, filters: { funnelId: funnel.id, unassignedOnly: true } }),
    listInscricoes({ page: 1, pageSize: 1, filters: { funnelId: funnel.id, assignedOnly: true } }),
    myEmail
      ? listInscricoes({
          page: 1,
          pageSize: 1,
          filters: { funnelId: funnel.id, assignedSellerEmail: myEmail },
        })
      : Promise.resolve({ total: 0 } as { total: number }),
  ]);

  const unassigned = unassignedRes.total;
  const assigned = assignedRes.total;
  const mine = mineRes.total;

  // Vendedor comum só vê o bolo dele; totais da equipe são informação de gestão.
  if (!isProductivityManager(user)) {
    return { funnelId: funnel.id, funnelName: funnel.name, unassigned: 0, assigned: 0, mine, bySeller: [] };
  }

  const { rows } = await getPool().query<{
    seller_id: number | null;
    seller_name: string | null;
    seller_email: string | null;
    total: string;
  }>(
    `
      SELECT cl.assigned_seller_id AS seller_id,
             cl.assigned_seller_name AS seller_name,
             cl.assigned_seller_email AS seller_email,
             COUNT(*)::text AS total
      FROM dashboard.commercial_leads cl
      JOIN inscricoes.inscricoes i ON i.id = cl.inscricao_id
      WHERE cl.funnel_id = $1
        AND COALESCE(i.payload->>'dashboard_excluido', '') <> 'true'
      GROUP BY 1, 2, 3
    `,
    [funnel.id]
  );

  const bySeller: TriageSellerLoad[] = [];
  for (const row of rows) {
    if (row.seller_id === null && !row.seller_email) continue;
    bySeller.push({
      sellerId: row.seller_id ?? 0,
      sellerName: row.seller_name ?? row.seller_email ?? "Sem nome",
      sellerEmail: row.seller_email ?? "",
      total: Number.parseInt(row.total, 10) || 0,
    });
  }

  return {
    funnelId: funnel.id,
    funnelName: funnel.name,
    unassigned,
    assigned,
    mine,
    bySeller: bySeller.sort((left, right) => right.total - left.total),
  };
}

export async function distributeTriageLeads(
  user: DashboardUser | null | undefined,
  input: TriageDistributionInput
): Promise<TriageDistributionResult> {
  assertManager(user);
  const funnel = await requireTriageFunnel();

  const sellerIds = [...new Set((input.sellerIds ?? []).map((id) => Math.trunc(Number(id))))].filter(
    (id) => Number.isFinite(id) && id > 0
  );
  if (sellerIds.length === 0) {
    throw new Error("Selecione pelo menos um vendedor para receber os leads.");
  }

  const sellers = await listCommercialSellers();
  const sellerMap = new Map(sellers.map((seller) => [seller.chatwootUserId, seller]));
  for (const sellerId of sellerIds) {
    if (!sellerMap.has(sellerId)) {
      throw new Error(`Vendedor ${sellerId} nao encontrado na equipe.`);
    }
  }

  // Escolha manual na lista tem prioridade; sem ela, pega os N mais antigos.
  const explicitIds = [...new Set((input.leadIds ?? []).map((id) => Math.trunc(Number(id))))]
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, MAX_BATCH);

  let ids: number[];
  if (explicitIds.length > 0) {
    // Confere id a id que o lead está mesmo na triagem e sem dono — a lista veio
    // do browser e pode estar velha (outro admin distribuiu no meio tempo). A
    // checagem é direta nos ids escolhidos, e não contra uma página do bolo:
    // marcar um lead que aparece só no fim da lista não pode virar "pulado".
    const { rows } = await getPool().query<{ inscricao_id: number }>(
      `
        SELECT inscricao_id
        FROM dashboard.commercial_leads
        WHERE inscricao_id = ANY($1::int[])
          AND funnel_id = $2
          AND assigned_seller_id IS NULL
          AND COALESCE(assigned_seller_email, '') = ''
      `,
      [explicitIds, funnel.id]
    );
    const available = new Set(rows.map((row) => row.inscricao_id));
    ids = explicitIds.filter((id) => available.has(id));
  } else {
    const count = safeLimit(input.count);
    const pool = await listInscricoes({
      page: 1,
      pageSize: count,
      orderBy: "criado_em",
      orderDirection: "asc",
      filters: {
        funnelId: funnel.id,
        unassignedOnly: true,
        comNome: input.onlyNamed || undefined,
      },
    });
    ids = pool.data.map((item) => item.id);
  }

  const skipped: TriageDistributionResult["skipped"] = explicitIds
    .filter((id) => !ids.includes(id))
    .map((id) => ({ inscricaoId: id, reason: "Lead ja tem responsavel ou saiu da triagem." }));
  const assigned: TriageDistributionResult["assigned"] = [];
  const failed: TriageDistributionResult["failed"] = [];

  for (const inscricaoId of ids) {
    const sellerId =
      input.strategy === "round_robin" ? sellerIds[assigned.length % sellerIds.length] : sellerIds[0];
    const seller = sellerMap.get(sellerId);
    if (!seller) {
      failed.push({ inscricaoId, reason: "Vendedor de destino nao encontrado." });
      continue;
    }

    try {
      // silent: o aviso vai uma vez só no fim, com o total do lote.
      await applyCommercialLeadAssignment(user, inscricaoId, seller.chatwootUserId, {
        sourceGroupTitle: funnel.name,
        leadPath: ["Triagem", funnel.name],
        silent: true,
      });
      assigned.push({ inscricaoId, sellerId: seller.chatwootUserId, sellerName: seller.name });
    } catch (error) {
      failed.push({
        inscricaoId,
        reason: error instanceof Error ? error.message : "Falha ao distribuir lead.",
      });
    }
  }

  const totalsBySeller = new Map<number, number>();
  for (const entry of assigned) {
    totalsBySeller.set(entry.sellerId, (totalsBySeller.get(entry.sellerId) ?? 0) + 1);
  }
  for (const [sellerId, total] of totalsBySeller) {
    const seller = sellerMap.get(sellerId);
    if (!seller) continue;
    try {
      await notifySellerTriageBatch(seller.email, total);
    } catch (error) {
      console.error("[triagem] falha ao avisar vendedor do lote:", error);
    }
  }

  return { assigned, skipped, failed };
}
