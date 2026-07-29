import { getPool, TRAINING_EXPRESSION, UPDAY_PAYLOAD_CONDITION } from "@/lib/db";
import { AULA_SEM_DATA_SUFFIX, aulaBlockToLeadFields } from "@/lib/aulaBlocks";

/**
 * Organização da área VozUP > Leads em três níveis:
 *
 *   VozUP → Leads → Pasta → Bloco (Formulário) → Listagem de Leads
 *
 * As pastas são definidas aqui (config estática + condição SQL de origem).
 * Os blocos dentro de cada pasta são descobertos dinamicamente no banco:
 * qualquer formulário novo cuja origem case com a condição da pasta aparece
 * automaticamente como um novo bloco, sem alteração de código.
 *
 * Para criar uma pasta nova: adicione uma entrada em VOZUP_FOLDERS com a
 * condição SQL de origem correspondente. A pasta "outros" é o catch-all —
 * tudo que não pertence ao Instituto UP (Encontro Online / Up Day Plus) e não
 * casa com nenhuma pasta anterior cai nela, garantindo que nenhum lead fique
 * invisível.
 */

const PAGE_SIZE = 50;

// Todas as expressões pressupõem o alias "i" (FROM inscricoes.inscricoes AS i),
// requisito das expressões compartilhadas importadas de lib/db.ts.
const ORIGEM_NORM = `LOWER(TRIM(COALESCE(i.payload->>'origem', '')))`;
const ORIGEM_RAW = `COALESCE(NULLIF(TRIM(i.payload->>'origem'), ''), 'Sem origem')`;

// Tema/dor da landing page (ex.: "Vendas"), usado para agrupar no Dashboard
// as variantes de uma mesma página (ex.: as 3 versões do formulário de
// Vendas) em uma subpasta só.
//
// Preferimos o campo explícito 'landing_page_grupo' (gravado pelo formulário
// mais recente), mas todo lead de landing page da VozUP segue o padrão
// "Landing Page VozUP - <Tema> [(Formulário N Perguntas)] [- <índice>]", então
// como respaldo extraímos o <Tema> direto da origem via regex — isso agrupa
// corretamente até leads antigos, capturados antes do campo explícito existir,
// sem precisar de nenhuma migração de dado.
const LANDING_PAGE_GRUPO_FROM_ORIGEM = `
  CASE
    -- Leads antigos da Home, capturados antes de a origem virar "... - Home"
    -- (sem "-" nenhum depois do prefixo, então a regex abaixo não teria o que cortar).
    WHEN TRIM(COALESCE(i.payload->>'origem', '')) = 'Landing Page VozUP' THEN 'Home'
    ELSE regexp_replace(
      regexp_replace(
        regexp_replace(TRIM(COALESCE(i.payload->>'origem', '')), '\\s*-\\s*\\d+\\s*$', ''),
        '\\s*\\([^)]*\\)\\s*$', ''
      ),
      '^Landing Page VozUP\\s*-\\s*', ''
    )
  END
`;
const LANDING_PAGE_GRUPO_EXPRESSION = `COALESCE(
  NULLIF(TRIM(i.payload->>'landing_page_grupo'), ''),
  NULLIF(TRIM(${LANDING_PAGE_GRUPO_FROM_ORIGEM}), ''),
  ${ORIGEM_RAW}
)`;

const BASE_FLAGS = `LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
  AND COALESCE(i.payload->>'dashboard_excluido', '') != 'true'
  AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''`;

/**
 * Modelo de vínculos: o lead é único (linha primária visível, BASE_FLAGS) e
 * seus "vínculos" são os eventos da pessoa — a própria linha primária mais os
 * satélites mesclados (dashboard_merged_into = id do primário). Um lead
 * aparece em toda pasta/bloco em que QUALQUER um de seus eventos se encaixa.
 *
 * Remoção de vínculo: satélite ganha dashboard_excluido; o vínculo próprio da
 * linha primária ganha dashboard_vinculo_removido (a linha continua visível).
 */
// Importante para performance: nunca juntar primário e evento com
// "e.id = i.id OR e.merged_into = i.id" — o OR impede hash join e vira
// varredura N×N. Usar dois ramos por igualdade (UNION ALL) ou subconsulta IN.
const EVENT_FLAGS = `LOWER(TRIM(COALESCE(e.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
  AND COALESCE(e.payload->>'dashboard_excluido', '') != 'true'
  AND COALESCE(e.payload->>'dashboard_vinculo_removido', '') != 'true'`;
const EVENT_FLAGS_NO_ALIAS = EVENT_FLAGS.replaceAll("e.payload", "payload");

const PRIMARY_EVENT_LINKS_CTE = `
  primary_event_links AS (
    SELECT
      i.id AS primary_id,
      i.payload AS primary_payload,
      i.criado_em AS primary_criado_em,
      i.id AS event_id,
      i.payload AS event_payload,
      i.criado_em AS event_criado_em
    FROM inscricoes.inscricoes AS i
    WHERE ${BASE_FLAGS}
      AND COALESCE(i.payload->>'dashboard_vinculo_removido', '') != 'true'

    UNION ALL

    SELECT
      i.id AS primary_id,
      i.payload AS primary_payload,
      i.criado_em AS primary_criado_em,
      e.id AS event_id,
      e.payload AS event_payload,
      e.criado_em AS event_criado_em
    FROM inscricoes.inscricoes AS e
    JOIN inscricoes.inscricoes AS i
      ON i.id = (e.payload->>'dashboard_merged_into')::int
    WHERE e.payload->>'dashboard_merged_into' ~ '^\\d+$'
      AND ${BASE_FLAGS}
      AND ${EVENT_FLAGS}
  )
`;

