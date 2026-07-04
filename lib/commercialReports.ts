import { getPool } from "@/lib/db";
import { COMMERCIAL_STAGES } from "@/lib/commercial";
import { classifyCampaignChannel } from "@/lib/productivityChannels";
import type { CommercialStage } from "@/types/inscricao";
import type {
  ProductivityKanbanConsultantMetric,
  ProductivityKanbanRecentCard,
  ProductivityKanbanSnapshot,
  ProductivityKanbanStageMetric,
} from "@/types/productivity";

const SCHEMA = "dashboard";
const INSCRICOES_SCHEMA = "inscricoes";

// Mapeia a etapa comercial (Kanban) para a metrica de produtividade
// correspondente, conforme decidido com o usuario.
const STAGE_TO_METRIC: Partial<Record<CommercialStage, keyof Omit<ProductivityKanbanConsultantMetric, "teamMemberId" | "name" | "email" | "total" | "updatedInPeriod">>> = {
  primeiro_contato: "tentativas",
  em_atendimento: "conexoes",
  agendado: "agendamentos",
  fechamento: "consultorias",
  no_show: "noShow",
  ganho: "producao",
};

export async function getCommercialProductivitySnapshot(params: {
  dateFrom: string;
  dateTo: string;
  sellerEmail?: string | null;
}): Promise<ProductivityKanbanSnapshot> {
  const { dateFrom, dateTo } = params;
  const sellerEmail = params.sellerEmail?.trim().toLowerCase() || null;
  const pool = getPool();

  const sellerClauseLeads = sellerEmail ? "AND assigned_seller_email = $1" : "";
  const sellerParamsLeads = sellerEmail ? [sellerEmail] : [];

  const eventDateParams: unknown[] = [dateFrom, dateTo];
  let sellerClauseEvents = "";
  if (sellerEmail) {
    eventDateParams.push(sellerEmail);
    sellerClauseEvents = `AND actor_email = $${eventDateParams.length}`;
  }

  const [stageRows, totalsRow, eventRows, distributedRow, activityRow, recentRows] = await Promise.all([
    pool.query<{ commercial_stage: string; total: string; assigned: string }>(
      `SELECT commercial_stage,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE assigned_seller_id IS NOT NULL)::text AS assigned
       FROM ${SCHEMA}.commercial_leads
       WHERE true ${sellerClauseLeads}
       GROUP BY commercial_stage`,
      sellerParamsLeads
    ),
    pool.query<{ total: string; unassigned: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE assigned_seller_id IS NULL)::text AS unassigned
       FROM ${SCHEMA}.commercial_leads
       WHERE true ${sellerClauseLeads}`,
      sellerParamsLeads
    ),
    pool.query<{ to_stage: string; actor_email: string; actor_name: string; total: string }>(
      `SELECT to_stage, actor_email, actor_name, COUNT(*)::text AS total
       FROM ${SCHEMA}.commercial_events
       WHERE event_type = 'stage_changed'
         AND created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')
         ${sellerClauseEvents}
         AND to_stage IS NOT NULL
       GROUP BY to_stage, actor_email, actor_name`,
      eventDateParams
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM ${SCHEMA}.commercial_events
       WHERE event_type = 'assigned'
         AND created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')
         ${sellerClauseEvents}`,
      eventDateParams
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM ${SCHEMA}.commercial_events
       WHERE created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')
         ${sellerClauseEvents}`,
      eventDateParams
    ),
    pool.query<{
      inscricao_id: number;
      commercial_stage: string;
      assigned_seller_name: string | null;
      updated_at: string;
      contact_name: string;
    }>(
      `SELECT cl.inscricao_id, cl.commercial_stage, cl.assigned_seller_name, cl.updated_at,
              COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), ''), 'Sem nome') AS contact_name
       FROM ${SCHEMA}.commercial_leads cl
       JOIN ${INSCRICOES_SCHEMA}.inscricoes i ON i.id = cl.inscricao_id
       WHERE true ${sellerClauseLeads}
       ORDER BY cl.updated_at DESC
       LIMIT 10`,
      sellerParamsLeads
    ),
  ]);

  const stageTotals = new Map(stageRows.rows.map((row) => [row.commercial_stage, row]));
  const stageMetrics: ProductivityKanbanStageMetric[] = COMMERCIAL_STAGES.map((stage) => {
    const row = stageTotals.get(stage.key);
    const total = Number(row?.total ?? 0);
    const assigned = Number(row?.assigned ?? 0);
    return {
      stage: stage.key,
      stageName: stage.label,
      total,
      assigned,
      unassigned: total - assigned,
    };
  });

  const consultantMap = new Map<string, ProductivityKanbanConsultantMetric>();
  for (const row of eventRows.rows) {
    const email = row.actor_email || "dashboard@local";
    const existing = consultantMap.get(email) ?? {
      teamMemberId: null,
      name: row.actor_name || email,
      email,
      total: 0,
      tentativas: 0,
      conexoes: 0,
      agendamentos: 0,
      consultorias: 0,
      noShow: 0,
      producao: 0,
      updatedInPeriod: 0,
    };

    const metricKey = STAGE_TO_METRIC[row.to_stage as CommercialStage];
    const count = Number(row.total);
    if (metricKey) {
      existing[metricKey] += count;
    }
    existing.total += count;
    existing.updatedInPeriod += count;
    consultantMap.set(email, existing);
  }

  const recentCards: ProductivityKanbanRecentCard[] = recentRows.rows.map((row) => {
    const stageLabel = COMMERCIAL_STAGES.find((stage) => stage.key === row.commercial_stage)?.label ?? row.commercial_stage;
    return {
      inscricaoId: row.inscricao_id,
      contactName: row.contact_name,
      assigneeName: row.assigned_seller_name,
      stageName: stageLabel,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  });

  return {
    totalLeads: Number(totalsRow.rows[0]?.total ?? 0),
    unassignedLeads: Number(totalsRow.rows[0]?.unassigned ?? 0),
    updatedInPeriod: Number(activityRow.rows[0]?.total ?? 0),
    distributedInPeriod: Number(distributedRow.rows[0]?.total ?? 0),
    stageMetrics,
    consultantMetrics: Array.from(consultantMap.values()).sort((a, b) => b.total - a.total),
    recentCards,
  };
}

// Nome da linha do relatorio (Diario de Bordo / Fechamento) que cada etapa
// do Kanban alimenta — espelha STAGE_TO_METRIC, so troca "noShow" pelo nome
// de linha usado em CLOSING_NO_SHOW_ROWS (lib/productivityConfig.ts).
const STAGE_TO_ROW_KEY: Partial<Record<CommercialStage, string>> = {
  primeiro_contato: "tentativas",
  em_atendimento: "conexoes",
  agendado: "agendamentos",
  fechamento: "consultorias",
  no_show: "nao_comparecimentos",
  ganho: "producao",
};

/**
 * Distribuicao (estimada) das movimentacoes automaticas do Kanban por canal
 * de aquisicao (lib/productivityChannels.ts). Best-effort: leads cuja
 * campanha nao foi reconhecida pelo classificador ficam de fora da matriz —
 * por isso a soma da matriz pode ficar abaixo do total oficial de
 * `getCommercialProductivitySnapshot`, que e sempre a fonte da verdade para
 * o numero total de cada metrica.
 */
export async function getCommercialChannelMetrics(params: {
  dateFrom: string;
  dateTo: string;
  sellerEmail?: string | null;
}): Promise<Record<string, Record<string, number>>> {
  const { dateFrom, dateTo } = params;
  const sellerEmail = params.sellerEmail?.trim().toLowerCase() || null;

  const queryParams: unknown[] = [dateFrom, dateTo];
  let sellerClause = "";
  if (sellerEmail) {
    queryParams.push(sellerEmail);
    sellerClause = `AND ce.actor_email = $${queryParams.length}`;
  }

  const { rows } = await getPool().query<{
    to_stage: string;
    campaign_source: string | null;
    campaign_name: string | null;
    total: string;
  }>(
    `SELECT ce.to_stage, cl.campaign_source, cl.campaign_name, COUNT(*)::text AS total
     FROM ${SCHEMA}.commercial_events ce
     JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = ce.inscricao_id
     WHERE ce.event_type = 'stage_changed'
       AND ce.created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')
       ${sellerClause}
       AND ce.to_stage IS NOT NULL
     GROUP BY ce.to_stage, cl.campaign_source, cl.campaign_name`,
    queryParams
  );

  const matrix: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const rowKey = STAGE_TO_ROW_KEY[row.to_stage as CommercialStage];
    const channel = classifyCampaignChannel(row.campaign_source, row.campaign_name);
    if (!rowKey || !channel) continue;
    matrix[rowKey] = matrix[rowKey] ?? {};
    matrix[rowKey][channel] = (matrix[rowKey][channel] ?? 0) + Number(row.total);
  }
  return matrix;
}
