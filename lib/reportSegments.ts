import { getPool } from "@/lib/db";
import { leadOriginGroupCase, LEAD_ORIGIN_GROUPS } from "@/lib/vozupFolders";

/**
 * Funil comercial COMPLETO por origem, para o relatório.
 *
 * O que muda em relação ao que o relatório fazia antes: até 2026-08-07 não
 * havia como ligar matrícula a lead, então todo retorno em reais era
 * estimativa e o relatório se recusava (com razão) a arriscar um ROI. A coluna
 * `dashboard.finance_enrollments.lead_inscricao_id` passou a existir com a
 * venda pela etapa Fechado, e é ela que este módulo usa.
 *
 * ⚠️ O vínculo só existe para venda registrada PELO funil. Venda lançada
 * direto no Financeiro fica sem `lead_inscricao_id` e é invisível aqui — por
 * isso `revenueLink` devolve a cobertura junto com os números, e o relatório
 * mostra essa cobertura em vez de deixar o leitor supor que o valor é total.
 *
 * Duas regras herdadas do resto da tela, para os números baterem:
 * - **Etapa alcançada vem do histórico** (`commercial_events`), não da etapa
 *   atual: quem agendou e depois foi perdido continua contando como "agendou"
 *   (mesma regra de getAdLeadDetails / getFunnelBreakdown).
 * - **Origem efetiva** via `leadOriginGroupCase()`: quando a pessoa tem mais de
 *   um vínculo, o canal de captação vence o formulário de produto, senão a
 *   mídia perde o crédito de quem ela trouxe.
 */

const TZ = "America/Sao_Paulo";

/** Mesma base do resto do dashboard: só lead final, não excluído, não mesclado. */
const LEAD_BASE = `LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
  AND COALESCE(i.payload->>'dashboard_excluido', '') != 'true'
  AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''`;

export interface ReportSegmentRow {
  key: string;
  label: string;
  emoji: string;
  /** Só quem ENTROU no funil comercial — é sobre esta base que as taxas
   * de canal são calculadas. Lead que nunca entrou no Kanban não diz nada
   * sobre a qualidade do canal, só sobre a distribuição. */
  cadastros: number;
  /** Chegou pelo canal mas nunca entrou no Kanban. Fica fora das taxas. */
  foraDoKanban: number;
  atendidos: number;
  agendaram: number;
  fecharam: number;
  /** Passou por Fechado e voltou atrás. Não conta como venda; conta como
   * sinal de que a etapa está sendo usada como rascunho. */
  fechamentoRevertido: number;
  /** Matrículas do Financeiro que apontam para um lead deste segmento. */
  matriculas: number;
  valorFechado: number;
  /** agendaram ÷ cadastros que entraram no Kanban, em pontos percentuais.
   * Mistura qualidade do canal com diligência do atendimento. */
  taxaAgendamento: number | null;
  /** agendaram ÷ ATENDIDOS. Esta é a métrica de eficácia do canal: só olha
   * quem a equipe realmente trabalhou, então lead abandonado não penaliza o
   * canal que o trouxe. Compare canais por aqui, não por taxaAgendamento. */
  taxaAgendamentoAtendidos: number | null;
  /** fecharam ÷ agendaram, em pontos percentuais. */
  taxaFechamento: number | null;
}

export interface ReportRevenueLink {
  matriculasTotal: number;
  matriculasComLead: number;
  valorTotal: number;
  valorComLead: number;
  /** Fração do faturamento que dá para atribuir a uma origem, 0–100. */
  coberturaPct: number | null;
}

/** Uma célula do cruzamento vendedor × origem. */
export interface SellerOriginCell {
  originKey: string;
  originLabel: string;
  originEmoji: string;
  leads: number;
  agendaram: number;
  fecharam: number;
  valorFechado: number;
}

export interface SellerOriginRow {
  sellerName: string;
  leads: number;
  agendaram: number;
  fecharam: number;
  valorFechado: number;
  /** agendaram ÷ leads, em pontos percentuais. */
  taxaAgendamento: number | null;
  porOrigem: SellerOriginCell[];
}