const PRIMARY_EVENT_LINKS_FROM = `
  primary_event_links AS l
  CROSS JOIN LATERAL (
    SELECT l.primary_id AS id, l.primary_payload AS payload, l.primary_criado_em AS criado_em
  ) AS i
  CROSS JOIN LATERAL (
    SELECT l.event_id AS id, l.event_payload AS payload, l.event_criado_em AS criado_em
  ) AS e
`;

/** Converte uma expressão escrita para o alias "i" para o alias de evento "e". */
const asEvent = (sql: string) => sql.replaceAll("i.payload", "e.payload");

// Ordenação padrão das listagens: última interação (novas inscrições
// unificadas gravam dashboard_ultima_interacao e trazem o lead ao topo).
const LAST_INTERACTION = `GREATEST(
  i.criado_em,
  CASE
    WHEN COALESCE(i.payload->>'dashboard_ultima_interacao', '') ~ '^\\d{4}-\\d{2}-\\d{2}'
      THEN (i.payload->>'dashboard_ultima_interacao')::timestamptz
    ELSE i.criado_em
  END
)`;

// Leads dos dois produtos do Instituto UP — ficam fora da área VozUP (catch-all).
const ENCONTRO_ONLINE_CONDITION = `(
  LOWER(${TRAINING_EXPRESSION}) LIKE '%encontro online%'
  OR ${TRAINING_EXPRESSION} ~ '^\\d{4}-\\d{2}-\\d{2}'
)`;
const INSTITUTO_PRODUCT_CONDITION = `(${UPDAY_PAYLOAD_CONDITION} OR ${ENCONTRO_ONLINE_CONDITION})`;

// Mesma chave de pessoa usada pelo CRM (telefone > email > linha) para que as
// contagens dos blocos batam com o que o CRM mostra.
const PERSON_KEY = `
  CASE
    WHEN LENGTH(REGEXP_REPLACE(
      COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), NULLIF(TRIM(i.payload->>'whatsapp'), '')),
      '\\D', '', 'g'
    )) >= 10
      THEN 'phone:' || REGEXP_REPLACE(
        COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), NULLIF(TRIM(i.payload->>'whatsapp'), '')),
        '\\D', '', 'g'
      )
    WHEN LOWER(TRIM(COALESCE(i.payload->>'email', ''))) LIKE '%@%'
      THEN 'email:' || LOWER(TRIM(i.payload->>'email'))
    ELSE 'row:' || i.id::text
  END
`;

// Blocos da pasta Meta são identificados pelo formulário/campanha (mudam com
// frequência, então vêm do banco em vez de hardcoded).
const META_BLOCK_EXPRESSION = `COALESCE(
  NULLIF(TRIM(i.payload->>'form_name'), ''),
  NULLIF(TRIM(i.payload->>'campaign_name'), ''),
  'Sem campanha identificada'
)`;

export const META_FALLBACK_BLOCK = "Sem campanha identificada";
export const SEM_ORIGEM_BLOCK = "Sem origem";

// Blocos da pasta de aulas: cada aula (turma + data) é um bloco separado,
// identificado por data_treinamento no formato rótulo ("Aula Exclusiva
// 02/07/2026"); sem data alguma, o lead cai no bloco "<origem> (sem data)".
//
// Datas ISO ("2026-06-09T19:00:00-03:00") são EXCLUSIVAS do Encontro Online
// (ver docs/cartilha-formularios-produtos.md): um evento com origem de aula e
// data ISO é contaminação de payload (formulário do Encontro reaproveitando
// cadastro por telefone) e não pode virar bloco de aula — a condição da pasta
// abaixo já o exclui, e ele cai na aba Instituto UP via data ISO.
const AULA_DATE_RAW = `TRIM(COALESCE(i.payload->>'data_treinamento', ''))`;
const AULA_ISO_DATE_CONDITION = `${AULA_DATE_RAW} ~ '^\\d{4}-\\d{2}-\\d{2}'`;
const AULA_BLOCK_EXPRESSION = `CASE
  WHEN ${AULA_DATE_RAW} <> '' AND NOT ${AULA_ISO_DATE_CONDITION} THEN ${AULA_DATE_RAW}
  ELSE ${ORIGEM_RAW} || '${AULA_SEM_DATA_SUFFIX}'
END`;

const BLOCK_EXPRESSION_BY_KIND: Record<VozupFolderDef["blockKind"], string> = {
  origem: ORIGEM_RAW,
  "meta-form": META_BLOCK_EXPRESSION,
  aula: AULA_BLOCK_EXPRESSION,
};

export interface VozupFolderDef {
  key: string;
  label: string;
  emoji: string;
  description: string;
  /** Condição SQL (alias "i") que decide se um lead pertence à pasta. */
  condition: string;
  /** Como os blocos (formulários) da pasta são identificados. */
  blockKind: "origem" | "meta-form" | "aula";
  /**
   * Se true, os blocos da pasta são agrupados em uma subpasta por tema
   * (ex.: "Página de Vendas" reunindo as 3 variantes do formulário de Vendas)
   * antes de listar os blocos individuais. Ver LANDING_PAGE_GRUPO_EXPRESSION.
   */
  hasSubfolders?: boolean;
}

