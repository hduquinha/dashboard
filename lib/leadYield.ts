import { getPool } from "@/lib/db";
import { listFunnels } from "@/lib/funnels";
import { effectiveOriginSql } from "@/lib/leadOriginPriority";
import { LEAD_ORIGIN_GROUPS, leadOriginGroupCase } from "@/lib/vozupFolders";
import type { LeadYieldBasis, LeadYieldLead, LeadYieldStageStep } from "@/lib/leadYieldAnalysis";
import type { CommercialStageKind } from "@/types/inscricao";
import type { Funnel } from "@/types/funnel";

/**
 * Consulta do "Rendimento do lead" (aba de /campanhas): uma PESSOA por linha,
 * com a etapa em que ela está hoje e a trilha de por onde passou.
 *
 * Devolve o período inteiro sem filtrar origem, funil, vendedor ou etapa — tudo
 * isso é filtrado no navegador (ver lib/leadYieldAnalysis.ts). O pedido era
 * poder cruzar qualquer filtro à vontade, e uma ida ao servidor por clique
 * tornaria isso arrastado; o volume permite (leads visíveis do CRM inteiro
 * cabem em uma consulta, e a janela normal é de dias).
 */

// Mesmo fuso das outras contagens da tela de campanhas: o dia do lead é o dia
// em São Paulo, não o UTC do servidor.
const TIME_ZONE = "America/Sao_Paulo";

/** Teto de segurança para janelas absurdas (ex.: "desde 2024"). A tela avisa
 * quando corta, em vez de mostrar um número menor sem explicação. */
const MAX_LEADS = 6000;

const WINDOW_START = (placeholder: string) => `(${placeholder}::date::timestamp AT TIME ZONE '${TIME_ZONE}')`;
const WINDOW_END = (placeholder: string) => `((${placeholder}::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')`;

export interface LeadYieldQuery {
  from: string;
  to: string;
  basis: LeadYieldBasis;
}

export interface LeadYieldData {
  leads: LeadYieldLead[];
  funnels: Funnel[];
  /** Rótulos dos grupos de origem, sem a condição SQL: a tela é client-side e
   * não pode importar lib/vozupFolders (que abre conexão com o banco). */
  originGroups: Array<{ key: string; label: string; emoji: string }>;
  truncated: boolean;
}

interface LeadRow {
  id: number;
  nome: string | null;
  telefone: string | null;
  origem: string;
  origin_group: string;
  criado_em: Date | string;
  funnel_id: number | null;
  commercial_stage: string | null;
  commercial_stage_kind: string | null;
  card_created_at: Date | string | null;
  assigned_seller_name: string | null;
  assigned_seller_email: string | null;
  assigned_at: Date | string | null;
  contact_attempts: number | null;
  closed_at: Date | string | null;
  closed_reason: string | null;
  campaign_name: string | null;
  ad_name: string | null;
}

