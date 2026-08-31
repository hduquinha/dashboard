import { getPool, notInTriageFunnelCondition, payloadTextExpression } from "@/lib/db";

/**
 * Histórico de movimentação de leads por vendedor e por dia.
 *
 * NÃO existe tabela nova aqui. Tudo sai de `dashboard.commercial_events`, que
 * já é append-only e guarda etapa anterior, etapa nova, autor e timestamp desde
 * 01/07/2026. Criar uma segunda tabela de histórico daria duas versões da
 * verdade e obrigaria a manter as duas em dia — o Kanban continua sendo a fonte.
 *
 * Três decisões que o dado real obrigou (todas verificadas contra a base):
 *
 * 1. **"Recebidos" sai do payload, não do autor.** No evento `assigned` o
 *    `actor_email` é quem DISTRIBUIU; quem recebeu está em `payload.sellerEmail`.
 *    Contar por autor daria 124 leads recebidos a quem distribuiu 124 e recebeu
 *    zero.
 *
 * 2. **O responsável é o da HORA do evento, não o de hoje.** Em 21/08 a Mayara
 *    moveu leads que hoje pertencem à Andrea; ler `commercial_leads` creditaria
 *    à Andrea trabalho da Mayara. O dono na hora vem do payload (eventos novos)
 *    ou do último `assigned` anterior ao evento (eventos antigos).
 *
 * 3. **Agrupar por e-mail, nunca por nome.** A mesma pessoa aparece como
 *    "Thiago" e "Thiago Cardoso" no histórico, porque o nome foi gravado como
 *    estava no dia.
 *
 * Fuso: o Postgres e o container rodam em UTC. Sem `AT TIME ZONE` tudo que
 * acontece depois das 21h cai no dia seguinte — o mesmo cuidado que
 * `metaAds.ts` e `googleAdsReport.ts` já tomam.
 */

const SCHEMA = "dashboard";
const TZ = "America/Sao_Paulo";

/** Nome do lead com as várias chaves possíveis do payload (ver lib/db.ts). */
const LEAD_NAME = payloadTextExpression("i", ["nome", "name", "dashboard_nome"], "NULL");

/** Reordenar o card dentro da própria coluna não é movimentação. */
const REAL_MOVE = `e.event_type = 'stage_changed' AND e.from_stage IS DISTINCT FROM e.to_stage`;

/**
 * A lista fria (funil de Triagem) fica FORA de todos os números daqui — a mesma
 * regra de `sellerWorkload.ts`, pelo mesmo motivo: ela tem distribuição e ritmo
 * próprios e misturada distorce tudo. Hoje ela é metade da carteira de vários
 * vendedores (Karen: 104 em triagem × 96 fora), e um contato frio parado não é
 * "um lead que o vendedor deixou parado". O trabalho de triagem é acompanhado
 * na aba Triagem do Kanban.
 */
const FORA_DA_TRIAGEM = notInTriageFunnelCondition("e.inscricao_id");

/** Início (inclusivo) e fim (exclusivo) do intervalo, no fuso da operação. */
const JANELA = `
  SELECT ($1::date::timestamp AT TIME ZONE '${TZ}') AS inicio,
         (($2::date + 1)::timestamp AT TIME ZONE '${TZ}') AS fim`;

/**
 * Responsável pelo lead no instante do evento.
 *
 * Eventos gravados a partir desta funcionalidade já trazem `ownerEmail` no
 * payload; os antigos são reconstruídos pelo último `assigned` anterior. Os dois
 * caminhos convivem no COALESCE de propósito: o histórico não é reescrito.
 */
const DONO_NA_HORA = `
  LEFT JOIN LATERAL (
    SELECT a.payload->>'sellerEmail' AS email, a.payload->>'sellerName' AS nome
      FROM ${SCHEMA}.commercial_events a
     WHERE a.inscricao_id = e.inscricao_id
       AND a.event_type = 'assigned'
       AND a.created_at <= e.created_at
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 1
  ) dono ON true`;