export const VOZUP_FOLDERS: VozupFolderDef[] = [
  {
    key: "panfletos",
    label: "Panfletos",
    emoji: "📄",
    description: "Leads captados pelos panfletos físicos, separados por versão.",
    condition: `(${ORIGEM_NORM} IN ('panfleto a', 'panfleto b', 'panfleto_a', 'panfleto_b'))`,
    blockKind: "origem",
  },
  {
    key: "aula-experimental",
    label: "Aula Experimental",
    emoji: "🧪",
    description: "Cada aula (Experimental, Exclusiva…) aparece como um bloco com sua data.",
    condition: `((${ORIGEM_NORM} LIKE 'aula %' OR ${ORIGEM_NORM} LIKE 'aula-%' OR ${ORIGEM_NORM} = 'aula') AND NOT ${AULA_ISO_DATE_CONDITION})`,
    blockKind: "aula",
  },
  {
    key: "landing-pages",
    label: "Landing Pages VozUP",
    emoji: "🌐",
    description: "Leads captados pelas landing pages da VozUP.",
    condition: `(${ORIGEM_NORM} LIKE '%landing%' AND (${ORIGEM_NORM} LIKE '%vozup%' OR ${ORIGEM_NORM} LIKE '%voz up%'))`,
    blockKind: "origem",
    hasSubfolders: true,
  },
  {
    key: "meta",
    label: "Meta",
    emoji: "📣",
    description: "Formulários de tráfego pago da Meta (Facebook/Instagram Lead Ads).",
    condition: `(${ORIGEM_NORM} = 'facebook lead ads' OR ${ORIGEM_NORM} LIKE 'meta%')`,
    blockKind: "meta-form",
  },
  {
    key: "google-ads",
    label: "Google Ads",
    emoji: "🎯",
    description: "Leads captados pelas landing pages de tráfego pago do Google Ads.",
    condition: `(${ORIGEM_NORM} LIKE '%google ads%')`,
    blockKind: "origem",
    hasSubfolders: true,
  },
  {
    key: "workshop",
    label: "Workshop VozUP",
    emoji: "🎙️",
    description: "Inscrições do Workshop VozUP.",
    condition: `(${ORIGEM_NORM} LIKE '%workshop%' AND ${ORIGEM_NORM} LIKE '%voz%')`,
    blockKind: "origem",
  },
  {
    key: "inauguracao",
    label: "Inauguração VozUP",
    emoji: "🎉",
    // Cadastro presencial feito por quem já está na inauguração (formulário
    // aula-experimental/23-07, /26-07). origem "Inauguração VozUP - DD/MM/AAAA"
    // — distinta por data, então cada dia vira um bloco próprio (blockKind
    // origem). Ver docs/cartilha-formularios-produtos.md.
    description: "Cadastros presenciais feitos durante a inauguração da VozUP (um bloco por data).",
    condition: `(${ORIGEM_NORM} LIKE 'inaugura%')`,
    blockKind: "origem",
  },
  {
    key: "outros",
    label: "Outros cadastros",
    emoji: "🗂️",
    description: "Cadastros manuais e formulários ainda não agrupados em pastas.",
    // Preenchida dinamicamente abaixo: tudo que não é Instituto UP nem casa com as pastas anteriores.
    condition: "",
    blockKind: "origem",
  },
];

const NAMED_FOLDERS = VOZUP_FOLDERS.filter((f) => f.condition !== "");
const ANY_NAMED_FOLDER_CONDITION = `(${NAMED_FOLDERS.map((f) => f.condition).join(" OR ")})`;
const OUTROS_CONDITION = `(NOT ${ANY_NAMED_FOLDER_CONDITION} AND NOT ${INSTITUTO_PRODUCT_CONDITION})`;

// Escopo total da área VozUP: pastas nomeadas + catch-all.
const VOZUP_SCOPE_CONDITION = `(${ANY_NAMED_FOLDER_CONDITION} OR NOT ${INSTITUTO_PRODUCT_CONDITION})`;

export function getVozupFolder(key: string | null | undefined): VozupFolderDef | null {
  return VOZUP_FOLDERS.find((f) => f.key === key) ?? null;
}

function folderCondition(folder: VozupFolderDef): string {
  return folder.condition === "" ? OUTROS_CONDITION : folder.condition;
}

export interface VozupBlockStats {
  folderKey: string;
  /** Identidade do bloco (origem do formulário ou formulário/campanha da Meta). */
  bloco: string;
  /** Subpasta (tema) do bloco — igual ao bloco em pastas sem hasSubfolders. */
  subpasta: string;
  total: number;
  semana: number;
  mes: number;
  /** Data da última conversão (lead mais recente do bloco). */
  ultimaConversao: string | null;
}

/** CASE que classifica um EVENTO (alias "e") na pasta correspondente. */
export function vozupFolderCaseForEvents(): string {
  return `CASE
    ${NAMED_FOLDERS.map((f) => `WHEN ${asEvent(f.condition)} THEN '${f.key}'`).join("\n    ")}
    ELSE 'outros'
  END`;
}