interface StageEventRow {
  inscricao_id: number;
  to_stage: string;
  first_at: Date | string;
  actor: string | null;
  in_window: boolean;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function getLeadYieldData({ from, to, basis }: LeadYieldQuery): Promise<LeadYieldData> {
  const pool = getPool();

  // "Chegada" recorta por quando a pessoa se cadastrou; "movimentação" recorta
  // por quem andou no funil dentro da janela — quem chegou em junho e agendou
  // hoje só aparece no segundo modo, e é justamente o que "quantos agendaram
  // essa semana" pergunta. "Tudo" não recorta: é o quadro de hoje, o único
  // recorte que bate card a card com o Kanban (que não tem filtro de período).
  //
  // Em todos os modos a janela continua chegando na consulta dos eventos, para
  // a coluna "entraram no período" seguir significando alguma coisa.
  const periodCondition =
    basis === "tudo"
      ? // Sem recorte, mas citando os dois parâmetros: o protocolo do Postgres
        // recusa bind com parâmetro que a consulta não referencia.
        `($1::date IS NOT NULL AND $2::date IS NOT NULL)`
      : basis === "movimentacao"
        ? `EXISTS (
             SELECT 1 FROM dashboard.commercial_events ev
             WHERE ev.inscricao_id = i.id
               AND ev.event_type = 'stage_changed'
               AND ev.to_stage IS NOT NULL
               AND ev.created_at >= ${WINDOW_START("$1")}
               AND ev.created_at < ${WINDOW_END("$2")}
           )`
        : `i.criado_em >= ${WINDOW_START("$1")} AND i.criado_em < ${WINDOW_END("$2")}`;

  const { rows } = await pool.query<LeadRow>(
    `SELECT
       i.id,
       i.payload->>'nome' AS nome,
       i.payload->>'telefone' AS telefone,
       COALESCE(oe.origem_efetiva, 'Sem origem') AS origem,
       ${leadOriginGroupCase("oe.origem_efetiva")} AS origin_group,
       i.criado_em,
       cl.funnel_id,
       cl.commercial_stage,
       cl.commercial_stage_kind,
       cl.created_at AS card_created_at,
       cl.assigned_seller_name,
       cl.assigned_seller_email,
       cl.assigned_at,
       cl.contact_attempts,
       cl.closed_at,
       cl.closed_reason,
       COALESCE(NULLIF(TRIM(i.payload->>'campaign_name'), ''), NULLIF(TRIM(cl.campaign_name), '')) AS campaign_name,
       COALESCE(NULLIF(TRIM(i.payload->>'ad_name'), ''), NULLIF(TRIM(i.payload->>'utm_content'), '')) AS ad_name
     FROM inscricoes.inscricoes i
     LEFT JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id
     -- Origem efetiva calculada uma vez por linha: quando a pessoa tem mais de
     -- um vínculo, o canal de captação vence o formulário de produto.
     CROSS JOIN LATERAL (SELECT ${effectiveOriginSql("i")} AS origem_efetiva) AS oe
     WHERE COALESCE(i.payload->>'dashboard_excluido', '') != 'true'
       AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''
       AND (${periodCondition})
     ORDER BY i.criado_em DESC
     LIMIT ${MAX_LEADS + 1}`,
    [from, to]
  );

  const truncated = rows.length > MAX_LEADS;
  const leadRows = truncated ? rows.slice(0, MAX_LEADS) : rows;
  const ids = leadRows.map((row) => row.id);

  // Trilha: primeira entrada em cada etapa, quem moveu e se a entrada caiu
  // dentro da janela. Reentradas (voltar para uma etapa anterior) colapsam na
  // primeira — a pergunta aqui é "passou por lá?", não quantas idas e vindas.
  const stageEvents = ids.length
    ? await pool.query<StageEventRow>(
        `SELECT
           ev.inscricao_id,
           ev.to_stage,
           MIN(ev.created_at) AS first_at,
           (array_agg(ev.actor_name ORDER BY ev.created_at ASC))[1] AS actor,
           bool_or(ev.created_at >= ${WINDOW_START("$2")} AND ev.created_at < ${WINDOW_END("$3")}) AS in_window
         FROM dashboard.commercial_events ev
         WHERE ev.event_type = 'stage_changed'
           AND ev.to_stage IS NOT NULL
           AND ev.inscricao_id = ANY($1::int[])
         GROUP BY ev.inscricao_id, ev.to_stage`,
        [ids, from, to]
      )
    : { rows: [] as StageEventRow[] };

  const trailByLead = new Map<number, LeadYieldStageStep[]>();
  for (const row of stageEvents.rows) {
    const list = trailByLead.get(row.inscricao_id) ?? [];
    list.push({
      key: row.to_stage,
      at: iso(row.first_at) ?? new Date().toISOString(),
      actor: row.actor,
      inWindow: row.in_window,
    });
    trailByLead.set(row.inscricao_id, list);
  }

  const funnels = await listFunnels();
  const entryKeyByFunnel = new Map<number, string>();
  for (const funnel of funnels) {
    const entry = funnel.stages.find((stage) => stage.kind === "entry");
    if (entry) entryKeyByFunnel.set(funnel.id, entry.key);
  }
  const defaultEntryKey = funnels.find((funnel) => funnel.isDefault)?.stages.find((s) => s.kind === "entry")?.key;

  // Mesma janela da consulta, em milissegundos, para marcar a entrada no funil
  // (que não gera evento) como dentro ou fora do período. São Paulo não tem
  // horário de verão desde 2019, então o deslocamento fixo é seguro.
  const windowStartMs = new Date(`${from}T00:00:00-03:00`).getTime();
  const windowEndMs = new Date(`${to}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000;

  const leads: LeadYieldLead[] = leadRows.map((row) => {
    const trail = (trailByLead.get(row.id) ?? []).sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );

    // Todo card nasce na etapa de entrada, e essa passagem não gera evento —
    // sem isto, um lead recém-distribuído apareceria com trilha vazia e a
    // primeira etapa do funil ficaria zerada.
    const entryKey = (row.funnel_id !== null ? entryKeyByFunnel.get(row.funnel_id) : defaultEntryKey) ?? defaultEntryKey;
    const cardCreatedAt = iso(row.card_created_at);
    if (entryKey && cardCreatedAt && !trail.some((step) => step.key === entryKey)) {
      const at = new Date(cardCreatedAt).getTime();
      trail.unshift({
        key: entryKey,
        at: cardCreatedAt,
        actor: null,
        inWindow: at >= windowStartMs && at < windowEndMs,
      });
    }

    return {
      id: row.id,
      nome: row.nome,
      telefone: row.telefone,
      origem: row.origem,
      originGroup: row.origin_group,
      criadoEm: iso(row.criado_em) ?? new Date().toISOString(),
      funnelId: row.funnel_id,
      stageKey: row.commercial_stage,
      stageKind: (row.commercial_stage_kind as CommercialStageKind | null) ?? null,
      cardCreatedAt,
      sellerName: row.assigned_seller_name,
      sellerEmail: row.assigned_seller_email,
      assignedAt: iso(row.assigned_at),
      contactAttempts: row.contact_attempts ?? 0,
      closedAt: iso(row.closed_at),
      closedReason: row.closed_reason,
      campaignName: row.campaign_name,
      adName: row.ad_name,
      trail,
    };
  });

  return {
    leads,
    funnels,
    originGroups: LEAD_ORIGIN_GROUPS.map(({ key, label, emoji }) => ({ key, label, emoji })),
    truncated,
  };
}