export interface LeadMovementRow {
  eventId: number;
  /** "YYYY-MM-DD" no fuso da operação. */
  date: string;
  /** "HH:MM" no fuso da operação. */
  time: string;
  leadId: number;
  leadName: string | null;
  /** Rótulos resolvidos pelo funil do lead; caem na chave quando o funil mudou. */
  fromStage: string | null;
  toStage: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  actorName: string | null;
  actorEmail: string | null;
  /** Movido por outra pessoa enquanto o lead era deste vendedor. */
  byOther: boolean;
}

export interface LeadMovementTransition {
  fromStage: string;
  toStage: string;
  count: number;
}

export interface LeadActionRow {
  eventId: number;
  date: string;
  time: string;
  leadId: number;
  leadName: string | null;
  /** whatsapp | ligacao | email | anotacao */
  kind: string;
  /** O rótulo do que foi feito: "Ligação não atendida", "Mensagem enviada"... */
  action: string;
  ownerName: string | null;
  ownerEmail: string | null;
  actorName: string | null;
  actorEmail: string | null;
  byOther: boolean;
}

export interface LeadActionTally {
  kind: string;
  action: string;
  count: number;
}

export interface LeadActionReport {
  total: number;
  /** Agrupado pelo que foi REGISTRADO, não por uma classificação inventada. */
  byAction: LeadActionTally[];
  /** Total por categoria (WhatsApp, Ligação, E-mail, Anotação). */
  byKind: Array<{ kind: string; count: number }>;
  rows: LeadActionRow[];
}

export const ACTION_KIND_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  anotacao: "Anotação",
};

export function actionKindLabel(kind: string | null | undefined): string {
  return ACTION_KIND_LABELS[kind ?? ""] ?? "Outro";
}

export interface SellerMovementReport {
  sellerEmail: string;
  sellerName: string | null;
  from: string;
  to: string;
  /** Leads distintos que ele recebeu no período. */
  received: number;
  /** Leads distintos que ELE moveu. */
  moved: number;
  /** Total de movimentações feitas por ele (o mesmo lead pode entrar N vezes). */
  movements: number;
  /** Leads recebidos no período que não tiveram evento depois da atribuição. */
  stalled: number;
  transitions: LeadMovementTransition[];
  rows: LeadMovementRow[];
  /** Ligações, mensagens e anotações registradas na ficha do lead. */
  actions: LeadActionReport;
}