/** CASE que dá o rótulo do bloco de um EVENTO (alias "e"). */
export function vozupBlockCaseForEvents(): string {
  const specialFolders = NAMED_FOLDERS.filter((f) => f.blockKind !== "origem");
  if (specialFolders.length === 0) return asEvent(ORIGEM_RAW);
  return `CASE
    ${specialFolders
      .map((f) => `WHEN ${asEvent(f.condition)} THEN ${asEvent(BLOCK_EXPRESSION_BY_KIND[f.blockKind])}`)
      .join("\n    ")}
    ELSE ${asEvent(ORIGEM_RAW)}
  END`;
}

/**
 * CASE que dá a subpasta (tema) de um EVENTO (alias "e") dentro de pastas com
 * hasSubfolders. Fora dessas pastas, a subpasta é o próprio bloco — ou seja,
 * não há agrupamento extra (comportamento idêntico ao de antes da subpasta
 * existir).
 */
export function vozupSubpastaCaseForEvents(): string {
  const subfolderFolders = NAMED_FOLDERS.filter((f) => f.hasSubfolders);
  if (subfolderFolders.length === 0) return vozupBlockCaseForEvents();
  return `CASE
    ${subfolderFolders
      .map((f) => `WHEN ${asEvent(f.condition)} THEN ${asEvent(LANDING_PAGE_GRUPO_EXPRESSION)}`)
      .join("\n    ")}
    ELSE ${vozupBlockCaseForEvents()}
  END`;
}

/**
 * Estatísticas de todos os blocos de todas as pastas em uma única query.
 * Blocos são descobertos dinamicamente. Cada lead (pessoa) conta uma vez por
 * bloco, considerando TODOS os seus eventos (vínculos), inclusive inscrições
 * posteriores unificadas por telefone.
 */
export async function listVozupBlockStats(): Promise<VozupBlockStats[]> {
  const pool = getPool();

  const result = await pool.query<{
    pasta: string;
    bloco: string;
    subpasta: string;
    total: string;
    semana: string;
    mes: string;
    ultima_conversao: string | null;
  }>(`
    WITH ${PRIMARY_EVENT_LINKS_CTE},
    events AS (
      SELECT
        ${vozupFolderCaseForEvents()} AS pasta,
        ${vozupBlockCaseForEvents()} AS bloco,
        ${vozupSubpastaCaseForEvents()} AS subpasta,
        TRIM(${PERSON_KEY}) AS person_key,
        e.criado_em
      FROM ${PRIMARY_EVENT_LINKS_FROM}
      WHERE ${asEvent(VOZUP_SCOPE_CONDITION)}
    ),
    unique_leads AS (
      SELECT DISTINCT ON (person_key, pasta, bloco) pasta, bloco, subpasta, criado_em
      FROM events
      ORDER BY person_key, pasta, bloco, criado_em DESC
    )
    SELECT
      pasta,
      bloco,
      subpasta,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::text AS semana,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '30 days')::text AS mes,
      MAX(criado_em)::text AS ultima_conversao
    FROM unique_leads
    GROUP BY pasta, bloco, subpasta
    ORDER BY MAX(criado_em) DESC
  `);

  return result.rows.map((row) => ({
    folderKey: row.pasta,
    bloco: row.bloco,
    subpasta: row.subpasta,
    total: Number(row.total),
    semana: Number(row.semana),
    mes: Number(row.mes),
    ultimaConversao: row.ultima_conversao,
  }));
}

export interface VozupLead {
  id: number;
  nome: string;
  telefone: string;
  email: string;
  objetivo: string;
  origem: string;
  cidade: string;
  criado_em: string;
  /** Vendedor atribuído (commercial_leads.assigned_seller_name); null = sem responsável. */
  responsavel: string | null;
  /** Presença marcada manualmente para a Aula Exclusiva. */
  aulaPresenca: "presente" | "ausente" | null;
}

const SORT_COLUMNS: Record<string, string> = {
  nome: "LOWER(COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), ''), 'zzz'))",
  telefone: "COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), '')",
  cidade: "LOWER(COALESCE(NULLIF(TRIM(i.payload->>'cidade'), ''), 'zzz'))",
  criado_em: LAST_INTERACTION,
};

export interface ListVozupLeadsOptions {
  search?: string;
  page?: number;
  sort?: string;
  dir?: string;
  /** Sub-filtro por criativo (ad_name), disponível apenas na pasta Meta. */
  criativo?: string | null;
}

export interface ListVozupLeadIdsOptions {
  limit?: number;
  unassignedOnly?: boolean;
  criativo?: string | null;
}

/**
 * Lista os leads de um bloco (formulário) específico dentro de uma pasta.
 */