export interface ReportSegmentsData {
  from: string;
  to: string;
  rows: ReportSegmentRow[];
  totals: Omit<ReportSegmentRow, "key" | "label" | "emoji">;
  /** Quem recebeu o quê, e de qual origem. Cobre TODAS as origens (orgânico,
   * aula exclusiva, Google, Meta) — a tabela de vendedores do relatório da
   * Meta só enxergava lead atribuído a anúncio da Meta. */
  vendedores: SellerOriginRow[];
  /** Leads da lista fria (funil de Triagem) — fora do funil comercial normal. */
  triagem: { cadastros: number; qualificados: number } | null;
  revenueLink: ReportRevenueLink;
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

const LABELS = new Map(LEAD_ORIGIN_GROUPS.map((g) => [g.key, g]));

export async function getReportSegments(from: string, to: string): Promise<ReportSegmentsData> {
  const pool = getPool();
  const grupoCase = leadOriginGroupCase();

  const windowClause = `i.criado_em >= ($1::date::timestamp AT TIME ZONE '${TZ}')
    AND i.criado_em < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

  // A ordem aqui segue a ordem das consultas abaixo — vendedores vem antes de
  // receita. Trocar uma de lugar sem trocar aqui devolve dados do vizinho.
  const [segmentsRes, triagemRes, vendedoresRes, revenueRes] = await Promise.all([
    pool.query(
      `WITH base AS (
         SELECT i.id, ${grupoCase} AS grupo
           FROM inscricoes.inscricoes i
          WHERE ${LEAD_BASE} AND ${windowClause}
       ),
       etapas AS (
         SELECT b.id,
                b.grupo,
                cl.commercial_stage,
                -- "Entrou no Kanban" = tem linha no funil comercial e esse funil
                -- não é o de Triagem (lista fria importada, que é prospecção
                -- ativa e não captação de canal).
                (cl.inscricao_id IS NOT NULL AND COALESCE(f.name, '') NOT ILIKE '%triagem%') AS no_kanban,
                COALESCE(ev.reached, ARRAY[]::text[]) AS reached
           FROM base b
           LEFT JOIN dashboard.commercial_leads cl ON cl.inscricao_id = b.id
           LEFT JOIN dashboard.funnels f ON f.id = cl.funnel_id
           LEFT JOIN LATERAL (
             SELECT ARRAY_AGG(DISTINCT e.to_stage) AS reached
               FROM dashboard.commercial_events e
              WHERE e.inscricao_id = b.id
                AND e.event_type = 'stage_changed'
                AND e.to_stage IS NOT NULL
           ) ev ON TRUE
       )
       SELECT e.grupo,
              COUNT(*) FILTER (WHERE e.no_kanban)::int AS cadastros,
              COUNT(*) FILTER (WHERE NOT e.no_kanban)::int AS fora_do_kanban,
              COUNT(*) FILTER (
                WHERE e.no_kanban AND ('primeiro_contato' = ANY(e.reached) OR e.commercial_stage = 'primeiro_contato'
                   OR 'em_atendimento'  = ANY(e.reached) OR e.commercial_stage = 'em_atendimento'
                   OR 'agendado'        = ANY(e.reached) OR e.commercial_stage = 'agendado'
                   OR 'fechamento'      = ANY(e.reached) OR e.commercial_stage = 'fechamento'
                   OR 'ganho'           = ANY(e.reached) OR e.commercial_stage = 'ganho')
              )::int AS atendidos,
              COUNT(*) FILTER (
                WHERE e.no_kanban AND ('agendado'   = ANY(e.reached) OR e.commercial_stage = 'agendado'
                   OR 'fechamento' = ANY(e.reached) OR e.commercial_stage = 'fechamento'
                   OR 'ganho'      = ANY(e.reached) OR e.commercial_stage = 'ganho')
              )::int AS agendaram,
              -- Fechamento NÃO usa histórico, ao contrário de agendamento.
              -- Um agendamento que aconteceu continua tendo acontecido mesmo
              -- que o lead depois se perca; uma venda que voltou para Perdido,
              -- Novo ou Compra Futura simplesmente não existiu. Contar pelo
              -- histórico inflou este número de 4 para 14 em 07-08/2026.
              COUNT(*) FILTER (
                WHERE e.no_kanban AND e.commercial_stage IN ('fechamento', 'ganho')
              )::int AS fecharam,
              COUNT(*) FILTER (
                WHERE e.no_kanban
                  AND ('fechamento' = ANY(e.reached) OR 'ganho' = ANY(e.reached))
                  AND e.commercial_stage NOT IN ('fechamento', 'ganho')
              )::int AS fechamento_revertido,
              COUNT(fe.id)::int AS matriculas,
              COALESCE(SUM(fe.total_amount), 0) AS valor_fechado
         FROM etapas e
         LEFT JOIN dashboard.finance_enrollments fe ON fe.lead_inscricao_id = e.id
        GROUP BY e.grupo`,
      [from, to]
    ),
    // Triagem fica fora do funil comercial (lista fria importada): conta à
    // parte para o relatório poder dizer quanto da base veio de prospecção
    // ativa em vez de captação.
    pool.query(
      `SELECT COUNT(*)::int AS cadastros,
              COUNT(*) FILTER (WHERE cl.commercial_stage = 'qualificado')::int AS qualificados
         FROM inscricoes.inscricoes i
         JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id
         JOIN dashboard.funnels f ON f.id = cl.funnel_id
        WHERE LOWER(f.name) LIKE '%triagem%' AND ${windowClause}`,
      [from, to]
    ),
    // Cobertura do vínculo: sem isto o relatório afirmaria um faturamento por
    // origem que só cobre parte das matrículas do período.
    // Vendedor × origem. Mesma base do funil acima (entrou no Kanban, fora da
    // triagem), mas quebrada por responsável — inclui lead orgânico, de aula
    // exclusiva e do Google, que a tabela de vendedores do Meta não via.
    pool.query(
      `WITH base AS (
         SELECT i.id, ${grupoCase} AS grupo
           FROM inscricoes.inscricoes i
          WHERE ${LEAD_BASE} AND ${windowClause}
       )
       SELECT COALESCE(NULLIF(TRIM(cl.assigned_seller_name), ''), 'Sem responsável') AS vendedor,
              b.grupo,
              COUNT(*)::int AS leads,
              COUNT(*) FILTER (
                WHERE 'agendado' = ANY(COALESCE(ev.reached, ARRAY[]::text[])) OR cl.commercial_stage = 'agendado'
                   OR 'fechamento' = ANY(COALESCE(ev.reached, ARRAY[]::text[])) OR cl.commercial_stage = 'fechamento'
                   OR 'ganho' = ANY(COALESCE(ev.reached, ARRAY[]::text[])) OR cl.commercial_stage = 'ganho'
              )::int AS agendaram,
              COUNT(*) FILTER (WHERE cl.commercial_stage IN ('fechamento', 'ganho'))::int AS fecharam,
              COALESCE(SUM(fe.total_amount), 0) AS valor_fechado
         FROM base b
         JOIN dashboard.commercial_leads cl ON cl.inscricao_id = b.id
         LEFT JOIN dashboard.funnels f ON f.id = cl.funnel_id
         LEFT JOIN LATERAL (
           SELECT ARRAY_AGG(DISTINCT e.to_stage) AS reached
             FROM dashboard.commercial_events e
            WHERE e.inscricao_id = b.id AND e.event_type = 'stage_changed' AND e.to_stage IS NOT NULL
         ) ev ON TRUE
         LEFT JOIN dashboard.finance_enrollments fe ON fe.lead_inscricao_id = b.id
        WHERE COALESCE(f.name, '') NOT ILIKE '%triagem%'
        GROUP BY 1, 2`,
      [from, to]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(lead_inscricao_id)::int AS com_lead,
              COALESCE(SUM(total_amount), 0) AS valor_total,
              COALESCE(SUM(total_amount) FILTER (WHERE lead_inscricao_id IS NOT NULL), 0) AS valor_com_lead
         FROM dashboard.finance_enrollments
        WHERE sale_date BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
  ]);

  const rows: ReportSegmentRow[] = segmentsRes.rows
    .map((row) => {
      const meta = LABELS.get(String(row.grupo));
      const cadastros = num(row.cadastros);
      const foraDoKanban = num(row.fora_do_kanban);
      const agendaram = num(row.agendaram);
      const atendidos = num(row.atendidos);
      const fecharam = num(row.fecharam);
      return {
        key: String(row.grupo),
        label: meta?.label ?? String(row.grupo),
        emoji: meta?.emoji ?? "🗂️",
        cadastros,
        foraDoKanban,
        atendidos,
        agendaram,
        fecharam,
        fechamentoRevertido: num(row.fechamento_revertido),
        matriculas: num(row.matriculas),
        valorFechado: num(row.valor_fechado),
        taxaAgendamento: pct(agendaram, cadastros),
        taxaAgendamentoAtendidos: pct(agendaram, atendidos),
        taxaFechamento: pct(fecharam, agendaram),
      };
    })
    .sort((a, b) => b.cadastros - a.cadastros);

  const sum = (pick: (row: ReportSegmentRow) => number) =>
    rows.reduce((acc, row) => acc + pick(row), 0);
  const totalCadastros = sum((r) => r.cadastros);
  const totalAgendaram = sum((r) => r.agendaram);
  const totalFecharam = sum((r) => r.fecharam);

  const t = triagemRes.rows[0];
  const triagemCadastros = num(t?.cadastros);

  // Pivot vendedor × origem: uma linha por responsável, com as origens dentro.
  const sellerMap = new Map<string, SellerOriginRow>();
  for (const row of vendedoresRes.rows) {
    const name = String(row.vendedor);
    const meta = LABELS.get(String(row.grupo));
    const current =
      sellerMap.get(name) ??
      ({ sellerName: name, leads: 0, agendaram: 0, fecharam: 0, valorFechado: 0, taxaAgendamento: null, porOrigem: [] } as SellerOriginRow);
    const leads = num(row.leads);
    const agendaram = num(row.agendaram);
    const fecharam = num(row.fecharam);
    const valor = num(row.valor_fechado);
    current.leads += leads;
    current.agendaram += agendaram;
    current.fecharam += fecharam;
    current.valorFechado += valor;
    current.porOrigem.push({
      originKey: String(row.grupo),
      originLabel: meta?.label ?? String(row.grupo),
      originEmoji: meta?.emoji ?? "🗂️",
      leads,
      agendaram,
      fecharam,
      valorFechado: valor,
    });
    sellerMap.set(name, current);
  }
  const vendedores = [...sellerMap.values()]
    .map((seller) => ({
      ...seller,
      taxaAgendamento: pct(seller.agendaram, seller.leads),
      porOrigem: seller.porOrigem.sort((a, b) => b.leads - a.leads),
    }))
    .sort((a, b) => b.leads - a.leads);

  const rev = revenueRes.rows[0] ?? {};
  const valorTotal = num(rev.valor_total);
  const valorComLead = num(rev.valor_com_lead);

  return {
    from,
    to,
    rows,
    totals: {
      cadastros: totalCadastros,
      foraDoKanban: sum((r) => r.foraDoKanban),
      atendidos: sum((r) => r.atendidos),
      agendaram: totalAgendaram,
      fecharam: totalFecharam,
      fechamentoRevertido: sum((r) => r.fechamentoRevertido),
      matriculas: sum((r) => r.matriculas),
      valorFechado: sum((r) => r.valorFechado),
      taxaAgendamento: pct(totalAgendaram, totalCadastros),
      taxaAgendamentoAtendidos: pct(totalAgendaram, sum((r) => r.atendidos)),
      taxaFechamento: pct(totalFecharam, totalAgendaram),
    },
    vendedores,
    triagem: triagemCadastros > 0 ? { cadastros: triagemCadastros, qualificados: num(t?.qualificados) } : null,
    revenueLink: {
      matriculasTotal: num(rev.total),
      matriculasComLead: num(rev.com_lead),
      valorTotal,
      valorComLead,
      coberturaPct: pct(valorComLead, valorTotal),
    },
  };
}