interface MovementRow {
  id: number;
  dia: string;
  hora: string;
  inscricao_id: number;
  lead_name: string | null;
  from_label: string | null;
  to_label: string | null;
  owner_email: string | null;
  owner_name: string | null;
  actor_email: string | null;
  actor_name: string | null;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Movimentações que entram no painel de um vendedor: as que ELE fez e as que
 * fizeram nos leads dele. As duas coisas importam e são diferentes — por isso a
 * linha carrega o responsável e o autor separados, e `byOther` marca quando
 * divergem. Somar as duas num número só esconderia supervisor mexendo em lead
 * alheio.
 */
const MOVIMENTOS_DO_VENDEDOR = `
  WITH janela AS (${JANELA}),
  mov AS (
    SELECT e.id,
           e.inscricao_id,
           e.created_at,
           e.from_stage,
           e.to_stage,
           e.actor_email,
           e.actor_name,
           COALESCE(NULLIF(e.payload->>'ownerEmail', ''), dono.email) AS owner_email,
           COALESCE(NULLIF(e.payload->>'ownerName', ''), dono.nome)   AS owner_name
      FROM ${SCHEMA}.commercial_events e
      CROSS JOIN janela j
      ${DONO_NA_HORA}
     WHERE ${REAL_MOVE}
       AND ${FORA_DA_TRIAGEM}
       AND e.created_at >= j.inicio
       AND e.created_at <  j.fim
  )
  SELECT m.id,
         TO_CHAR(m.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS dia,
         TO_CHAR(m.created_at AT TIME ZONE '${TZ}', 'HH24:MI')    AS hora,
         m.inscricao_id,
         ${LEAD_NAME} AS lead_name,
         COALESCE(fsf.label, m.from_stage) AS from_label,
         COALESCE(fst.label, m.to_stage)   AS to_label,
         m.owner_email,
         m.owner_name,
         m.actor_email,
         m.actor_name
    FROM mov m
    LEFT JOIN inscricoes.inscricoes i ON i.id = m.inscricao_id
    LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = m.inscricao_id
    LEFT JOIN ${SCHEMA}.funnel_stages fsf ON fsf.funnel_id = cl.funnel_id AND fsf.key = m.from_stage
    LEFT JOIN ${SCHEMA}.funnel_stages fst ON fst.funnel_id = cl.funnel_id AND fst.key = m.to_stage
   WHERE LOWER(m.actor_email) = $3 OR LOWER(m.owner_email) = $3
   ORDER BY m.created_at ASC, m.id ASC`;

/**
 * Ações registradas na ficha do lead (evento `activity`): "Liguei", "Não
 * atendeu", "Mandei mensagem"...
 *
 * O que separa "ligação" de "não atendida" é a DESCRIÇÃO, não o tipo: as duas
 * são `kind = 'ligacao'`. Por isso o agrupamento é pela descrição gravada — é o
 * rótulo do que a pessoa de fato clicou ou escreveu. Classificar por conta
 * própria inventaria uma categoria que o dado não tem.
 */
const ACOES_DO_VENDEDOR = `
  WITH janela AS (${JANELA}),
  ativ AS (
    SELECT e.id,
           e.inscricao_id,
           e.created_at,
           COALESCE(NULLIF(TRIM(e.payload->>'kind'), ''), 'outro') AS kind,
           NULLIF(TRIM(e.payload->>'description'), '') AS description,
           e.actor_email,
           e.actor_name,
           COALESCE(NULLIF(e.payload->>'ownerEmail', ''), dono.email) AS owner_email,
           COALESCE(NULLIF(e.payload->>'ownerName', ''), dono.nome)  AS owner_name
      FROM ${SCHEMA}.commercial_events e
      CROSS JOIN janela j
      ${DONO_NA_HORA}
     WHERE e.event_type = 'activity'
       AND ${FORA_DA_TRIAGEM}
       AND e.created_at >= j.inicio
       AND e.created_at <  j.fim
  )
  SELECT a.id,
         TO_CHAR(a.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS dia,
         TO_CHAR(a.created_at AT TIME ZONE '${TZ}', 'HH24:MI')    AS hora,
         a.inscricao_id,
         ${LEAD_NAME} AS lead_name,
         a.kind,
         a.description,
         a.owner_email,
         a.owner_name,
         a.actor_email,
         a.actor_name
    FROM ativ a
    LEFT JOIN inscricoes.inscricoes i ON i.id = a.inscricao_id
   WHERE LOWER(a.actor_email) = $3 OR LOWER(a.owner_email) = $3
   ORDER BY a.created_at ASC, a.id ASC`;

/**
 * Leads parados NO PERÍODO: recebidos pelo vendedor dentro da janela, ainda sob
 * responsabilidade dele no fim da janela, e sem nenhum evento depois da
 * atribuição até o fim dela.
 *
 * A regra é deliberadamente de coorte: um lead antigo que já estava parado
 * antes da data inicial não infla o indicador do período atual.
 */
const PARADOS = `
  WITH janela AS (${JANELA}),
  recebidos AS (
    SELECT DISTINCT ON (e.inscricao_id)
           e.inscricao_id,
           LOWER(e.payload->>'sellerEmail') AS email,
           e.created_at AS atribuido_em
      FROM ${SCHEMA}.commercial_events e
      CROSS JOIN janela j
     WHERE e.event_type = 'assigned'
       AND ${FORA_DA_TRIAGEM}
       AND e.created_at >= j.inicio
       AND e.created_at <  j.fim
       AND e.payload->>'sellerEmail' IS NOT NULL
     ORDER BY e.inscricao_id, e.created_at DESC, e.id DESC
  ),
  dono AS (
    SELECT DISTINCT ON (e.inscricao_id)
           e.inscricao_id,
           LOWER(e.payload->>'sellerEmail') AS email
      FROM ${SCHEMA}.commercial_events e
      CROSS JOIN janela j
     WHERE e.event_type = 'assigned'
       AND ${FORA_DA_TRIAGEM}
       AND e.created_at < j.fim
     ORDER BY e.inscricao_id, e.created_at DESC, e.id DESC
  ),
  etapa AS (
    SELECT DISTINCT ON (e.inscricao_id) e.inscricao_id, e.to_stage
      FROM ${SCHEMA}.commercial_events e
      CROSS JOIN janela j
     WHERE e.event_type IN ('stage_changed', 'closed', 'reopened')
       AND e.to_stage IS NOT NULL
       AND e.created_at < j.fim
     ORDER BY e.inscricao_id, e.created_at DESC, e.id DESC
  ),
  atividade_depois_da_atribuicao AS (
    SELECT DISTINCT r.inscricao_id
      FROM recebidos r
      CROSS JOIN janela j
      JOIN ${SCHEMA}.commercial_events e
        ON e.inscricao_id = r.inscricao_id
       AND e.created_at > r.atribuido_em
       AND e.created_at < j.fim
       AND NOT (e.event_type = 'stage_changed' AND e.from_stage IS NOT DISTINCT FROM e.to_stage)
  )
  SELECT r.email, COUNT(*)::int AS total
    FROM recebidos r
    JOIN dono d ON d.inscricao_id = r.inscricao_id AND d.email = r.email
    LEFT JOIN atividade_depois_da_atribuicao a ON a.inscricao_id = r.inscricao_id
    LEFT JOIN etapa et ON et.inscricao_id = d.inscricao_id
    LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = d.inscricao_id
    LEFT JOIN ${SCHEMA}.funnel_stages fs ON fs.funnel_id = cl.funnel_id AND fs.key = et.to_stage
   WHERE a.inscricao_id IS NULL
     AND COALESCE(fs.kind, 'entry') NOT IN ('won', 'lost')
     AND r.email IS NOT NULL
   GROUP BY r.email`;

/** Leads distintos recebidos por vendedor no período (pelo destinatário). */
const RECEBIDOS = `
  WITH janela AS (${JANELA})
  SELECT LOWER(e.payload->>'sellerEmail') AS email,
         COUNT(DISTINCT e.inscricao_id)::int AS total
    FROM ${SCHEMA}.commercial_events e
    CROSS JOIN janela j
   WHERE e.event_type = 'assigned'
     AND ${FORA_DA_TRIAGEM}
     AND e.created_at >= j.inicio
     AND e.created_at <  j.fim
     AND e.payload->>'sellerEmail' IS NOT NULL
   GROUP BY 1`;

function mapRow(row: MovementRow, sellerEmail: string): LeadMovementRow {
  return {
    eventId: Number(row.id),
    date: row.dia,
    time: row.hora,
    leadId: Number(row.inscricao_id),
    leadName: row.lead_name,
    fromStage: row.from_label,
    toStage: row.to_label,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    byOther: movedBySomeoneElse(row.owner_email, row.actor_email, sellerEmail),
  };
}

export interface MovementSummary {
  /** Leads distintos que o vendedor moveu. */
  moved: number;
  /** Total de movimentações dele (o mesmo lead pode entrar N vezes). */
  movements: number;
  transitions: LeadMovementTransition[];
}

/**
 * Números do vendedor a partir das linhas já carregadas — pura, para poder ser
 * testada sem banco.
 *
 * Só conta o que o VENDEDOR fez. Movimento que outra pessoa fez num lead dele
 * aparece na lista detalhada (marcado), mas não infla o desempenho dele: quem
 * moveu foi outro.
 */
export function summarizeMovements(
  rows: LeadMovementRow[],
  sellerEmail: string
): MovementSummary {
  const email = normalizeEmail(sellerEmail);
  const feitasPorEle = rows.filter((row) => normalizeEmail(row.actorEmail) === email);
  const mapa = new Map<string, LeadMovementTransition>();
  for (const row of feitasPorEle) {
    const from = row.fromStage ?? "—";
    const to = row.toStage ?? "—";
    const chave = `${from}→${to}`;
    const atual = mapa.get(chave) ?? { fromStage: from, toStage: to, count: 0 };
    atual.count += 1;
    mapa.set(chave, atual);
  }
  return {
    moved: new Set(feitasPorEle.map((row) => row.leadId)).size,
    movements: feitasPorEle.length,
    transitions: [...mapa.values()].sort((a, b) => b.count - a.count),
  };
}

interface ActionRow {
  id: number;
  dia: string;
  hora: string;
  inscricao_id: number;
  lead_name: string | null;
  kind: string;
  description: string | null;
  owner_email: string | null;
  owner_name: string | null;
  actor_email: string | null;
  actor_name: string | null;
}

/**
 * Consolida as ações do vendedor. Pura, para ser testada sem banco.
 *
 * Conta só o que ELE registrou — ação de outra pessoa no lead dele aparece na
 * lista marcada, mas não entra no desempenho dele, exatamente como nas
 * movimentações.
 */
export function summarizeActions(rows: LeadActionRow[], sellerEmail: string): LeadActionReport {
  const email = normalizeEmail(sellerEmail);
  const dele = rows.filter((row) => normalizeEmail(row.actorEmail) === email);

  const porAcao = new Map<string, LeadActionTally>();
  const porTipo = new Map<string, number>();
  for (const row of dele) {
    const chave = `${row.kind}|${row.action}`;
    const atual = porAcao.get(chave) ?? { kind: row.kind, action: row.action, count: 0 };
    atual.count += 1;
    porAcao.set(chave, atual);
    porTipo.set(row.kind, (porTipo.get(row.kind) ?? 0) + 1);
  }

  return {
    total: dele.length,
    byAction: [...porAcao.values()].sort((a, b) => b.count - a.count),
    byKind: [...porTipo.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    rows,
  };
}

/**
 * O lead era dele e outra pessoa mexeu. O inverso — ele mexendo em lead de
 * outro — não é anomalia no painel dele, então não recebe marca.
 */
export function movedBySomeoneElse(
  ownerEmail: string | null,
  actorEmail: string | null,
  sellerEmail: string
): boolean {
  const dono = normalizeEmail(ownerEmail);
  const autor = normalizeEmail(actorEmail);
  const vendedor = normalizeEmail(sellerEmail);
  return dono === vendedor && autor !== "" && autor !== vendedor;
}

function mapAction(row: ActionRow, sellerEmail: string): LeadActionRow {
  return {
    eventId: Number(row.id),
    date: row.dia,
    time: row.hora,
    leadId: Number(row.inscricao_id),
    leadName: row.lead_name,
    kind: row.kind,
    // Sem descrição, o rótulo é a própria categoria — "Ligação" é melhor que
    // uma linha em branco no relatório.
    action: row.description ?? actionKindLabel(row.kind),
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    byOther: movedBySomeoneElse(row.owner_email, row.actor_email, sellerEmail),
  };
}

/** Relatório de um vendedor num intervalo (o painel usa um dia só; o PDF pode pedir mais). */
export async function getSellerMovementReport(params: {
  sellerEmail: string;
  sellerName?: string | null;
  from: string;
  to: string;
}): Promise<SellerMovementReport> {
  const pool = getPool();
  const sellerEmail = normalizeEmail(params.sellerEmail);
  const values = [params.from, params.to, sellerEmail];

  const [movRes, recebidosRes, paradosRes, acoesRes] = await Promise.all([
    pool.query<MovementRow>(MOVIMENTOS_DO_VENDEDOR, values),
    pool.query<{ email: string; total: number }>(RECEBIDOS, [params.from, params.to]),
    pool.query<{ email: string; total: number }>(PARADOS, [params.from, params.to]),
    pool.query<ActionRow>(ACOES_DO_VENDEDOR, values),
  ]);

  const rows = movRes.rows.map((row) => mapRow(row, sellerEmail));
  const resumo = summarizeMovements(rows, sellerEmail);

  return {
    sellerEmail,
    sellerName: params.sellerName ?? rows.find((row) => row.ownerName)?.ownerName ?? null,
    from: params.from,
    to: params.to,
    received: recebidosRes.rows.find((r) => r.email === sellerEmail)?.total ?? 0,
    moved: resumo.moved,
    movements: resumo.movements,
    stalled: paradosRes.rows.find((r) => r.email === sellerEmail)?.total ?? 0,
    transitions: resumo.transitions,
    rows,
    actions: summarizeActions(
      acoesRes.rows.map((row) => mapAction(row, sellerEmail)),
      sellerEmail
    ),
  };
}

export interface TeamMovementSummaryRow {
  sellerEmail: string;
  sellerName: string | null;
  received: number;
  moved: number;
  movements: number;
  stalled: number;
}

export interface TeamMovementReport {
  from: string;
  to: string;
  sellers: TeamMovementSummaryRow[];
  totals: { received: number; moved: number; movements: number; stalled: number };
  transitions: LeadMovementTransition[];
}

/**
 * Visão consolidada de todos os vendedores — a base do PDF geral.
 *
 * Uma consulta por recorte em vez de N chamadas a `getSellerMovementReport`:
 * com dez vendedores aquilo seriam trinta consultas para responder a mesma
 * pergunta.
 */
export async function getTeamMovementReport(params: {
  from: string;
  to: string;
}): Promise<TeamMovementReport> {
  const pool = getPool();
  const values = [params.from, params.to];

  const [porAutor, recebidosRes, paradosRes] = await Promise.all([
    pool.query<{
      email: string;
      nome: string | null;
      leads: number;
      movimentos: number;
      from_label: string | null;
      to_label: string | null;
    }>(
      `WITH janela AS (${JANELA})
       SELECT LOWER(e.actor_email) AS email,
              MAX(e.actor_name) AS nome,
              COUNT(DISTINCT e.inscricao_id)::int AS leads,
              COUNT(*)::int AS movimentos,
              COALESCE(fsf.label, e.from_stage) AS from_label,
              COALESCE(fst.label, e.to_stage)   AS to_label
         FROM ${SCHEMA}.commercial_events e
         CROSS JOIN janela j
         LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = e.inscricao_id
         LEFT JOIN ${SCHEMA}.funnel_stages fsf ON fsf.funnel_id = cl.funnel_id AND fsf.key = e.from_stage
         LEFT JOIN ${SCHEMA}.funnel_stages fst ON fst.funnel_id = cl.funnel_id AND fst.key = e.to_stage
        WHERE ${REAL_MOVE}
          AND ${FORA_DA_TRIAGEM}
          AND e.created_at >= j.inicio
          AND e.created_at <  j.fim
          AND e.actor_email IS NOT NULL
        GROUP BY 1, 5, 6`,
      values
    ),
    pool.query<{ email: string; total: number }>(RECEBIDOS, values),
    pool.query<{ email: string; total: number }>(PARADOS, values),
  ]);

  const porVendedor = new Map<string, TeamMovementSummaryRow>();
  const transicoes = new Map<string, LeadMovementTransition>();

  const garantir = (email: string, nome: string | null): TeamMovementSummaryRow => {
    const atual = porVendedor.get(email) ?? {
      sellerEmail: email,
      sellerName: nome,
      received: 0,
      moved: 0,
      movements: 0,
      stalled: 0,
    };
    if (!atual.sellerName && nome) atual.sellerName = nome;
    porVendedor.set(email, atual);
    return atual;
  };

  for (const row of porAutor.rows) {
    const alvo = garantir(row.email, row.nome);
    // `leads` vem por transição; somar daria o mesmo lead várias vezes. O total
    // de leads distintos do vendedor é recalculado abaixo, na consulta própria.
    alvo.movements += row.movimentos;
    const from = row.from_label ?? "—";
    const to = row.to_label ?? "—";
    const chave = `${from}→${to}`;
    const atual = transicoes.get(chave) ?? { fromStage: from, toStage: to, count: 0 };
    atual.count += row.movimentos;
    transicoes.set(chave, atual);
  }

  // Leads distintos por vendedor: precisa de DISTINCT sobre o conjunto inteiro,
  // não da soma dos DISTINCT por transição.
  const distintos = await pool.query<{ email: string; total: number }>(
    `WITH janela AS (${JANELA})
     SELECT LOWER(e.actor_email) AS email, COUNT(DISTINCT e.inscricao_id)::int AS total
       FROM ${SCHEMA}.commercial_events e
       CROSS JOIN janela j
      WHERE ${REAL_MOVE}
        AND ${FORA_DA_TRIAGEM}
        AND e.created_at >= j.inicio
        AND e.created_at <  j.fim
        AND e.actor_email IS NOT NULL
      GROUP BY 1`,
    values
  );
  for (const row of distintos.rows) garantir(row.email, null).moved = row.total;
  for (const row of recebidosRes.rows) garantir(row.email, null).received = row.total;
  for (const row of paradosRes.rows) garantir(row.email, null).stalled = row.total;

  // Quem não moveu nada no período não tem nome no histórico (o nome vem do
  // ator do evento). Sem isto o PDF geral listaria um e-mail cru na linha de
  // quem só tem lead parado — que é justamente a linha que o gestor precisa ler.
  const semNome = [...porVendedor.values()].filter((row) => !row.sellerName);
  if (semNome.length > 0) {
    const { rows } = await pool.query<{ email: string; name: string }>(
      `SELECT LOWER(email) AS email, name FROM ${SCHEMA}.team_members WHERE LOWER(email) = ANY($1::text[])`,
      [semNome.map((row) => row.sellerEmail)]
    );
    for (const row of rows) {
      const alvo = porVendedor.get(row.email);
      if (alvo) alvo.sellerName = row.name;
    }
  }

  const sellers = [...porVendedor.values()].sort((a, b) => b.movements - a.movements);

  return {
    from: params.from,
    to: params.to,
    sellers,
    totals: {
      received: sellers.reduce((soma, row) => soma + row.received, 0),
      moved: sellers.reduce((soma, row) => soma + row.moved, 0),
      movements: sellers.reduce((soma, row) => soma + row.movements, 0),
      stalled: sellers.reduce((soma, row) => soma + row.stalled, 0),
    },
    transitions: [...transicoes.values()].sort((a, b) => b.count - a.count),
  };
}

/**
 * Dias com movimentação no mês, para o seletor de data marcar onde há o que ver
 * em vez de deixar a pessoa navegar às cegas.
 */
export async function listSellerDaysWithActivity(
  sellerEmail: string,
  month: string
): Promise<string[]> {
  const email = normalizeEmail(sellerEmail);
  const { rows } = await getPool().query<{ dia: string }>(
    `WITH janela AS (
       SELECT ($1::date::timestamp AT TIME ZONE '${TZ}') AS inicio,
              (($1::date + INTERVAL '1 month')::timestamp AT TIME ZONE '${TZ}') AS fim
     )
     SELECT DISTINCT TO_CHAR(e.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS dia
       FROM ${SCHEMA}.commercial_events e
       CROSS JOIN janela j
      WHERE e.created_at >= j.inicio
        AND e.created_at <  j.fim
        AND NOT (e.event_type = 'stage_changed' AND e.from_stage IS NOT DISTINCT FROM e.to_stage)
        AND ${FORA_DA_TRIAGEM}
        AND (LOWER(e.actor_email) = $2 OR LOWER(e.payload->>'sellerEmail') = $2)
      ORDER BY 1`,
    [`${month}-01`, email]
  );
  return rows.map((row) => row.dia);
}

export interface LeadPanelSeller {
  memberId: number;
  email: string;
  name: string;
}

/**
 * Vendedores que já apareceram no histórico comercial — de quem deve existir
 * card na coluna Histórico.
 *
 * `is_seller` é o mesmo filtro que a distribuição usa (migração 025): sem ele
 * entrariam admins que só repassaram lead, e o quadro ganharia card de gente
 * que não trabalha carteira. Conta desativada não gera card novo, mas o card
 * que já existe continua consultável — histórico não se apaga.
 */
export async function listLeadPanelSellers(): Promise<LeadPanelSeller[]> {
  const { rows } = await getPool().query<{ id: number; email: string; name: string }>(
    `SELECT tm.id, tm.email, tm.name
       FROM ${SCHEMA}.team_members tm
      WHERE tm.active
        AND tm.is_seller
        AND EXISTS (
          SELECT 1 FROM ${SCHEMA}.commercial_events e
           WHERE LOWER(e.actor_email) = LOWER(tm.email)
              OR LOWER(e.payload->>'sellerEmail') = LOWER(tm.email)
        )
      ORDER BY tm.name`
  );
  return rows.map((row) => ({ memberId: row.id, email: row.email, name: row.name }));
}