export async function listVozupLeadsByBlock(
  folderKey: string,
  bloco: string,
  opts: ListVozupLeadsOptions = {}
): Promise<{ leads: VozupLead[]; total: number }> {
  const folder = getVozupFolder(folderKey);
  if (!folder || !bloco) return { leads: [], total: 0 };

  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  // A pertinência ao bloco é avaliada sobre os EVENTOS do lead (vínculos):
  // linha própria + satélites mesclados. Assim um lead que depois se inscreveu
  // em outra aula aparece nas duas listagens, continuando um cadastro único.
  const params: unknown[] = [bloco];
  let eventBlockClause: string;
  if (folder.blockKind === "meta-form") {
    eventBlockClause = `${asEvent(META_BLOCK_EXPRESSION)} = $1`;
  } else if (folder.blockKind === "aula") {
    eventBlockClause = `${asEvent(AULA_BLOCK_EXPRESSION)} = $1`;
  } else {
    eventBlockClause = `${asEvent(ORIGEM_RAW)} = $1`;
  }

  let criativoClause = "";
  if (folder.blockKind === "meta-form" && opts.criativo) {
    params.push(opts.criativo);
    criativoClause = `AND COALESCE(NULLIF(TRIM(e.payload->>'ad_name'), ''), 'Sem criativo identificado') = $${params.length}`;
  }

  // Compatibilidade com mesclagens antigas: origens acumuladas em
  // dashboard_origens_adicionais no primário também contam como vínculo.
  let legacyExtrasClause = "";
  if (folder.blockKind === "origem") {
    params.push(`%${bloco}%`);
    legacyExtrasClause = `OR (${folderCondition(folder)} AND COALESCE(i.payload->>'dashboard_origens_adicionais', '') ILIKE $${params.length})`;
  }

  let searchClause = "";
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    searchClause = `AND (LOWER(COALESCE(i.payload->>'nome', '')) LIKE $${params.length} OR LOWER(COALESCE(i.payload->>'telefone', '')) LIKE $${params.length})`;
  }

  const result = await pool.query<Omit<VozupLead, "aulaPresenca"> & { total: string; aula_presenca: string | null }>(
    `WITH ${PRIMARY_EVENT_LINKS_CTE},
    matching_leads AS (
      SELECT DISTINCT i.id
      FROM ${PRIMARY_EVENT_LINKS_FROM}
      WHERE ${asEvent(folderCondition(folder))}
        AND ${eventBlockClause}
        ${criativoClause}
    )
    SELECT
      i.id,
      COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), ''), 'Sem nome') AS nome,
      COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), NULLIF(TRIM(i.payload->>'whatsapp'), ''), '') AS telefone,
      COALESCE(NULLIF(TRIM(i.payload->>'email'), ''), '') AS email,
      COALESCE(NULLIF(TRIM(i.payload->>'objetivo'), ''), NULLIF(TRIM(i.payload->>'interesse_workshop'), ''), '') AS objetivo,
      COALESCE(NULLIF(TRIM(i.payload->>'origem'), ''), '') AS origem,
      COALESCE(NULLIF(TRIM(i.payload->>'cidade'), ''), '') AS cidade,
      COALESCE(i.payload->>'timestamp', i.criado_em::text) AS criado_em,
      NULLIF(TRIM(cl.assigned_seller_name), '') AS responsavel,
      CASE LOWER(TRIM(COALESCE(i.payload->>'aula_presenca', '')))
        WHEN 'presente' THEN 'presente'
        WHEN 'ausente' THEN 'ausente'
        ELSE NULL
      END AS aula_presenca,
      COUNT(*) OVER () AS total
    FROM inscricoes.inscricoes AS i
    LEFT JOIN dashboard.commercial_leads AS cl ON cl.inscricao_id = i.id
    WHERE ${BASE_FLAGS}
      AND (
        EXISTS (SELECT 1 FROM matching_leads AS m WHERE m.id = i.id)
        ${legacyExtrasClause}
      )
      ${searchClause}
    ORDER BY ${SORT_COLUMNS[opts.sort ?? ""] ?? SORT_COLUMNS.criado_em} ${opts.dir === "asc" ? "ASC" : "DESC"}, i.id DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  return {
    leads: result.rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      telefone: row.telefone,
      email: row.email,
      objetivo: row.objetivo,
      origem: row.origem,
      cidade: row.cidade,
      criado_em: row.criado_em,
      responsavel: row.responsavel ?? null,
      aulaPresenca: row.aula_presenca === "presente" || row.aula_presenca === "ausente"
        ? row.aula_presenca
        : null,
    })),
    total: result.rows[0] ? Number(result.rows[0].total) : 0,
  };
}

/**
 * IDs de leads de um bloco, sem paginação, para ações em lote como distribuição.
 */
export async function listVozupLeadIdsByBlock(
  folderKey: string,
  bloco: string,
  opts: ListVozupLeadIdsOptions = {}
): Promise<number[]> {
  const folder = getVozupFolder(folderKey);
  if (!folder || !bloco) return [];

  const pool = getPool();
  const limit = Math.max(1, Math.min(500, Math.trunc(opts.limit ?? 100)));
  const params: unknown[] = [bloco];
  const eventBlockClause =
    folder.blockKind === "meta-form"
      ? `${asEvent(META_BLOCK_EXPRESSION)} = $1`
      : folder.blockKind === "aula"
      ? `${asEvent(AULA_BLOCK_EXPRESSION)} = $1`
      : `${asEvent(ORIGEM_RAW)} = $1`;

  let criativoClause = "";
  if (folder.blockKind === "meta-form" && opts.criativo) {
    params.push(opts.criativo);
    criativoClause = `AND COALESCE(NULLIF(TRIM(e.payload->>'ad_name'), ''), 'Sem criativo identificado') = $${params.length}`;
  }

  let legacyExtrasClause = "";
  if (folder.blockKind === "origem") {
    params.push(`%${bloco}%`);
    legacyExtrasClause = `OR (${folderCondition(folder)} AND COALESCE(i.payload->>'dashboard_origens_adicionais', '') ILIKE $${params.length})`;
  }

  const unassignedClause = opts.unassignedOnly
    ? "AND cl.assigned_seller_id IS NULL AND COALESCE(cl.assigned_seller_email, '') = ''"
    : "";
  params.push(limit);

  const result = await pool.query<{ id: number }>(
    `WITH ${PRIMARY_EVENT_LINKS_CTE},
    matching_leads AS (
      SELECT DISTINCT i.id
      FROM ${PRIMARY_EVENT_LINKS_FROM}
      WHERE ${asEvent(folderCondition(folder))}
        AND ${eventBlockClause}
        ${criativoClause}
    )
    SELECT i.id
    FROM inscricoes.inscricoes AS i
    LEFT JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id
    WHERE ${BASE_FLAGS}
      AND (
        EXISTS (SELECT 1 FROM matching_leads AS m WHERE m.id = i.id)
        ${legacyExtrasClause}
      )
      ${unassignedClause}
    ORDER BY ${LAST_INTERACTION} DESC, i.id DESC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => Number(row.id));
}

/**
 * Todos os inscritos de um bloco (aula), sem paginação — usado pela lista de
 * presença para impressão, que precisa do total e não só da página atual.
 */
export async function listAllVozupLeadsByBlock(
  folderKey: string,
  bloco: string
): Promise<Pick<VozupLead, "nome" | "telefone" | "aulaPresenca">[]> {
  const folder = getVozupFolder(folderKey);
  if (!folder || !bloco) return [];

  const pool = getPool();
  const eventBlockClause =
    folder.blockKind === "meta-form"
      ? `${asEvent(META_BLOCK_EXPRESSION)} = $1`
      : folder.blockKind === "aula"
      ? `${asEvent(AULA_BLOCK_EXPRESSION)} = $1`
      : `${asEvent(ORIGEM_RAW)} = $1`;

  const result = await pool.query<{ nome: string; telefone: string; aula_presenca: string | null }>(
    `WITH ${PRIMARY_EVENT_LINKS_CTE},
    matching_leads AS (
      SELECT DISTINCT i.id
      FROM ${PRIMARY_EVENT_LINKS_FROM}
      WHERE ${asEvent(folderCondition(folder))}
        AND ${eventBlockClause}
    )
    SELECT
      COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), ''), 'Sem nome') AS nome,
      COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), NULLIF(TRIM(i.payload->>'whatsapp'), ''), '') AS telefone,
      CASE LOWER(TRIM(COALESCE(i.payload->>'aula_presenca', '')))
        WHEN 'presente' THEN 'presente'
        WHEN 'ausente' THEN 'ausente'
        ELSE NULL
      END AS aula_presenca
    FROM inscricoes.inscricoes AS i
    WHERE ${BASE_FLAGS}
      AND EXISTS (SELECT 1 FROM matching_leads AS m WHERE m.id = i.id)
    ORDER BY ${SORT_COLUMNS.nome}`,
    [bloco]
  );

  return result.rows.map((row) => ({
    nome: row.nome,
    telefone: row.telefone,
    aulaPresenca:
      row.aula_presenca === "presente" || row.aula_presenca === "ausente" ? row.aula_presenca : null,
  }));
}

/**
 * Sub-filtro por criativo dentro de um bloco da pasta Meta. Os criativos mudam
 * com frequência, por isso a lista vem do banco (payload->>'ad_name').
 */
export async function listMetaCreativeOptions(
  bloco: string
): Promise<{ value: string; count: number }[]> {
  const folder = VOZUP_FOLDERS.find((f) => f.blockKind === "meta-form");
  if (!folder) return [];

  const pool = getPool();
  const result = await pool.query<{ ad_name: string; count: string }>(
    `WITH ${PRIMARY_EVENT_LINKS_CTE}
    SELECT
      COALESCE(NULLIF(TRIM(e.payload->>'ad_name'), ''), 'Sem criativo identificado') AS ad_name,
      COUNT(*)::text AS count
    FROM ${PRIMARY_EVENT_LINKS_FROM}
    WHERE ${asEvent(folder.condition)}
      AND ${asEvent(META_BLOCK_EXPRESSION)} = $1
    GROUP BY ad_name
    ORDER BY count DESC`,
    [bloco]
  );
  return result.rows.map((r) => ({ value: r.ad_name, count: Number(r.count) }));
}

export interface AulaBlockOption {
  value: string;
  count: number;
}

/**
 * Aulas existentes (blocos da pasta de aulas), da mais recente para a mais
 * antiga — alimenta o seletor "Aula" do cadastro manual de lead VozUP.
 */
export async function listAulaBlockOptions(): Promise<AulaBlockOption[]> {
  const folder = VOZUP_FOLDERS.find((f) => f.blockKind === "aula");
  if (!folder) return [];

  const pool = getPool();
  const result = await pool.query<{ bloco: string; count: string }>(`
    WITH ${PRIMARY_EVENT_LINKS_CTE}
    SELECT ${asEvent(AULA_BLOCK_EXPRESSION)} AS bloco, COUNT(*)::text AS count
    FROM ${PRIMARY_EVENT_LINKS_FROM}
    WHERE ${asEvent(folder.condition)}
    GROUP BY 1
    ORDER BY MAX(e.criado_em) DESC
  `);
  return result.rows.map((r) => ({ value: r.bloco, count: Number(r.count) }));
}

export const VOZUP_PAGE_SIZE = PAGE_SIZE;

// ── Vínculos do lead ─────────────────────────────────────────────────────────
// Cada evento (inscrição) do lead é um vínculo com uma pasta/bloco. A ficha
// permite listar, adicionar, remover e trocar esses vínculos livremente sem
// nunca criar outro cadastro visível: vínculos novos nascem como satélites
// (dashboard_merged_into = id do primário).

export interface LeadVinculo {
  /** Id da linha-evento que sustenta o vínculo (o próprio lead ou um satélite). */
  eventId: number;
  isPrimary: boolean;
  pasta: string;
  pastaLabel: string;
  pastaEmoji: string;
  bloco: string;
  criadoEm: string;
  /** Vínculo adicionado manualmente pela ficha (vs. vindo de formulário). */
  manual: boolean;
}

const PASTA_INSTITUTO = "instituto";

const PASTA_LABELS: Record<string, { label: string; emoji: string }> = {
  ...Object.fromEntries(VOZUP_FOLDERS.map((f) => [f.key, { label: f.label, emoji: f.emoji }])),
  [PASTA_INSTITUTO]: { label: "Instituto UP", emoji: "📅" },
};

export function vinculoPastaLabel(pasta: string): { label: string; emoji: string } {
  return PASTA_LABELS[pasta] ?? { label: pasta, emoji: "🗂️" };
}

const INSTITUTO_EVENT_CONDITION = () => asEvent(INSTITUTO_PRODUCT_CONDITION);

export async function listLeadVinculos(leadId: number): Promise<LeadVinculo[]> {
  const pool = getPool();
  const result = await pool.query<{
    id: number;
    is_primary: boolean;
    pasta: string;
    bloco: string;
    criado_em: string;
    manual: boolean;
  }>(
    `WITH events AS (
      SELECT id, payload, criado_em, true AS is_primary
      FROM inscricoes.inscricoes
      WHERE id = $1

      UNION ALL

      SELECT id, payload, criado_em, false AS is_primary
      FROM inscricoes.inscricoes
      WHERE payload->>'dashboard_merged_into' = $1::text
    )
    SELECT
      e.id,
      e.is_primary,
      CASE
        WHEN ${INSTITUTO_EVENT_CONDITION()} THEN '${PASTA_INSTITUTO}'
        ELSE ${vozupFolderCaseForEvents()}
      END AS pasta,
      CASE
        WHEN ${INSTITUTO_EVENT_CONDITION()}
          THEN COALESCE(NULLIF(${asEvent(TRAINING_EXPRESSION)}, ''), 'Sem treinamento')
        ELSE ${vozupBlockCaseForEvents()}
      END AS bloco,
      e.criado_em::text AS criado_em,
      (COALESCE(e.payload->>'dashboard_vinculo_manual', '') = 'true') AS manual
    FROM events AS e
    WHERE ${EVENT_FLAGS}
    ORDER BY e.criado_em DESC, e.id DESC`,
    [leadId]
  );

  return result.rows.map((row) => {
    const pastaInfo = vinculoPastaLabel(row.pasta);
    return {
      eventId: Number(row.id),
      isPrimary: Boolean(row.is_primary),
      pasta: row.pasta,
      pastaLabel: pastaInfo.label,
      pastaEmoji: pastaInfo.emoji,
      bloco: row.bloco,
      criadoEm: row.criado_em,
      manual: Boolean(row.manual),
    };
  });
}

/**
 * Campos de payload que fazem um evento cair na pasta/bloco desejados.
 * `clear` remove resíduos de outra classificação ao TROCAR um vínculo
 * (ex.: aula → treinamento não pode manter data_treinamento da aula).
 */
function vinculoPayloadFields(
  pasta: string,
  bloco: string
): { set: Record<string, string>; clear: string[] } {
  if (pasta === PASTA_INSTITUTO) {
    return {
      set: { treinamento: bloco },
      clear: [
        "origem",
        "data_treinamento",
        "dataTreinamento",
        "treinamento_nome",
        "campaign_name",
        "form_name",
        "unidade_negocio",
      ],
    };
  }

  const folder = getVozupFolder(pasta);
  if (folder?.blockKind === "aula") {
    const aula = aulaBlockToLeadFields(bloco);
    const set: Record<string, string> = { origem: aula.origem, unidade_negocio: "Voz UP" };
    const clear = ["treinamento", "treinamento_nome", "campaign_name", "form_name"];
    if (aula.data_treinamento) set.data_treinamento = aula.data_treinamento;
    else clear.push("data_treinamento");
    return { set, clear };
  }
  if (folder?.blockKind === "meta-form") {
    return {
      set: { origem: "Facebook Lead Ads", campaign_name: bloco, unidade_negocio: "Voz UP" },
      clear: ["treinamento", "treinamento_nome", "data_treinamento", "form_name"],
    };
  }
  return {
    set: { origem: bloco, unidade_negocio: "Voz UP" },
    clear: ["treinamento", "treinamento_nome", "data_treinamento", "campaign_name", "form_name"],
  };
}

async function bumpUltimaInteracao(leadId: number): Promise<void> {
  await getPool().query(
    `UPDATE inscricoes.inscricoes
     SET payload = jsonb_set(payload, '{dashboard_ultima_interacao}', to_jsonb($2::text))
     WHERE id = $1`,
    [leadId, new Date().toISOString()]
  );
}

async function getVisiblePrimary(leadId: number): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM inscricoes.inscricoes WHERE id = $1`,
    [leadId]
  );
  const payload = rows[0]?.payload;
  if (!payload) throw new Error("Lead não encontrado");
  if (String(payload.dashboard_merged_into ?? "").trim() !== "") {
    throw new Error("Este cadastro foi mesclado em outro lead");
  }
  if (String(payload.dashboard_excluido ?? "") === "true") {
    throw new Error("Este lead foi excluído");
  }
  return payload;
}

/** Adiciona um vínculo: cria um evento-satélite apontando para o lead. */
export async function addLeadVinculo(
  leadId: number,
  pasta: string,
  bloco: string
): Promise<void> {
  const primary = await getVisiblePrimary(leadId);
  const { set } = vinculoPayloadFields(pasta, bloco);

  const nome = String(primary.nome ?? primary.name ?? "").trim();
  const telefone = String(primary.telefone ?? primary.whatsapp ?? "").trim();

  const payload: Record<string, unknown> = {
    ...set,
    nome,
    _final: "true",
    timestamp: new Date().toISOString(),
    dashboard_criado_manualmente: "true",
    dashboard_vinculo_manual: "true",
    dashboard_merged_into: String(leadId),
  };
  if (telefone) payload.telefone = telefone;

  await getPool().query(
    `INSERT INTO inscricoes.inscricoes (payload) VALUES ($1::jsonb)`,
    [JSON.stringify(payload)]
  );
  await bumpUltimaInteracao(leadId);
}

/**
 * Remove um vínculo. Satélite: some de vez (dashboard_excluido). Vínculo
 * próprio da linha primária: só deixa de contar como atributo
 * (dashboard_vinculo_removido) — o lead continua existindo normalmente.
 */
export async function removeLeadVinculo(leadId: number, eventId: number): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: number }>(
      `SELECT id
       FROM inscricoes.inscricoes
       WHERE id = $1 OR payload->>'dashboard_merged_into' = $1::text
       FOR UPDATE`,
      [leadId]
    );

    const targetBelongsToLead = rows.some((row) => Number(row.id) === eventId);
    if (!targetBelongsToLead) {
      throw new Error("Vínculo não encontrado para este lead");
    }

    const activeCountResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM inscricoes.inscricoes AS e
       WHERE (e.id = $1 OR e.payload->>'dashboard_merged_into' = $1::text)
         AND ${EVENT_FLAGS}`,
      [leadId]
    );
    const activeCount = Number(activeCountResult.rows[0]?.count ?? 0);
    if (activeCount <= 1) {
      throw new Error("Não é possível excluir o único vínculo do lead. Apague o lead da pipeline.");
    }

    if (eventId === leadId) {
      const { rowCount } = await client.query(
        `UPDATE inscricoes.inscricoes
         SET payload = jsonb_set(payload, '{dashboard_vinculo_removido}', '"true"')
         WHERE id = $1 AND ${EVENT_FLAGS_NO_ALIAS}`,
        [leadId]
      );
      if (rowCount === 0) {
        throw new Error("Vínculo não encontrado para este lead");
      }
    } else {
      const { rowCount } = await client.query(
        `UPDATE inscricoes.inscricoes
         SET payload = jsonb_set(payload, '{dashboard_excluido}', '"true"')
         WHERE id = $1 AND payload->>'dashboard_merged_into' = $2::text AND ${EVENT_FLAGS_NO_ALIAS}`,
        [eventId, String(leadId)]
      );
      if (rowCount === 0) {
        throw new Error("Vínculo não encontrado para este lead");
      }
    }

    await client.query(
      `UPDATE inscricoes.inscricoes
       SET payload = jsonb_set(payload, '{dashboard_ultima_interacao}', to_jsonb($2::text))
       WHERE id = $1`,
      [leadId, new Date().toISOString()]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Troca um vínculo por outro (ex.: Aula Experimental → Aula Exclusiva). */
export async function replaceLeadVinculo(
  leadId: number,
  eventId: number,
  pasta: string,
  bloco: string
): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM inscricoes.inscricoes WHERE id = $1`,
    [eventId]
  );
  const payload = rows[0]?.payload;
  if (!payload) throw new Error("Vínculo não encontrado");

  const isPrimary = eventId === leadId;
  if (!isPrimary && String(payload.dashboard_merged_into ?? "") !== String(leadId)) {
    throw new Error("Vínculo não pertence a este lead");
  }

  const { set, clear } = vinculoPayloadFields(pasta, bloco);
  const next: Record<string, unknown> = { ...payload };
  for (const key of clear) delete next[key];
  Object.assign(next, set);
  // Trocar o vínculo próprio reativa o atributo caso tivesse sido removido.
  delete next.dashboard_vinculo_removido;

  await pool.query(
    `UPDATE inscricoes.inscricoes SET payload = $2::jsonb WHERE id = $1`,
    [eventId, JSON.stringify(next)]
  );
  await bumpUltimaInteracao(leadId);
}
