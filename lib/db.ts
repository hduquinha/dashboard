import { randomUUID } from "node:crypto";
import { Pool } from "pg";

// Permite certificados auto-assinados do Aiven
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { parsePayload, TRAINING_FIELD_KEYS } from "@/lib/parsePayload";
import {
  extractPreviousFormFields,
  extractUpDayFormData,
  hasUpDayFormData,
} from "@/lib/inscricaoForm";
import type { ImportPayload } from "@/lib/importSpreadsheet";
import {
  getRecruiterByCode,
  getRecruiterByCodeIfNamed,
  isPlaceholderName,
  listRecruiters,
  normalizeRecruiterCode,
  RECRUITERS_BASE_URL,
} from "@/lib/recruiters";
import {
  getTrainingById,
  listTrainingOptionIds,
  listTrainingOptions as listConfiguredTrainingOptions,
  formatTrainingDateLabel,
  buildAutoTrainingLabel,
  isIgnoredTrainingId,
} from "@/lib/trainings";
import {
  analyzeInscricaoQuality,
  hasQualityDismissed,
  issueCodeToDuplicateReason,
} from "@/lib/inscricaoQuality";
import type { TrainingOption } from "@/types/training";
import type {
  DuplicateGroup,
  DuplicateReason,
  DuplicateReasonDetail,
  DuplicateSummary,
  EnrollmentSummary,
  InscricaoItem,
  InscricaoNote,
  InscricaoStatus,
  InscricaoTipo,
  CommercialStage,
  ListInscricoesResult,
  OrderableField,
  OrderDirection,
} from "@/types/inscricao";

const SCHEMA_NAME = "inscricoes";

function payloadTextExpression(alias: string, keys: string[], fallback = "''"): string {
  const selectors = keys.flatMap((key) => [
    `NULLIF(TRIM(${alias}.payload->>'${key}'), '')`,
    `NULLIF(TRIM(${alias}.payload->'dados_extras'->>'${key}'), '')`,
    `NULLIF(TRIM(${alias}.payload->'dadosExtras'->>'${key}'), '')`,
  ]);
  return `COALESCE(${selectors.join(", ")}, ${fallback})`;
}

const NAME_EXPRESSION = payloadTextExpression("i", ["nome", "name", "dashboard_nome"]);
const PHONE_EXPRESSION = payloadTextExpression("i", ["telefone", "phone", "celular", "whatsapp", "dashboard_telefone"]);
const CITY_EXPRESSION = payloadTextExpression("i", ["cidade", "city", "dashboard_cidade"]);
const EMAIL_EXPRESSION = payloadTextExpression("i", ["email"]);
const PROFESSION_EXPRESSION = payloadTextExpression("i", [
  "profissao_area",
  "profissaoArea",
  "profissao",
  "dashboard_profissao",
  "occupation",
  "job",
]);
const EXPLICIT_TRAINING_EXPRESSION = payloadTextExpression("i", [
  "treinamento",
  "training",
  "training_id",
  "trainingId",
  "training_code",
  "trainingCode",
  "treinamento_id",
  "treinamento_nome",
  "treinamentoNome",
  "training_option",
  "trainingOption",
]);
const UPDAY_TRAINING_DATE_EXPRESSION = payloadTextExpression("i", [
  "data_treinamento",
  "dataTreinamento",
  "training_date",
  "trainingDate",
  "data_treinamento_extenso",
  "dataTreinamentoExtenso",
  "treinamento_inicio",
  "treinamentoInicio",
  "training_start",
  "trainingStart",
]);
const ONLINE_TRAINING_DATE_EXPRESSION = payloadTextExpression("i", [
  "data_treinamento",
  "dataTreinamento",
  "training_date",
  "trainingDate",
  "data_treinamento_extenso",
  "dataTreinamentoExtenso",
]);
const DASHBOARD_TRAINING_EXPRESSION = payloadTextExpression("i", ["dashboard_treinamento"]);
const UPDAY_PAYLOAD_CONDITION = `(
  LOWER(${EXPLICIT_TRAINING_EXPRESSION}) LIKE '%up day%'
  OR LOWER(${payloadTextExpression("i", ["origem", "source", "origin"])}) = 'landing-inscricao-agosto-2026'
  OR (
    ${payloadTextExpression("i", ["tamanho_camiseta", "tamanhoCamiseta", "multa_ciente", "multaCiente", "cancelamento_ciente", "cancelamentoCiente"])} <> ''
    AND ${UPDAY_TRAINING_DATE_EXPRESSION} <> ''
  )
)`;
const TRAINING_EXPRESSION = `COALESCE(
  CASE WHEN ${UPDAY_PAYLOAD_CONDITION} THEN NULLIF(${UPDAY_TRAINING_DATE_EXPRESSION}, '') END,
  CASE WHEN NOT ${UPDAY_PAYLOAD_CONDITION} THEN NULLIF(${ONLINE_TRAINING_DATE_EXPRESSION}, '') END,
  NULLIF(${EXPLICIT_TRAINING_EXPRESSION}, ''),
  NULLIF(${DASHBOARD_TRAINING_EXPRESSION}, ''),
  ''
)`;
const RECRUITER_EXPRESSION = payloadTextExpression("i", [
  "traffic_source",
  "codigo_indicador",
  "indicador",
  "recrutadorCodigo",
  "codigo_recrutador",
  "recruiter_code",
  "source",
  "ref",
  "referral",
  "dashboard_indicador_codigo",
  "dashboard_indicador_nome",
]);
const INDICATION_EXPRESSION = payloadTextExpression("i", [
  "indicacao",
  "indicado_por",
  "traffic_source",
  "codigo_indicador",
  "indicador",
  "recrutadorCodigo",
  "codigo_recrutador",
  "recruiter_code",
  "source",
  "ref",
  "referral",
  "dashboard_indicador_codigo",
  "dashboard_indicador_nome",
]);
const SHIRT_SIZE_EXPRESSION = payloadTextExpression("i", [
  "tamanho_camiseta",
  "tamanhoCamiseta",
  "camiseta",
]);
const CPF_EXPRESSION = payloadTextExpression("i", ["cpf", "documento", "document"]);
const CLIENT_ID_EXPRESSION = payloadTextExpression("i", ["clientId", "client_id"]);
const FINALIZED_INSCRICAO_CONDITION =
  process.env.DASHBOARD_INCLUDE_INCOMPLETE === "true"
    ? "TRUE"
    : `LOWER(TRIM(${payloadTextExpression("i", ["_final"], "''")})) IN ('true', '1', 'sim', 'yes')`;
const PRESENCE_VALIDATED_CONDITION =
  "LOWER(TRIM(COALESCE(i.payload->>'presenca_validada', ''))) IN ('true', '1', 'sim', 'yes')";
const PRESENCE_APPROVED_CONDITION =
  "LOWER(TRIM(COALESCE(i.payload->>'presenca_aprovada', ''))) IN ('true', '1', 'sim', 'yes')";
const PRESENCE_TRAINING_EXPRESSION = `COALESCE(NULLIF(TRIM(i.payload->>'presenca_treinamento_id'), ''), ${TRAINING_EXPRESSION})`;
const NORMALIZE_BR_PHONE = (expr: string) => `(
  CASE
    WHEN LENGTH(REGEXP_REPLACE(${expr}, '\\D', '', 'g')) BETWEEN 12 AND 13
         AND REGEXP_REPLACE(${expr}, '\\D', '', 'g') LIKE '55%'
      THEN SUBSTRING(REGEXP_REPLACE(${expr}, '\\D', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(${expr}, '\\D', '', 'g')
  END
)`;
const UNIQUE_INSCRICAO_PERSON_KEY = `
  CASE
    WHEN LENGTH(${NORMALIZE_BR_PHONE(PHONE_EXPRESSION)}) >= 10
      THEN 'phone:' || ${NORMALIZE_BR_PHONE(PHONE_EXPRESSION)}
    WHEN TRIM(${CLIENT_ID_EXPRESSION}) <> ''
      THEN 'client:' || LOWER(TRIM(${CLIENT_ID_EXPRESSION}))
    WHEN LOWER(TRIM(${EMAIL_EXPRESSION})) LIKE '%@%'
      THEN 'email:' || LOWER(TRIM(${EMAIL_EXPRESSION}))
    WHEN LENGTH(REGEXP_REPLACE(${CPF_EXPRESSION}, '\\D', '', 'g')) >= 11
      THEN 'cpf:' || REGEXP_REPLACE(${CPF_EXPRESSION}, '\\D', '', 'g')
    ELSE 'row:' || i.id::text
  END
`;
const UNIQUE_INSCRICAO_TRAINING_KEY = `LOWER(TRIM(COALESCE(NULLIF(${TRAINING_EXPRESSION}, ''), 'sem-treinamento')))`;
// Uma linha por pessoa (não por pessoa+treinamento): histórico de eventos vira etiquetas
const UNIQUE_INSCRICAO_PARTITION = UNIQUE_INSCRICAO_PERSON_KEY;
const DASHBOARD_SCHEMA_NAME = "dashboard";
const COMMERCIAL_STAGE_VALUES: CommercialStage[] = [
  "novo",
  "primeiro_contato",
  "em_atendimento",
  "agendado",
  "fechamento",
  "ganho",
  "perdido",
  "no_show",
];
const COMMERCIAL_STAGE_LABELS: Record<CommercialStage, string> = {
  novo: "Novo",
  primeiro_contato: "Primeiro contato",
  em_atendimento: "Em atendimento",
  agendado: "Agendado",
  fechamento: "Fechamento",
  ganho: "Ganho",
  perdido: "Perdido",
  no_show: "No-show",
};
let commercialSchemaReady = false;

async function ensureCommercialSchemaForReads(): Promise<void> {
  if (commercialSchemaReady) {
    return;
  }

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${DASHBOARD_SCHEMA_NAME};

    CREATE TABLE IF NOT EXISTS ${DASHBOARD_SCHEMA_NAME}.commercial_leads (
      inscricao_id INTEGER PRIMARY KEY REFERENCES ${SCHEMA_NAME}.inscricoes(id) ON DELETE CASCADE,
      campaign_source TEXT,
      campaign_name TEXT,
      campaign_medium TEXT,
      campaign_term TEXT,
      landing_page TEXT,
      commercial_stage TEXT NOT NULL DEFAULT 'novo',
      assigned_seller_id INTEGER,
      assigned_seller_email TEXT,
      assigned_seller_name TEXT,
      assigned_by_user_id INTEGER,
      assigned_by_email TEXT,
      assigned_by_name TEXT,
      assigned_at TIMESTAMP WITH TIME ZONE,
      first_contact_inbox_id INTEGER,
      first_contact_inbox_name TEXT,
      closing_inbox_id INTEGER,
      closing_inbox_name TEXT,
      closing_conversation_id INTEGER,
      closing_conversation_display_id INTEGER,
      closing_conversation_url TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_commercial_leads_stage ON ${DASHBOARD_SCHEMA_NAME}.commercial_leads(commercial_stage);
    CREATE INDEX IF NOT EXISTS idx_commercial_leads_seller ON ${DASHBOARD_SCHEMA_NAME}.commercial_leads(assigned_seller_email, assigned_seller_id);
    CREATE INDEX IF NOT EXISTS idx_commercial_leads_campaign ON ${DASHBOARD_SCHEMA_NAME}.commercial_leads(campaign_source, campaign_name);
  `);

  commercialSchemaReady = true;
}

function payloadCampaignExpression(alias: string, keys: string[]): string {
  return payloadTextExpression(alias, keys, "NULL");
}

const CAMPAIGN_SOURCE_EXPRESSION = payloadCampaignExpression("i", [
  "campaign_source",
  "campaignSource",
  "utm_source",
  "utmSource",
  "lead_source",
  "leadSource",
  "origem_formulario",
  "origemFormulario",
  "lead_origem",
  "leadOrigem",
  "platform",
  "plataforma",
  "publisher_platform",
  "publisherPlatform",
  "channel",
  "canal",
  "origem",
  "source",
  "traffic_source",
  "trafficSource",
]);
const CAMPAIGN_NAME_EXPRESSION = payloadCampaignExpression("i", [
  "campaign_name",
  "campaignName",
  "utm_campaign",
  "utmCampaign",
  "utm_id",
  "utmId",
  "campaign",
  "campaign_id",
  "campaignId",
  "ad_campaign",
  "adCampaign",
  "campanha",
]);
const CAMPAIGN_MEDIUM_EXPRESSION = payloadCampaignExpression("i", [
  "campaign_medium",
  "campaignMedium",
  "utm_medium",
  "utmMedium",
  "placement",
  "posicionamento",
  "medium",
]);
const CAMPAIGN_TERM_EXPRESSION = payloadCampaignExpression("i", [
  "campaign_term",
  "campaignTerm",
  "utm_term",
  "utmTerm",
  "keyword",
  "palavra_chave",
  "ad_name",
  "adName",
  "creative_name",
  "creativeName",
  "term",
]);
const LANDING_PAGE_EXPRESSION = payloadCampaignExpression("i", [
  "landing_page",
  "landingPage",
  "landing",
  "page_url",
  "pageUrl",
  "form_url",
  "formUrl",
  "referrer",
  "referer",
  "url",
]);

// Cache de recrutadores do banco de dados
interface RecruiterCache {
  code: string;
  name: string;
  id: number;
}
const recruiterDbCache = new Map<string, RecruiterCache | null>();
let recruiterCacheLoaded = false;

export async function loadRecruiterCache(): Promise<void> {
  if (recruiterCacheLoaded) {
    return;
  }
  
  try {
    const query = `
      SELECT 
        i.id,
        ${NAME_EXPRESSION} AS nome,
        COALESCE(
          NULLIF(TRIM(i.payload->>'codigoRecrutador'), ''),
          NULLIF(TRIM(i.payload->>'codigo_recrutador'), ''),
          NULLIF(TRIM(i.payload->>'codigo'), ''),
          NULLIF(TRIM(i.payload->>'codigoProprio'), ''),
          NULLIF(TRIM(i.payload->>'codigo_indicador_proprio'), '')
        ) AS codigo_proprio
      FROM ${SCHEMA_NAME}.inscricoes i
      WHERE (
        NULLIF(TRIM(i.payload->>'codigoRecrutador'), '') IS NOT NULL OR
        NULLIF(TRIM(i.payload->>'codigo_recrutador'), '') IS NOT NULL OR
        NULLIF(TRIM(i.payload->>'codigo'), '') IS NOT NULL OR
        NULLIF(TRIM(i.payload->>'codigoProprio'), '') IS NOT NULL OR
        NULLIF(TRIM(i.payload->>'codigo_indicador_proprio'), '') IS NOT NULL
      )
      AND ${FINALIZED_INSCRICAO_CONDITION}
    `;
    
    const { rows } = await getPool().query<{ id: number; nome: string | null; codigo_proprio: string | null }>(query);
    
    for (const row of rows) {
      if (row.codigo_proprio && row.nome) {
        const normalized = normalizeRecruiterCode(row.codigo_proprio);
        if (normalized && !recruiterDbCache.has(normalized)) {
          recruiterDbCache.set(normalized, {
            code: normalized,
            name: row.nome.trim(),
            id: row.id,
          });
        }
      }
    }
    
    recruiterCacheLoaded = true;
  } catch (error) {
    console.error("Failed to load recruiter cache from database:", error);
  }
}

export function getRecruiterFromCache(code: string | null): RecruiterCache | null {
  if (!code) {
    return null;
  }
  const normalized = normalizeRecruiterCode(code);
  if (!normalized) {
    return null;
  }
  return recruiterDbCache.get(normalized) ?? null;
}

// Função para invalidar cache (chamar quando adicionar novo recrutador)
export function invalidateRecruiterCache(): void {
  recruiterDbCache.clear();
  recruiterCacheLoaded = false;
}

// Lista recrutadores mesclando lista estática com nomes do banco de dados
export async function listRecruitersWithDbNames(): Promise<Array<{ code: string; name: string }>> {
  await loadRecruiterCache();
  
  const staticRecruiters = listRecruiters();
  
  return staticRecruiters.map((r) => {
    // Se tem nome no cache do banco e não é placeholder
    const dbRecruiter = recruiterDbCache.get(r.code);
    if (dbRecruiter && dbRecruiter.name && !isPlaceholderName(dbRecruiter.name)) {
      return { code: r.code, name: dbRecruiter.name };
    }
    // Se o nome estático é placeholder, tenta buscar do cache
    if (isPlaceholderName(r.name) && dbRecruiter) {
      return { code: r.code, name: dbRecruiter.name };
    }
    return { code: r.code, name: r.name };
  }).filter((r) => !isPlaceholderName(r.name)); // Remove os que ainda são placeholder
}

const RECRUITER_CODE_FIELDS = [
  "codigoRecrutador",
  "codigo_recrutador",
  "codigo",
  "codigoProprio",
  "codigo_indicador_proprio",
];

const ORDERABLE_COLUMNS: Record<OrderableField, string> = {
  id: "i.id",
  nome: `LOWER(${NAME_EXPRESSION})`,
  telefone: PHONE_EXPRESSION,
  cidade: `LOWER(${CITY_EXPRESSION})`,
  profissao: `LOWER(${PROFESSION_EXPRESSION})`,
  treinamento: TRAINING_EXPRESSION,
  recrutador: RECRUITER_EXPRESSION,
  criado_em: "i.criado_em",
  status_at: `COALESCE(NULLIF(TRIM(COALESCE(i.payload->>'dashboard_status_at', i.payload->>'status_at', '')), ''), i.criado_em::text)`,
  stars: `COALESCE(NULLIF(TRIM(COALESCE(i.payload->>'dashboard_stars', '')), ''), '0')::int`,
  commercial_stage: `COALESCE(cl.commercial_stage, 'novo')`,
};

declare global {
  var pgPool: Pool | undefined;
}

interface ListInscricoesOptions {
  page?: number;
  pageSize?: number;
  orderBy?: OrderableField;
  orderDirection?: OrderDirection;
  filters?: {
    caracteristica?: string;
    nome?: string;
    telefone?: string;
    cidade?: string;
    profissao?: string;
    indicacao?: string;
    treinamento?: string;
    treinamentoIds?: string[];
    dataTreinamento?: string;
    tamanhoCamiseta?: string;
    status?: InscricaoStatus;
    stars?: string | number;
    campaignSource?: string;
    campaignName?: string;
    commercialStage?: CommercialStage;
    assignedSellerEmail?: string;
    assignedSellerId?: number;
    unassignedOnly?: boolean;
    presenca?: "aprovada" | "reprovada" | "validada" | "nao-validada";
    produto?: "vozup" | "instituto";
    tag?: "recrutador" | "whatsapp" | "com-indicador" | "com-dinamica";
  };
}

interface DbRow {
  id: number;
  payload: Record<string, unknown>;
  criado_em: Date | string;
  nome: string | null;
  telefone: string | null;
  cidade: string | null;
  profissao: string | null;
  treinamento: string | null;
  traffic_source: string | null;
  total_count: number | string | null;
  person_key: string | null;
  campaign_source: string | null;
  campaign_name: string | null;
  campaign_medium: string | null;
  campaign_term: string | null;
  landing_page: string | null;
  commercial_stage: CommercialStage | null;
  assigned_seller_id: number | null;
  assigned_seller_email: string | null;
  assigned_seller_name: string | null;
  assigned_at: Date | string | null;
  first_contact_inbox_id: number | null;
  first_contact_inbox_name: string | null;
  closing_inbox_id: number | null;
  closing_inbox_name: string | null;
  closing_conversation_id: number | null;
  closing_conversation_display_id: number | null;
  closing_conversation_url: string | null;
}

interface DuplicateDbRow extends DbRow {
  telefone_normalizado: string | null;
  email_normalizado: string | null;
  nome_normalizado: string | null;
  criado_dia: Date | string | null;
  payload_hash: string | null;
}

const STATUS_VALUES: InscricaoStatus[] = ["aguardando", "aprovado", "rejeitado"];

function parseStatus(value: unknown): InscricaoStatus {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (STATUS_VALUES.includes(normalized as InscricaoStatus)) {
      return normalized as InscricaoStatus;
    }
  }
  return "aguardando";
}

function parseNotes(value: unknown): InscricaoNote[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const mappedNotes = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : randomUUID();
      const content = typeof record.content === "string" ? record.content.trim() : null;
      if (!content) {
        return null;
      }
      const createdAtRaw = typeof record.createdAt === "string" ? record.createdAt : record.created_at;
      const createdAt = typeof createdAtRaw === "string" && createdAtRaw.trim().length > 0 ? createdAtRaw : new Date().toISOString();
      const author = typeof record.author === "string" ? record.author : null;
      const viaWhatsapp = typeof record.viaWhatsapp === "boolean"
        ? record.viaWhatsapp
        : typeof record.whatsapp === "boolean"
        ? record.whatsapp
        : null;

      const note: InscricaoNote = {
        id,
        content,
        createdAt,
        author,
        viaWhatsapp,
      };
      return note;
    });

  const normalizedNotes = mappedNotes.filter((note): note is InscricaoNote => note !== null);

  return normalizedNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function parseIntField(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseInt(value, 10) || null;
  return null;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeCommercialStage(value: unknown): CommercialStage {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (COMMERCIAL_STAGE_VALUES.includes(normalized as CommercialStage)) {
      return normalized as CommercialStage;
    }
  }
  return "novo";
}

function buildPresencaDia(payload: Record<string, unknown>, dia: number): import("@/types/inscricao").PresencaDia | null {
  const prefix = `presenca_dia${dia}`;
  const nome = payload[`${prefix}_participante_nome`];
  const aprovado = payload[`${prefix}_aprovado`];
  // Only return a day object if at least the nome or aprovado field exists
  if (nome === undefined && aprovado === undefined) return null;
  return {
    participanteNome: typeof nome === "string" ? nome : null,
    aprovado: aprovado === true || aprovado === "true",
    tempoTotal: parseIntField(payload[`${prefix}_tempo_total`]),
    tempoDinamica: parseIntField(payload[`${prefix}_tempo_dinamica`]),
    percentualDinamica: parseIntField(payload[`${prefix}_percentual_dinamica`]),
    temDinamica: payload[`${prefix}_tem_dinamica`] === true || payload[`${prefix}_tem_dinamica`] === "true",
  };
}

function appendNoteToPayload(
  target: Record<string, unknown>,
  note: { content: string; viaWhatsapp?: boolean | null; author?: string | null }
) {
  const trimmed = note.content.trim();
  if (!trimmed) {
    return;
  }

  const existingRaw = Array.isArray(target["dashboard_notes"])
    ? [...(target["dashboard_notes"] as unknown[])]
    : [];

  existingRaw.push({
    id: randomUUID(),
    content: trimmed,
    createdAt: new Date().toISOString(),
    author: note.author ?? null,
    viaWhatsapp: typeof note.viaWhatsapp === "boolean" ? note.viaWhatsapp : undefined,
  });

  target["dashboard_notes"] = existingRaw;
}

function mapDbRowToInscricaoItem(row: DbRow): InscricaoItem {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const parsed = parsePayload(payload);
  const upDay = extractUpDayFormData(payload);
  const previousFormFields = extractPreviousFormFields(payload);
  const isUpDayInscricao = hasUpDayFormData(upDay);

  const createdAtRaw = row.criado_em;
  let createdAt: string;
  if (createdAtRaw instanceof Date) {
    createdAt = createdAtRaw.toISOString();
  } else {
    const temporal = new Date(createdAtRaw ?? Date.now());
    createdAt = Number.isNaN(temporal.getTime()) ? new Date().toISOString() : temporal.toISOString();
  }

  const parsedTrafficSource = typeof parsed.traffic_source === "string" ? parsed.traffic_source : undefined;
  const rowTrafficSource = typeof row.traffic_source === "string" ? row.traffic_source : undefined;
  const codeCandidate = parsedTrafficSource ?? rowTrafficSource ?? null;
  const recruiterCode = normalizeRecruiterCode(codeCandidate);
  
  // Buscar primeiro no cache do banco, depois na lista fixa (sem placeholders)
  const recruiterFromDb = getRecruiterFromCache(codeCandidate);
  const recruiterFromList = getRecruiterByCodeIfNamed(codeCandidate);
  const recruiterName = recruiterFromDb?.name ?? recruiterFromList?.name ?? null;

  const parsedProfissao =
    typeof parsed.profissao === "string" && parsed.profissao.trim().length > 0
      ? parsed.profissao.trim()
      : undefined;
  const rowProfissao =
    typeof row.profissao === "string" && row.profissao.trim().length > 0
      ? row.profissao.trim()
      : undefined;

  const parsedTreinamento =
    typeof parsed.treinamento === "string" && parsed.treinamento.trim().length > 0
      ? parsed.treinamento.trim()
      : undefined;
  const rowTreinamento =
    typeof row.treinamento === "string" && row.treinamento.trim().length > 0
      ? row.treinamento.trim()
      : undefined;
  const treinamentoId = isUpDayInscricao
    ? rowTreinamento ?? upDay.dataTreinamento ?? parsedTreinamento ?? null
    : parsedTreinamento ?? rowTreinamento ?? null;
  const treinamentoInfo = treinamentoId ? getTrainingById(treinamentoId) : null;
  const treinamentoLabel =
    treinamentoInfo && typeof treinamentoInfo.label === "string"
      ? treinamentoInfo.label === treinamentoId
        ? null
        : treinamentoInfo.label
      : null;
  const treinamentoData =
    treinamentoInfo?.startsAt ??
    (isUpDayInscricao ? upDay.dataTreinamentoExtenso ?? upDay.dataTreinamento : null) ??
    treinamentoId ??
    null;
  const isOnlineEnrollment = !isUpDayInscricao && formatTrainingDateLabel(treinamentoData ?? treinamentoId) !== null;

  const parseRecruiterCode = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeRecruiterCode(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return normalizeRecruiterCode(String(value));
    }
    return null;
  };

  const recruiterSelfCodeCandidates: Array<unknown> = [
    parsed.codigoRecrutador,
    payload.codigo_recrutador,
    payload.codigo,
    payload.codigoProprio,
  ];
  const codigoProprio = recruiterSelfCodeCandidates
    .map((candidate) => parseRecruiterCode(candidate))
    .find((value) => value !== null) ?? null;

  const parseNumericId = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsedNumber = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsedNumber)) {
        return parsedNumber;
      }
    }
    return null;
  };

  const parentInscricaoId = [parsed.recrutadorId, parsed.parentId, parsed.indicadorId, parsed.sponsorId]
    .map((candidate) => parseNumericId(candidate))
    .find((value) => value !== null) ?? null;

  const nivelRaw =
    typeof parsed.nivel === "number"
      ? parsed.nivel
      : typeof parsed.nivel === "string"
      ? Number.parseInt(parsed.nivel, 10)
      : null;
  const nivel = Number.isFinite(nivelRaw ?? NaN) ? Math.max(0, Math.trunc(Number(nivelRaw))) : null;

  const parsedTipo = typeof parsed.tipo === "string" ? parsed.tipo.trim().toLowerCase() : null;
  const parsedIsRecruiter = typeof parsed.isRecruiter === "boolean"
    ? parsed.isRecruiter
    : typeof parsed.isRecruiter === "string"
    ? ["true", "1", "sim", "yes"].includes(parsed.isRecruiter.trim().toLowerCase())
    : false;

  let tipo: "lead" | "recrutador" = "lead";
  if (parsedTipo) {
    if (parsedTipo.startsWith("recrutador") || parsedTipo === "indicador" || parsedTipo === "upline") {
      tipo = "recrutador";
    }
  }
  if (parsedIsRecruiter) {
    tipo = "recrutador";
  }
  if (codigoProprio) {
    tipo = "recrutador";
  }

  const status = parseStatus((payload.dashboard_status ?? payload.status) as unknown);
  const statusUpdatedAt =
    typeof payload.dashboard_status_at === "string"
      ? payload.dashboard_status_at
      : typeof payload.status_at === "string"
      ? payload.status_at
      : null;
  const statusWhatsappContacted =
    typeof payload.dashboard_status_whatsapp === "boolean"
      ? payload.dashboard_status_whatsapp
      : typeof payload.status_whatsapp === "boolean"
      ? payload.status_whatsapp
      : null;
  const notes = parseNotes(payload.dashboard_notes);

  return {
    id: Number(row.id),
    payload,
    criadoEm: createdAt,
    parsedPayload: parsed,
    upDay,
    isUpDayInscricao,
    previousFormFields,
    nome: upDay.nome ?? (typeof row.nome === "string" ? row.nome : null),
    telefone: upDay.telefone ?? (typeof row.telefone === "string" ? row.telefone : null),
    cidade: upDay.cidade ?? (typeof row.cidade === "string" ? row.cidade : null),
    profissao: upDay.profissaoArea ?? parsedProfissao ?? rowProfissao ?? null,
    recrutadorCodigo: recruiterCode ?? (codeCandidate ? codeCandidate.trim() : null),
    recrutadorNome: recruiterName,
    recrutadorUrl:
      recruiterFromList?.url ?? (recruiterCode ? `${RECRUITERS_BASE_URL}${recruiterCode}` : null),
    treinamentoId,
    treinamentoNome: isOnlineEnrollment ? "Encontro Online" : treinamentoLabel ?? upDay.treinamentoNome,
    treinamentoData,
    tipo,
    codigoProprio,
    parentInscricaoId,
    nivel,
    isVirtual: false,
    status,
    statusUpdatedAt,
    statusWhatsappContacted,
    notes,
    // Campos de presença
    presencaValidada: payload.presenca_validada === "true" || payload.presenca_validada === true,
    presencaAprovada: payload.presenca_aprovada === "true" || payload.presenca_aprovada === true,
    presencaParticipanteNome: typeof payload.presenca_participante_nome === "string" ? payload.presenca_participante_nome : null,
    presencaTempoTotalMinutos: typeof payload.presenca_tempo_total_minutos === "number" 
      ? payload.presenca_tempo_total_minutos 
      : typeof payload.presenca_tempo_total_minutos === "string" 
        ? parseInt(payload.presenca_tempo_total_minutos, 10) || null 
        : null,
    presencaTempoDinamicaMinutos: typeof payload.presenca_tempo_dinamica_minutos === "number" 
      ? payload.presenca_tempo_dinamica_minutos 
      : typeof payload.presenca_tempo_dinamica_minutos === "string" 
        ? parseInt(payload.presenca_tempo_dinamica_minutos, 10) || null 
        : null,
    presencaPercentualDinamica: typeof payload.presenca_percentual_dinamica === "number" 
      ? payload.presenca_percentual_dinamica 
      : typeof payload.presenca_percentual_dinamica === "string" 
        ? parseInt(payload.presenca_percentual_dinamica, 10) || null 
        : null,
    presencaValidadaEm: typeof payload.presenca_validada_em === "string" ? payload.presenca_validada_em : null,
    presencaTotalDias: parseIntField(payload.presenca_total_dias),
    presencaDiaProcessado: parseIntField(payload.presenca_dia_processado),
    presencaDinamicaDias: typeof payload.presenca_dinamica_dias === "string" ? payload.presenca_dinamica_dias : null,
    presencaDia1: buildPresencaDia(payload, 1),
    presencaDia2: buildPresencaDia(payload, 2),
    stars: typeof payload.dashboard_stars === "number"
      ? payload.dashboard_stars
      : typeof payload.dashboard_stars === "string"
        ? parseInt(payload.dashboard_stars as string, 10) || null
        : null,
    commercial: {
      campaignSource: row.campaign_source ?? null,
      campaignName: row.campaign_name ?? null,
      campaignMedium: row.campaign_medium ?? null,
      campaignTerm: row.campaign_term ?? null,
      landingPage: row.landing_page ?? null,
      stage: normalizeCommercialStage(row.commercial_stage),
      assignedSellerId: row.assigned_seller_id ?? null,
      assignedSellerEmail: row.assigned_seller_email ?? null,
      assignedSellerName: row.assigned_seller_name ?? null,
      assignedAt: toIsoOrNull(row.assigned_at),
      firstContactInboxId: row.first_contact_inbox_id ?? null,
      firstContactInboxName: row.first_contact_inbox_name ?? null,
      closingInboxId: row.closing_inbox_id ?? null,
      closingInboxName: row.closing_inbox_name ?? null,
      closingConversationId: row.closing_conversation_id ?? null,
      closingConversationDisplayId: row.closing_conversation_display_id ?? null,
      closingConversationUrl: row.closing_conversation_url ?? null,
    },
    personKey: typeof row.person_key === "string" ? row.person_key : null,
    allEnrollments: null,
  };
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const sslDisabled = process.env.PG_SSL === "false";
  const poolMax = Number.parseInt(process.env.DASHBOARD_PG_POOL_MAX ?? "4", 10);

  return new Pool({
    connectionString,
    application_name: "painel-inscricoes",
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 4,
    min: 0, // Não manter conexões mínimas ociosas
    idleTimeoutMillis: 10000, // Fecha conexões ociosas após 10s
    connectionTimeoutMillis: 10000, // Timeout de 10s para conexão
    allowExitOnIdle: true, // Permite fechar o pool quando ocioso
    ssl: sslDisabled
      ? false
      : {
          rejectUnauthorized: false,
        },
  });
}

export function getPool(): Pool {
  if (!global.pgPool) {
    global.pgPool = createPool();
  }

  return global.pgPool;
}

function buildTrainingFilterCandidates(value: string): string[] {
  const seen = new Set<string>();
  const queue: string[] = [];

  const enqueue = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    queue.push(trimmed);
  };

  const enqueueDayTokens = (dayValue: string | null | undefined) => {
    if (!dayValue) {
      return;
    }
    const numeric = Number.parseInt(dayValue.trim(), 10);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 31) {
      return;
    }
    const normalized = String(numeric);
    enqueue(normalized);
    const padded = normalized.padStart(2, "0");
    if (padded !== normalized) {
      enqueue(padded);
    }
  };

  const enqueueCompositeSegments = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      return;
    }

    const compoundParts = trimmed.split("::");
    if (compoundParts.length > 1) {
      for (const part of compoundParts) {
        enqueue(part);
      }
    }

    const dashParts = trimmed.split(/\s+[–—-]\s+/);
    if (dashParts.length > 1) {
      for (const part of dashParts) {
        enqueue(part);
      }
    }

    if (trimmed.includes("|")) {
      for (const part of trimmed.split("|")) {
        enqueue(part);
      }
    }
  };

  enqueue(value);
  enqueueCompositeSegments(value);

  while (queue.length > 0) {
    const current = queue.shift()!;

    enqueueCompositeSegments(current);

    const info = getTrainingById(current);
    if (info) {
      enqueue(info.id);
      enqueue(info.label);
      enqueue(info.startsAt);
    }

    const formatted = formatTrainingDateLabel(current);
    enqueue(formatted);

    const isoMatch = current.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?))?(?:([+-]\d{2}:?\d{2}|Z))?/);
    if (isoMatch) {
      const [, datePart, timePart] = isoMatch;
      if (datePart) {
        enqueue(datePart);
        enqueueDayTokens(datePart.slice(8, 10));
      }
      if (timePart) {
        const normalizedTime = timePart.length === 5 ? `${timePart}:00` : timePart;
        enqueue(`${datePart} ${normalizedTime}`.trim());
        enqueue(`${datePart}T${normalizedTime}`.trim());
      }
    }

    const brMatch = current.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const [, day, month, year] = brMatch;
      enqueue(`${year}-${month}-${day}`);
      enqueueDayTokens(day);
    }

    if (/^\s*\d{1,2}\s*$/.test(current)) {
      enqueueDayTokens(current);
    }

    const dayKeywordMatch = current.match(/dia\s*(\d{1,2})/i);
    if (dayKeywordMatch) {
      enqueueDayTokens(dayKeywordMatch[1]);
    }

    const dayMonthTextMatch = current.match(/^\s*(\d{1,2})\s*(?:de|do)\s+[A-Za-zÀ-ÿ]+/i);
    if (dayMonthTextMatch) {
      enqueueDayTokens(dayMonthTextMatch[1]);
    }
  }

  return Array.from(seen);
}

function formatCityLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ")
    .trim();
  return normalized || null;
}

function buildCompositeTrainingId(
  trainingValue: string | null | undefined,
  cityValue: string | null | undefined
): string | null {
  const training = trainingValue?.trim() ?? "";
  const city = cityValue?.trim() ?? "";

  if (training && city) {
    return `${training}::${city}`;
  }
  if (training) {
    return training;
  }
  if (city) {
    return `cidade::${city}`;
  }
  return null;
}

function formatNormalizedPhone(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value;
}

function formatDateLabelPtBR(value: string | Date | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface EnrollmentRow {
  person_key: string;
  id: number;
  treinamento_id: string | null;
  treinamento_nome: string | null;
  treinamento_data: string | null;
  presenca_validada: boolean;
  presenca_aprovada: boolean;
  criado_em: Date | string;
  payload: Record<string, unknown> | null;
}

async function fetchEnrollmentsByPersonKeys(
  personKeys: string[]
): Promise<Map<string, EnrollmentSummary[]>> {
  const uniqueKeys = [...new Set(personKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) return new Map();

  const enrollmentTrainingNomeExpr = `COALESCE(
    NULLIF(TRIM(i.payload->>'treinamento_nome'), ''),
    NULLIF(TRIM(i.payload->>'treinamentoNome'), ''),
    NULLIF(TRIM(i.payload->>'nome_evento'), ''),
    ''
  )`;

  const query = `
    SELECT
      TRIM(${UNIQUE_INSCRICAO_PERSON_KEY}) AS person_key,
      i.id,
      NULLIF(${TRAINING_EXPRESSION}, '') AS treinamento_id,
      NULLIF(${enrollmentTrainingNomeExpr}, '') AS treinamento_nome,
      NULLIF(TRIM(COALESCE(
        NULLIF(TRIM(i.payload->>'data_treinamento'), ''),
        NULLIF(TRIM(i.payload->>'dataTreinamento'), ''),
        NULLIF(TRIM(i.payload->>'training_date'), ''),
        ''
      )), '') AS treinamento_data,
      CASE WHEN ${PRESENCE_VALIDATED_CONDITION} THEN true ELSE false END AS presenca_validada,
      CASE WHEN ${PRESENCE_APPROVED_CONDITION} THEN true ELSE false END AS presenca_aprovada,
      i.criado_em,
      i.payload
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE ${FINALIZED_INSCRICAO_CONDITION}
    AND TRIM(${UNIQUE_INSCRICAO_PERSON_KEY}) = ANY($1)
    ORDER BY i.criado_em ASC
  `;

  try {
    const { rows } = await getPool().query<EnrollmentRow>(query, [uniqueKeys]);
    const result = new Map<string, EnrollmentSummary[]>();

    for (const row of rows) {
      const key = row.person_key;
      if (!result.has(key)) result.set(key, []);

      result.get(key)!.push({
        id: Number(row.id),
        treinamentoId: row.treinamento_id ?? null,
        treinamentoNome: row.treinamento_nome ?? null,
        treinamentoData: row.treinamento_data ?? null,
        presencaValidada: Boolean(row.presenca_validada),
        presencaAprovada: Boolean(row.presenca_aprovada),
        criadoEm: toIsoOrNull(row.criado_em) ?? new Date().toISOString(),
        payload: row.payload ?? null,
      });
    }

    return result;
  } catch (error) {
    console.error("Failed to fetch enrollment history", error);
    return new Map();
  }
}

export async function listInscricoes(
  options: ListInscricoesOptions = {}
): Promise<ListInscricoesResult> {
  // Carregar cache de recrutadores do banco
  await Promise.all([loadRecruiterCache(), ensureCommercialSchemaForReads()]);
  
  const {
    page = 1,
    pageSize = 10,
    orderBy = "criado_em",
    orderDirection = "desc",
    filters = {},
  } = options;

  if (!Number.isFinite(page) || page < 1) {
    throw new Error("Invalid page number");
  }

  const pageSizeValue = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10;
  const sortColumn = ORDERABLE_COLUMNS[orderBy] ?? ORDERABLE_COLUMNS.criado_em;
  const sortDirection = orderDirection === "asc" ? "ASC" : "DESC";

  const conditions: string[] = [
    FINALIZED_INSCRICAO_CONDITION,
    "COALESCE(i.payload->>'dashboard_merged_into', '') = ''",
  ];
  const filtersValues: unknown[] = [];

  if (filters.caracteristica && filters.caracteristica.trim().length > 0) {
    const term = filters.caracteristica.trim();
    filtersValues.push(`%${term}%`);
    const likeIndex = filtersValues.length;
    const searchParts = [
      `${NAME_EXPRESSION} ILIKE $${likeIndex}`,
      `${EMAIL_EXPRESSION} ILIKE $${likeIndex}`,
      `${CITY_EXPRESSION} ILIKE $${likeIndex}`,
      `${PROFESSION_EXPRESSION} ILIKE $${likeIndex}`,
      `${TRAINING_EXPRESSION} ILIKE $${likeIndex}`,
      `${INDICATION_EXPRESSION} ILIKE $${likeIndex}`,
      `COALESCE(i.payload->>'dashboard_status', '') ILIKE $${likeIndex}`,
      `COALESCE(i.payload->>'dashboard_notes', '') ILIKE $${likeIndex}`,
      `CAST(i.payload AS TEXT) ILIKE $${likeIndex}`,
    ];

    const digits = term.replace(/\D+/g, "");
    if (digits.length >= 3) {
      filtersValues.push(`%${digits}%`);
      const digitsIndex = filtersValues.length;
      searchParts.push(`REGEXP_REPLACE(${PHONE_EXPRESSION}, '\\D', '', 'g') ILIKE $${digitsIndex}`);
    }

    conditions.push(`(${searchParts.join(" OR ")})`);
  }

  if (filters.nome && filters.nome.trim().length > 0) {
    filtersValues.push(`%${filters.nome.trim()}%`);
    conditions.push(`${NAME_EXPRESSION} ILIKE $${filtersValues.length}`);
  }

  if (filters.telefone && filters.telefone.trim().length > 0) {
    const cleaned = filters.telefone.replace(/\D+/g, "");
    filtersValues.push(`%${cleaned}%`);
    conditions.push(
      `REGEXP_REPLACE(${PHONE_EXPRESSION}, '\\D', '', 'g') ILIKE $${filtersValues.length}`
    );
  }

  if (filters.cidade && filters.cidade.trim().length > 0) {
    filtersValues.push(`%${filters.cidade.trim()}%`);
    conditions.push(`${CITY_EXPRESSION} ILIKE $${filtersValues.length}`);
  }

  if (filters.profissao && filters.profissao.trim().length > 0) {
    filtersValues.push(`%${filters.profissao.trim()}%`);
    conditions.push(`${PROFESSION_EXPRESSION} ILIKE $${filtersValues.length}`);
  }

  if (filters.tamanhoCamiseta && filters.tamanhoCamiseta.trim().length > 0) {
    filtersValues.push(filters.tamanhoCamiseta.trim().toUpperCase());
    conditions.push(`UPPER(${SHIRT_SIZE_EXPRESSION}) = $${filtersValues.length}`);
  }

  if (filters.indicacao && filters.indicacao.trim().length > 0) {
    const indicacaoTerm = filters.indicacao.trim();
    const normalizedCode = normalizeRecruiterCode(indicacaoTerm);
    const recruiterMatches = listRecruiters()
      .filter((recruiter) => recruiter.name.toLowerCase().includes(indicacaoTerm.toLowerCase()))
      .map((recruiter) => recruiter.code);

    const codeCandidates = new Set<string>();
    if (normalizedCode) {
      codeCandidates.add(normalizedCode);
    }
    for (const code of recruiterMatches) {
      if (code) {
        codeCandidates.add(normalizeRecruiterCode(code) ?? code);
      }
    }

    filtersValues.push(`%${indicacaoTerm}%`);
    const likeIndex = filtersValues.length;

    if (codeCandidates.size > 0) {
      filtersValues.push(Array.from(codeCandidates));
      const arrayIndex = filtersValues.length;
      conditions.push(
        `(${INDICATION_EXPRESSION} ILIKE $${likeIndex} OR ${RECRUITER_EXPRESSION} = ANY($${arrayIndex}))`
      );
    } else {
      conditions.push(`${INDICATION_EXPRESSION} ILIKE $${likeIndex}`);
    }
  }

  const trainingFilterValue = filters.dataTreinamento?.trim() || filters.treinamento?.trim() || "";
  if (trainingFilterValue.length > 0) {
    const treinamentoValue = trainingFilterValue;
    filtersValues.push(treinamentoValue);
    const paramIndex = filtersValues.length;
    conditions.push(`${TRAINING_EXPRESSION} = $${paramIndex}`);
  } else if (filters.treinamentoIds && filters.treinamentoIds.length > 0) {
    filtersValues.push(filters.treinamentoIds);
    conditions.push(`${TRAINING_EXPRESSION} = ANY($${filtersValues.length}::text[])`);
  }

  if (filters.status && STATUS_VALUES.includes(filters.status)) {
    filtersValues.push(filters.status);
    conditions.push(
      `LOWER(TRIM(COALESCE(i.payload->>'dashboard_status', i.payload->>'status', 'aguardando'))) = $${filtersValues.length}`
    );
  }

  if (filters.stars !== undefined && filters.stars !== null && String(filters.stars).trim().length > 0) {
    const parsedStars = Number.parseInt(String(filters.stars), 10);
    if (Number.isInteger(parsedStars) && parsedStars >= 1 && parsedStars <= 5) {
      filtersValues.push(parsedStars);
      conditions.push(
        `(i.payload->>'dashboard_stars') ~ '^[1-5]$' AND (i.payload->>'dashboard_stars')::int = $${filtersValues.length}`
      );
    }
  }

  if (filters.campaignSource && filters.campaignSource.trim().length > 0) {
    filtersValues.push(`%${filters.campaignSource.trim()}%`);
    conditions.push(`COALESCE(cl.campaign_source, ${CAMPAIGN_SOURCE_EXPRESSION}) ILIKE $${filtersValues.length}`);
  }

  if (filters.campaignName && filters.campaignName.trim().length > 0) {
    filtersValues.push(`%${filters.campaignName.trim()}%`);
    conditions.push(`COALESCE(cl.campaign_name, ${CAMPAIGN_NAME_EXPRESSION}) ILIKE $${filtersValues.length}`);
  }

  if (filters.commercialStage && COMMERCIAL_STAGE_VALUES.includes(filters.commercialStage)) {
    filtersValues.push(filters.commercialStage);
    conditions.push(`COALESCE(cl.commercial_stage, 'novo') = $${filtersValues.length}`);
  }

  if (filters.assignedSellerEmail && filters.assignedSellerEmail.trim().length > 0) {
    filtersValues.push(filters.assignedSellerEmail.trim().toLowerCase());
    conditions.push(`LOWER(COALESCE(cl.assigned_seller_email, '')) = $${filtersValues.length}`);
  }

  if (filters.assignedSellerId && Number.isFinite(filters.assignedSellerId)) {
    filtersValues.push(Math.trunc(filters.assignedSellerId));
    conditions.push(`cl.assigned_seller_id = $${filtersValues.length}`);
  }

  if (filters.unassignedOnly) {
    conditions.push(`cl.assigned_seller_id IS NULL AND COALESCE(cl.assigned_seller_email, '') = ''`);
  }

  // Filtro de presença
  if (filters.presenca) {
    switch (filters.presenca) {
      case "aprovada":
        conditions.push(`(i.payload->>'presenca_validada')::boolean = true AND (i.payload->>'presenca_aprovada')::boolean = true`);
        break;
      case "reprovada":
        conditions.push(`(i.payload->>'presenca_validada')::boolean = true AND ((i.payload->>'presenca_aprovada')::boolean = false OR i.payload->>'presenca_aprovada' IS NULL)`);
        break;
      case "validada":
        conditions.push(`(i.payload->>'presenca_validada')::boolean = true`);
        break;
      case "nao-validada":
        conditions.push(`(i.payload->>'presenca_validada' IS NULL OR (i.payload->>'presenca_validada')::boolean = false)`);
        break;
    }
  }

  // Filtro de etiqueta
  if (filters.tag) {
    switch (filters.tag) {
      case "recrutador":
        conditions.push(`(
          LOWER(TRIM(COALESCE(i.payload->>'tipo', ''))) LIKE 'recrutador%'
          OR LOWER(TRIM(COALESCE(i.payload->>'tipo', ''))) IN ('indicador', 'upline')
          OR NULLIF(TRIM(COALESCE(i.payload->>'codigo_recrutador', i.payload->>'recrutadorCodigo', '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(i.payload->>'recrutadorId', i.payload->>'parentId', i.payload->>'indicadorId', i.payload->>'sponsorId', '')), '') IS NOT NULL
        )`);
        break;
      case "whatsapp":
        conditions.push(`LOWER(TRIM(COALESCE(i.payload->>'dashboard_status_whatsapp', ''))) IN ('true', '1', 'sim', 'yes')`);
        break;
      case "com-indicador":
        conditions.push(`(
          NULLIF(TRIM(COALESCE(i.payload->>'traffic_source', '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(i.payload->>'codigo_indicador', '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(i.payload->>'codigo_recrutador', '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(i.payload->>'recrutadorCodigo', '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(i.payload->>'recrutadorId', '')), '') IS NOT NULL
        )`);
        break;
      case "com-dinamica":
        conditions.push(`(
          (i.payload->>'presenca_tempo_dinamica_minutos' IS NOT NULL AND TRIM(COALESCE(i.payload->>'presenca_tempo_dinamica_minutos', '0')) <> '' AND TRIM(COALESCE(i.payload->>'presenca_tempo_dinamica_minutos', '0')) <> '0')
          OR (NULLIF(TRIM(COALESCE(i.payload->>'presenca_dinamica_dias', '')), '') IS NOT NULL)
        )`);
        break;
    }
  }

  // Filtro de produto (unidade de negócio)
  if (filters.produto) {
    const vozupCond = `(
      LOWER(COALESCE(i.payload->>'unidade_negocio', '')) LIKE '%voz%'
      OR LOWER(COALESCE(i.payload->>'origem', '')) LIKE '%vozup%'
      OR LOWER(COALESCE(i.payload->>'origem', '')) LIKE '%voz up%'
      OR LOWER(COALESCE(i.payload->>'lead_setor', '')) LIKE '%voz%'
    )`;
    conditions.push(filters.produto === "vozup" ? vozupCond : `NOT ${vozupCond}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const offset = (page - 1) * pageSizeValue;
  const limitIndex = filtersValues.length + 1;
  const offsetIndex = filtersValues.length + 2;
  const queryValues = [...filtersValues, pageSizeValue, offset];

  const query = `
    WITH filtered_unique_inscricoes AS (
      SELECT
        i.id,
        ROW_NUMBER() OVER (
          PARTITION BY ${UNIQUE_INSCRICAO_PARTITION}
          ORDER BY
            CASE WHEN LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes') THEN 1 ELSE 0 END DESC,
            CASE WHEN COALESCE(i.payload->>'_step', '') ~ '^\\d+$' THEN (i.payload->>'_step')::int ELSE 0 END DESC,
            i.criado_em DESC,
            i.id DESC
        ) AS duplicate_rank
      FROM ${SCHEMA_NAME}.inscricoes AS i
      LEFT JOIN ${DASHBOARD_SCHEMA_NAME}.commercial_leads cl ON cl.inscricao_id = i.id
      ${whereClause}
    )
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      ${NAME_EXPRESSION} AS nome,
      ${PHONE_EXPRESSION} AS telefone,
      ${CITY_EXPRESSION} AS cidade,
      ${PROFESSION_EXPRESSION} AS profissao,
      ${TRAINING_EXPRESSION} AS treinamento,
      ${RECRUITER_EXPRESSION} AS traffic_source,
      COALESCE(cl.campaign_source, ${CAMPAIGN_SOURCE_EXPRESSION}) AS campaign_source,
      COALESCE(cl.campaign_name, ${CAMPAIGN_NAME_EXPRESSION}) AS campaign_name,
      COALESCE(cl.campaign_medium, ${CAMPAIGN_MEDIUM_EXPRESSION}) AS campaign_medium,
      COALESCE(cl.campaign_term, ${CAMPAIGN_TERM_EXPRESSION}) AS campaign_term,
      COALESCE(cl.landing_page, ${LANDING_PAGE_EXPRESSION}) AS landing_page,
      cl.commercial_stage,
      cl.assigned_seller_id,
      cl.assigned_seller_email,
      cl.assigned_seller_name,
      cl.assigned_at,
      cl.first_contact_inbox_id,
      cl.first_contact_inbox_name,
      cl.closing_inbox_id,
      cl.closing_inbox_name,
      cl.closing_conversation_id,
      cl.closing_conversation_display_id,
      cl.closing_conversation_url,
      COUNT(*) OVER() AS total_count,
      TRIM(${UNIQUE_INSCRICAO_PERSON_KEY}) AS person_key
    FROM ${SCHEMA_NAME}.inscricoes AS i
    INNER JOIN filtered_unique_inscricoes fui ON fui.id = i.id AND fui.duplicate_rank = 1
    LEFT JOIN ${DASHBOARD_SCHEMA_NAME}.commercial_leads cl ON cl.inscricao_id = i.id
    ORDER BY ${sortColumn} ${sortDirection}, i.id ${sortDirection}
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;

  try {
    const queryResult = await getPool().query<DbRow>(query, queryValues);
    const rows: DbRow[] = queryResult.rows;

    let total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

    if (rows.length === 0) {
      const countQuery = `
        WITH filtered_unique_inscricoes AS (
          SELECT
            i.id,
            ROW_NUMBER() OVER (
              PARTITION BY ${UNIQUE_INSCRICAO_PARTITION}
              ORDER BY
                CASE WHEN LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes') THEN 1 ELSE 0 END DESC,
                CASE WHEN COALESCE(i.payload->>'_step', '') ~ '^\\d+$' THEN (i.payload->>'_step')::int ELSE 0 END DESC,
                i.criado_em DESC,
                i.id DESC
            ) AS duplicate_rank
          FROM ${SCHEMA_NAME}.inscricoes AS i
          LEFT JOIN ${DASHBOARD_SCHEMA_NAME}.commercial_leads cl ON cl.inscricao_id = i.id
          ${whereClause}
        )
        SELECT COUNT(*) AS total
        FROM filtered_unique_inscricoes
        WHERE duplicate_rank = 1
      `;
      const { rows: countRows } = await getPool().query<{ total: number | string | null }>(
        countQuery,
        filtersValues
      );
      total = countRows[0]?.total ? Number(countRows[0].total) : 0;
    }

    const primaryItems = rows.map(mapDbRowToInscricaoItem);

    // Busca em batch todos os eventos de cada pessoa e anexa como allEnrollments
    const personKeys = rows
      .map((r) => (typeof r.person_key === "string" ? r.person_key.trim() : null))
      .filter((k): k is string => k !== null && k.length > 0 && !k.startsWith("row:"));
    const enrollmentMap = await fetchEnrollmentsByPersonKeys(personKeys);

    const data: InscricaoItem[] = primaryItems.map((item) => {
      const key = item.personKey;
      if (key && enrollmentMap.has(key)) {
        return { ...item, allEnrollments: enrollmentMap.get(key) ?? null };
      }
      return item;
    });

    return {
      data,
      page,
      pageSize: pageSizeValue,
      total,
    };
  } catch (error) {
    console.error("Failed to list inscricoes", error);
    throw error;
  }
}

export async function listPresenceInscricoes(
  options: {
    treinamento?: string | null;
    apenasAprovados?: boolean;
  } = {}
): Promise<InscricaoItem[]> {
  await Promise.all([loadRecruiterCache(), ensureCommercialSchemaForReads()]);

  const conditions: string[] = [FINALIZED_INSCRICAO_CONDITION, PRESENCE_VALIDATED_CONDITION];
  const values: unknown[] = [];

  const treinamento = options.treinamento?.trim();
  if (treinamento) {
    values.push(treinamento);
    conditions.push(`${PRESENCE_TRAINING_EXPRESSION} = $${values.length}`);
  }

  if (options.apenasAprovados !== false) {
    conditions.push(PRESENCE_APPROVED_CONDITION);
  }

  const query = `
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      ${NAME_EXPRESSION} AS nome,
      ${PHONE_EXPRESSION} AS telefone,
      ${CITY_EXPRESSION} AS cidade,
      ${PROFESSION_EXPRESSION} AS profissao,
      ${TRAINING_EXPRESSION} AS treinamento,
      ${RECRUITER_EXPRESSION} AS traffic_source,
      NULL::bigint AS total_count
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE ${conditions.join(" AND ")}
    ORDER BY NULLIF(i.payload->>'presenca_validada_em', '') DESC NULLS LAST, i.criado_em DESC, i.id DESC
  `;

  try {
    const { rows } = await getPool().query<DbRow>(query, values);
    return rows.map(mapDbRowToInscricaoItem);
  } catch (error) {
    console.error("Failed to list presence inscricoes", error);
    throw error;
  }
}

export async function searchInscricoesByName(
  term: string,
  limit = 8
): Promise<InscricaoItem[]> {
  await loadRecruiterCache();
  
  const needle = term.trim();
  if (!needle) {
    return [];
  }

  const sanitized = needle.replace(/[\\%_]/g, (match) => `\\${match}`);
  const likeValue = `%${sanitized}%`;
  const digits = needle.replace(/\D+/g, "");
  const nameExpression =
    "COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), ''), NULLIF(TRIM(i.payload->>'dashboard_nome'), ''), '')";
  const phoneExpression =
    "COALESCE(NULLIF(TRIM(i.payload->>'telefone'), ''), NULLIF(TRIM(i.payload->>'phone'), ''), NULLIF(TRIM(i.payload->>'celular'), ''), NULLIF(TRIM(i.payload->>'whatsapp'), ''), NULLIF(TRIM(i.payload->>'dashboard_telefone'), ''), '')";
  const cityExpression =
    "COALESCE(NULLIF(TRIM(i.payload->>'cidade'), ''), NULLIF(TRIM(i.payload->>'city'), ''), NULLIF(TRIM(i.payload->>'dashboard_cidade'), ''), '')";
  const professionExpression =
    "COALESCE(NULLIF(TRIM(i.payload->>'profissao'), ''), NULLIF(TRIM(i.payload->>'profissao_area'), ''), NULLIF(TRIM(i.payload->>'profissaoArea'), ''), NULLIF(TRIM(i.payload->>'dashboard_profissao'), ''), NULLIF(TRIM(i.payload->>'occupation'), ''), NULLIF(TRIM(i.payload->>'job'), ''), '')";
  const trainingExpression =
    "COALESCE(NULLIF(TRIM(i.payload->>'treinamento'), ''), NULLIF(TRIM(i.payload->>'training'), ''), NULLIF(TRIM(i.payload->>'training_id'), ''), NULLIF(TRIM(i.payload->>'trainingId'), ''), NULLIF(TRIM(i.payload->>'treinamento_nome'), ''), NULLIF(TRIM(i.payload->>'treinamentoNome'), ''), NULLIF(TRIM(i.payload->>'dashboard_treinamento'), ''), '')";
  const recruiterExpression =
    "COALESCE(NULLIF(TRIM(i.payload->>'traffic_source'), ''), NULLIF(TRIM(i.payload->>'codigo_indicador'), ''), NULLIF(TRIM(i.payload->>'indicador'), ''), NULLIF(TRIM(i.payload->>'recrutadorCodigo'), ''), NULLIF(TRIM(i.payload->>'codigo_recrutador'), ''), NULLIF(TRIM(i.payload->>'dashboard_indicador_codigo'), ''), NULLIF(TRIM(i.payload->>'dashboard_indicador_nome'), ''), '')";
  const values: Array<string | number> = [likeValue];
  const searchConditions = [
    `${nameExpression} ILIKE $1 ESCAPE '\\'`,
    `${phoneExpression} ILIKE $1 ESCAPE '\\'`,
    `${recruiterExpression} ILIKE $1 ESCAPE '\\'`,
    `COALESCE(i.payload->>'dashboard_search', '') ILIKE $1 ESCAPE '\\'`,
  ];

  if (digits) {
    values.push(`%${digits}%`);
    searchConditions.push(`regexp_replace(${phoneExpression}, '[^0-9]', '', 'g') LIKE $${values.length}`);

    const numericId = Number.parseInt(digits, 10);
    if (Number.isFinite(numericId)) {
      values.push(numericId);
      searchConditions.push(`i.id = $${values.length}`);
    }
  }

  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  values.push(safeLimit);

  const query = `
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      ${nameExpression} AS nome,
      ${phoneExpression} AS telefone,
      ${cityExpression} AS cidade,
      ${professionExpression} AS profissao,
      ${trainingExpression} AS treinamento,
      ${recruiterExpression} AS traffic_source,
      NULL::bigint AS total_count
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE (${searchConditions.join(" OR ")})
    ORDER BY i.criado_em DESC
    LIMIT $${values.length}
  `;

  try {
    const { rows } = await getPool().query<DbRow>(query, values);
    return rows.map(mapDbRowToInscricaoItem);
  } catch (error) {
    console.error('Failed to search inscrições by name', error);
    return [];
  }
}

export async function getInscricaoById(id: number): Promise<InscricaoItem | null> {
  await Promise.all([loadRecruiterCache(), ensureCommercialSchemaForReads()]);
  
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Invalid inscrição id");
  }

  const query = `
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      ${NAME_EXPRESSION} AS nome,
      ${PHONE_EXPRESSION} AS telefone,
      ${CITY_EXPRESSION} AS cidade,
      ${PROFESSION_EXPRESSION} AS profissao,
      ${TRAINING_EXPRESSION} AS treinamento,
      ${RECRUITER_EXPRESSION} AS traffic_source,
      COALESCE(cl.campaign_source, ${CAMPAIGN_SOURCE_EXPRESSION}) AS campaign_source,
      COALESCE(cl.campaign_name, ${CAMPAIGN_NAME_EXPRESSION}) AS campaign_name,
      COALESCE(cl.campaign_medium, ${CAMPAIGN_MEDIUM_EXPRESSION}) AS campaign_medium,
      COALESCE(cl.campaign_term, ${CAMPAIGN_TERM_EXPRESSION}) AS campaign_term,
      COALESCE(cl.landing_page, ${LANDING_PAGE_EXPRESSION}) AS landing_page,
      cl.commercial_stage,
      cl.assigned_seller_id,
      cl.assigned_seller_email,
      cl.assigned_seller_name,
      cl.assigned_at,
      cl.first_contact_inbox_id,
      cl.first_contact_inbox_name,
      cl.closing_inbox_id,
      cl.closing_inbox_name,
      cl.closing_conversation_id,
      cl.closing_conversation_display_id,
      cl.closing_conversation_url,
      NULL::bigint AS total_count,
      TRIM(${UNIQUE_INSCRICAO_PERSON_KEY}) AS person_key
    FROM ${SCHEMA_NAME}.inscricoes AS i
    LEFT JOIN ${DASHBOARD_SCHEMA_NAME}.commercial_leads cl ON cl.inscricao_id = i.id
    WHERE i.id = $1
    LIMIT 1
  `;

  const { rows } = await getPool().query<DbRow>(query, [id]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const item = mapDbRowToInscricaoItem(row);

  // Populate allEnrollments for this person (same as listInscricoes does)
  if (item.personKey && !item.personKey.startsWith("row:")) {
    const enrollmentMap = await fetchEnrollmentsByPersonKeys([item.personKey]);
    if (enrollmentMap.has(item.personKey)) {
      item.allEnrollments = enrollmentMap.get(item.personKey) ?? null;
    }
  }

  return item;
}

export interface UpdateInscricaoInput {
  nome?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  profissao?: string | null;
  treinamento?: string | null;
  trafficSource?: string | null;
  tipo?: InscricaoTipo | null;
  codigoProprio?: string | null;
  parentInscricaoId?: number | null;
  nivel?: number | null;
  /** Atualização genérica de campos do payload. null remove o campo. */
  payloadUpdates?: Record<string, string | null>;
}

export async function updateInscricao(
  id: number,
  updates: UpdateInscricaoInput
): Promise<InscricaoItem> {
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Invalid inscrição id");
  }

  const fieldsProvided = Object.values(updates).some((value) => value !== undefined);
  if (!fieldsProvided) {
    throw new Error("Nenhum campo para atualizar");
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ payload: Record<string, unknown> | null }>(
      `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      throw new Error("Inscrição não encontrada");
    }

    const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
    const nextPayload: Record<string, unknown> = { ...payload };

    const apply = (key: string, value: string | number | boolean | null | undefined) => {
      if (value === undefined) {
        return;
      }
      if (value === null) {
        delete nextPayload[key];
      } else {
        nextPayload[key] = value;
      }
    };

    apply("nome", updates.nome);
    apply("telefone", updates.telefone);
    apply("cidade", updates.cidade);
    apply("profissao", updates.profissao);
    apply("treinamento", updates.treinamento);

    if (updates.trafficSource !== undefined) {
      apply("traffic_source", updates.trafficSource);
      apply("codigo_indicador", updates.trafficSource);
      apply("indicador", updates.trafficSource);
      apply("ref", updates.trafficSource);
      apply("referral", updates.trafficSource);
    }

    if (updates.tipo !== undefined) {
      const tipoValue = updates.tipo ?? null;
      apply("tipo", tipoValue);
      if (tipoValue === "recrutador") {
        apply("isRecruiter", true);
      } else {
        apply("isRecruiter", null);
      }
    }

    if (updates.codigoProprio !== undefined) {
      let finalCode: string | null = null;

      if (updates.codigoProprio === null) {
        finalCode = null;
      } else if (typeof updates.codigoProprio === "string") {
        const trimmed = updates.codigoProprio.trim();
        if (trimmed.length > 0) {
          finalCode = normalizeRecruiterCode(trimmed) ?? trimmed;
        } else {
          finalCode = null;
        }
      }

      apply("codigoRecrutador", finalCode);
      apply("codigo_recrutador", finalCode);
      apply("codigoProprio", finalCode);
      apply("codigo", finalCode);
      apply("codigo_indicador_proprio", finalCode);
    }

    if (updates.parentInscricaoId !== undefined) {
      apply("recrutador_id", updates.parentInscricaoId);
      apply("parent_id", updates.parentInscricaoId);
      apply("indicador_id", updates.parentInscricaoId);
      apply("sponsor_id", updates.parentInscricaoId);
    }

    if (updates.nivel !== undefined) {
      const levelValue =
        updates.nivel === null || updates.nivel === undefined
          ? null
          : Math.max(0, Math.trunc(Number(updates.nivel)));
      apply("nivel", levelValue);
      apply("level", levelValue);
      apply("hierarchy_level", levelValue);
    }

    if (updates.payloadUpdates) {
      for (const [key, value] of Object.entries(updates.payloadUpdates)) {
        if (!key.startsWith("dashboard_") && !key.startsWith("presenca_") && !key.startsWith("_")) {
          apply(key, value);
        }
      }
    }

    await client.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(nextPayload)]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await getInscricaoById(id);
  if (!updated) {
    throw new Error("Inscrição não encontrada após atualização");
  }

  return updated;
}

export async function mergeInscricoes(
  primaryId: number,
  secondaryId: number,
  mergedPayload: Record<string, unknown>
): Promise<InscricaoItem> {
  if (primaryId === secondaryId) throw new Error("Não é possível mesclar um lead consigo mesmo");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: number; payload: Record<string, unknown> }>(
      `SELECT id, payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = ANY($1) FOR UPDATE`,
      [[primaryId, secondaryId]]
    );
    if (rows.length < 2) throw new Error("Um ou mais leads não foram encontrados");

    const safePayload: Record<string, unknown> = { ...mergedPayload };
    // Garantir que campos internos do secundário não contaminem o primário
    delete safePayload["dashboard_merged_into"];

    await client.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
      [primaryId, JSON.stringify(safePayload)]
    );

    // Marcar o secundário como mesclado
    const secondaryRow = rows.find((r) => r.id === secondaryId);
    const secondaryPayload = { ...(secondaryRow?.payload ?? {}), dashboard_merged_into: String(primaryId) };
    await client.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
      [secondaryId, JSON.stringify(secondaryPayload)]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const result = await getInscricaoById(primaryId);
  if (!result) throw new Error("Lead primário não encontrado após mesclagem");
  return result;
}

interface UpdateStatusOptions {
  whatsappContacted?: boolean | null;
  note?: string | null;
  author?: string | null;
}

export async function setInscricaoStatus(
  id: number,
  status: InscricaoStatus,
  options: UpdateStatusOptions = {}
): Promise<InscricaoItem> {
  if (!STATUS_VALUES.includes(status)) {
    throw new Error("Status inválido");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: Record<string, unknown> | null }>(
      `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      throw new Error("Inscrição não encontrada");
    }

    const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
    const nextPayload: Record<string, unknown> = { ...payload };

    nextPayload["dashboard_status"] = status;
    nextPayload["dashboard_status_at"] = new Date().toISOString();

    if (options.whatsappContacted !== undefined) {
      nextPayload["dashboard_status_whatsapp"] = options.whatsappContacted;
    }

    if (options.note && options.note.trim().length > 0) {
      appendNoteToPayload(nextPayload, {
        content: options.note,
        viaWhatsapp: options.whatsappContacted ?? null,
        author: options.author ?? null,
      });
    }

    await client.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(nextPayload)]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await getInscricaoById(id);
  if (!updated) {
    throw new Error("Inscrição não encontrada após atualização");
  }

  return updated;
}

/**
 * Set the star rating (1-5) for a lead.
 * Pass `null` to clear the rating.
 */
export async function setInscricaoStars(
  id: number,
  stars: number | null,
): Promise<InscricaoItem> {
  if (stars !== null && (!Number.isInteger(stars) || stars < 1 || stars > 5)) {
    throw new Error("A avaliação deve ser um número inteiro entre 1 e 5");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: Record<string, unknown> | null }>(
      `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (rows.length === 0) {
      throw new Error("Inscrição não encontrada");
    }

    const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
    const nextPayload: Record<string, unknown> = { ...payload };
    if (stars === null) {
      delete nextPayload["dashboard_stars"];
    } else {
      nextPayload["dashboard_stars"] = stars;
    }

    await client.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(nextPayload)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await getInscricaoById(id);
  if (!updated) {
    throw new Error("Inscrição não encontrada após atualização");
  }
  return updated;
}

interface NoteOptions {
  viaWhatsapp?: boolean | null;
  author?: string | null;
}

export async function addInscricaoNote(
  id: number,
  content: string,
  options: NoteOptions = {}
): Promise<InscricaoItem> {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("A anotação não pode estar vazia");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: Record<string, unknown> | null }>(
      `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      throw new Error("Inscrição não encontrada");
    }

    const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
    const nextPayload: Record<string, unknown> = { ...payload };

    appendNoteToPayload(nextPayload, {
      content,
      viaWhatsapp: options.viaWhatsapp ?? null,
      author: options.author ?? null,
    });

    await client.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(nextPayload)]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await getInscricaoById(id);
  if (!updated) {
    throw new Error("Inscrição não encontrada após atualização");
  }

  return updated;
}

export interface CreateRecruiterInscricaoInput {
  nome: string;
  codigo: string;
  telefone?: string | null;
  cidade?: string | null;
  parentInscricaoId?: number | null;
  parentCodigo?: string | null;
  nivel?: number | null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function findInscricaoIdByOwnCode(code: string): Promise<number | null> {
  const normalized = normalizeRecruiterCode(code);
  if (!normalized) {
    return null;
  }

  const candidates = new Set<string>();
  candidates.add(normalized.toLowerCase());

  const trimmed = code.trim().toLowerCase();
  if (trimmed && !candidates.has(trimmed)) {
    candidates.add(trimmed);
  }

  const comparisons = RECRUITER_CODE_FIELDS.map(
    (field) => `LOWER(TRIM(COALESCE(i.payload->>'${field}', ''))) = ANY($1)`
  );

  const query = `
    SELECT i.id
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE ${comparisons.join(" OR ")}
    LIMIT 1
  `;

  const { rows } = await getPool().query<{ id: number }>(query, [Array.from(candidates)]);
  return rows[0]?.id ?? null;
}

export async function createRecruiterInscricao(
  input: CreateRecruiterInscricaoInput
): Promise<InscricaoItem> {
  const nome = normalizeOptionalString(input.nome);
  if (!nome) {
    throw new Error("O nome do recrutador é obrigatório");
  }

  const normalizedCode = normalizeRecruiterCode(input.codigo);
  if (!normalizedCode) {
    throw new Error("Código do recrutador inválido");
  }

  const existingId = await findInscricaoIdByOwnCode(normalizedCode);
  if (existingId) {
    throw new Error("Já existe um recrutador cadastrado com este código");
  }

  const telefone = normalizeOptionalString(input.telefone ?? null);
  const cidade = normalizeOptionalString(input.cidade ?? null);
  const parentCodigoRaw = normalizeOptionalString(input.parentCodigo ?? null);
  const parentCodigo = parentCodigoRaw
    ? normalizeRecruiterCode(parentCodigoRaw) ?? parentCodigoRaw
    : null;
  const parentId = Number.isFinite(input.parentInscricaoId ?? NaN)
    ? Math.trunc(Number(input.parentInscricaoId))
    : null;

  const nivelValue =
    input.nivel === null || input.nivel === undefined
      ? null
      : Math.max(0, Math.trunc(Number(input.nivel)));

  const payload: Record<string, unknown> = {
    nome,
    _final: true,
    tipo: "recrutador",
    isRecruiter: true,
    codigoRecrutador: normalizedCode,
    codigo_recrutador: normalizedCode,
    codigo: normalizedCode,
    codigoProprio: normalizedCode,
    codigo_indicador_proprio: normalizedCode,
  };

  if (telefone) {
    payload.telefone = telefone;
  }

  if (cidade) {
    payload.cidade = cidade;
  }

  if (parentCodigo) {
    payload.traffic_source = parentCodigo;
    payload.codigo_indicador = parentCodigo;
    payload.indicador = parentCodigo;
    payload.ref = parentCodigo;
    payload.referral = parentCodigo;
  }

  if (parentId !== null) {
    payload.recrutador_id = parentId;
    payload.parent_id = parentId;
    payload.indicador_id = parentId;
    payload.sponsor_id = parentId;
  }

  if (nivelValue !== null) {
    payload.nivel = nivelValue;
    payload.level = nivelValue;
    payload.hierarchy_level = nivelValue;
  }

  const insertQuery = `
    INSERT INTO ${SCHEMA_NAME}.inscricoes (payload)
    VALUES ($1::jsonb)
    RETURNING
      id,
      payload,
      criado_em,
      payload->>'nome' AS nome,
      payload->>'telefone' AS telefone,
      payload->>'cidade' AS cidade,
      payload->>'profissao' AS profissao,
      payload->>'treinamento' AS treinamento,
      payload->>'traffic_source' AS traffic_source,
      1::bigint AS total_count
  `;

  const { rows } = await getPool().query<DbRow>(insertQuery, [JSON.stringify(payload)]);
  const row = rows[0];
  if (!row) {
    throw new Error("Falha ao criar recrutador");
  }

  return mapDbRowToInscricaoItem(row);
}

interface InsertImportedInscricoesOptions {
  filename?: string | null;
}

export interface InsertImportedInscricoesResult {
  inserted: number;
  skipped: number;
  duplicateClientIds: string[];
  duplicatePhones: string[];
}

function normalizeImportClientId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeImportPhoneValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    value = String(Math.trunc(value));
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length >= 10) {
    return digits;
  }
  return trimmed.replace(/\s+/g, "");
}

function buildImportPayload(
  record: ImportPayload,
  options: InsertImportedInscricoesOptions
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...record };

  const trainingValue = record.data_treinamento ?? null;
  if (trainingValue) {
    for (const key of TRAINING_FIELD_KEYS) {
      if (!payload[key]) {
        payload[key] = trainingValue;
      }
    }
  }

  if (!payload["tipo"]) {
    payload["tipo"] = "lead";
  }

  const normalizedPhone = normalizeImportPhoneValue(record.telefone);
  if (normalizedPhone) {
    payload["telefone"] = normalizedPhone;
  }

  payload["importado_via_dashboard"] = true;
  payload["importado_em"] = new Date().toISOString();
  if (options.filename) {
    payload["importado_arquivo"] = options.filename;
  }

  return payload;
}

export async function insertImportedInscricoes(
  records: ImportPayload[],
  options: InsertImportedInscricoesOptions = {}
): Promise<InsertImportedInscricoesResult> {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
      duplicateClientIds: [],
      duplicatePhones: [],
    };
  }

  const clientIdCandidates = new Set<string>();
  const phoneCandidates = new Set<string>();

  for (const record of records) {
    const clientId = normalizeImportClientId(record.clientId);
    if (clientId) {
      clientIdCandidates.add(clientId);
    }
    const phone = normalizeImportPhoneValue(record.telefone);
    if (phone) {
      phoneCandidates.add(phone);
    }
  }

  const clientIdList = Array.from(clientIdCandidates);
  const phoneList = Array.from(phoneCandidates);
  const conflictClientIds = new Set<string>();
  const conflictPhones = new Set<string>();

  if (clientIdList.length || phoneList.length) {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (clientIdList.length) {
      params.push(clientIdList);
      conditions.push(`TRIM(COALESCE(i.payload->>'clientId', '')) = ANY($${params.length}::text[])`);
    }

    if (phoneList.length) {
      params.push(phoneList);
      conditions.push(
        `REGEXP_REPLACE(COALESCE(i.payload->>'telefone', ''), '\\D', '', 'g') = ANY($${params.length}::text[])`
      );
    }

    if (conditions.length) {
      const query = `
        SELECT
          TRIM(COALESCE(i.payload->>'clientId', '')) AS client_id,
          REGEXP_REPLACE(COALESCE(i.payload->>'telefone', ''), '\\D', '', 'g') AS telefone
        FROM ${SCHEMA_NAME}.inscricoes AS i
        WHERE ${conditions.join(" OR ")}
      `;

      const { rows } = await getPool().query<{ client_id: string | null; telefone: string | null }>(query, params);

      for (const row of rows) {
        const clientId = normalizeImportClientId(row.client_id);
        if (clientId) {
          conflictClientIds.add(clientId);
        }
        const phone = normalizeImportPhoneValue(row.telefone);
        if (phone) {
          conflictPhones.add(phone);
        }
      }
    }
  }

  const localClientIds = new Set<string>();
  const localPhones = new Set<string>();

  const filteredRecords = records.filter((record) => {
    const clientId = normalizeImportClientId(record.clientId);
    if (clientId) {
      if (conflictClientIds.has(clientId) || localClientIds.has(clientId)) {
        return false;
      }
      localClientIds.add(clientId);
    }
    const phone = normalizeImportPhoneValue(record.telefone);
    if (phone) {
      if (conflictPhones.has(phone) || localPhones.has(phone)) {
        return false;
      }
      localPhones.add(phone);
    }
    return true;
  });

  if (!filteredRecords.length) {
    return {
      inserted: 0,
      skipped: records.length,
      duplicateClientIds: Array.from(conflictClientIds),
      duplicatePhones: Array.from(conflictPhones),
    };
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const record of filteredRecords) {
      const payload = buildImportPayload(record, options);
      await client.query(`INSERT INTO ${SCHEMA_NAME}.inscricoes (payload) VALUES ($1::jsonb)`, [
        JSON.stringify(payload),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    inserted: filteredRecords.length,
    skipped: records.length - filteredRecords.length,
    duplicateClientIds: Array.from(conflictClientIds),
    duplicatePhones: Array.from(conflictPhones),
  };
}

export async function listTrainingFilterOptions(): Promise<TrainingOption[]> {
  const configured = listConfiguredTrainingOptions();
  const orderedOptions: TrainingOption[] = [...configured];
  const seen = new Set(orderedOptions.flatMap((option) => listTrainingOptionIds(option)));

  // Query que busca de todos os campos possíveis de treinamento
  const query = `
    SELECT
      ${TRAINING_EXPRESSION} AS treinamento,
      BOOL_OR(${UPDAY_PAYLOAD_CONDITION}) AS is_upday
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE ${FINALIZED_INSCRICAO_CONDITION}
      AND ${TRAINING_EXPRESSION} <> ''
    GROUP BY ${TRAINING_EXPRESSION}
    ORDER BY 1
  `;

  try {
    const { rows } = await getPool().query<{
      treinamento: string | null;
      is_upday: boolean | null;
    }>(query);
    const extras: TrainingOption[] = [];

    for (const row of rows) {
      const treinamentoId = row.treinamento?.trim() ?? "";
      if (!treinamentoId || isIgnoredTrainingId(treinamentoId)) {
        continue;
      }

      if (seen.has(treinamentoId)) {
        continue;
      }

      seen.add(treinamentoId);

      // Tentar formatar como data se parecer ser uma data ISO
      const formatted = formatTrainingDateLabel(treinamentoId);
      const isUpDay = Boolean(row.is_upday);
      const label = buildAutoTrainingLabel(treinamentoId, isUpDay ? "up-day-plus" : "online");
      const startsAt = !isUpDay && formatted ? treinamentoId : null;

      extras.push({
        id: treinamentoId,
        label,
        startsAt,
        kind: isUpDay ? "up-day-plus" : formatted ? "online" : undefined,
        days: isUpDay && /\be\b/.test(treinamentoId) ? 2 : 1,
      });
    }

    const allOptions = [...orderedOptions, ...extras];

    // Ordenar: 1) Por cluster (menor primeiro), 2) Alfabético pelo label
    allOptions.sort((a, b) => {
      const clusterA = a.cluster ?? 999;
      const clusterB = b.cluster ?? 999;

      // Primeiro por cluster
      if (clusterA !== clusterB) {
        return clusterA - clusterB;
      }

      // Depois alfabeticamente pelo label
      return a.label.localeCompare(b.label, "pt-BR");
    });

    return allOptions;
  } catch (error) {
    console.error("Failed to list training filter options", error);
    return orderedOptions;
  }
}

export interface TrainingSnapshotFilters {
  treinamentoId?: string | null;
}

export interface TrainingSnapshot {
  total: number;
  leads: number;
  recruiters: number;
  withIndicator: number;
  withoutIndicator: number;
  last24h: number;
}

export async function getTrainingSnapshot(
  filters: TrainingSnapshotFilters = {}
): Promise<TrainingSnapshot> {
  const params: Array<string> = [];
  const conditions: string[] = [FINALIZED_INSCRICAO_CONDITION];

  if (filters.treinamentoId) {
    params.push(filters.treinamentoId.trim());
    conditions.push(`${TRAINING_EXPRESSION} = $${params.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const typeExpression = "LOWER(COALESCE(NULLIF(TRIM(i.payload->>'tipo'), ''), 'lead'))";
  const indicatorExpression = RECRUITER_EXPRESSION;

  const query = `
    WITH unique_inscricoes AS (
      SELECT *
      FROM (
        SELECT
          i.*,
          ROW_NUMBER() OVER (
            PARTITION BY ${UNIQUE_INSCRICAO_PARTITION}
            ORDER BY
              CASE WHEN LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes') THEN 1 ELSE 0 END DESC,
              CASE WHEN COALESCE(i.payload->>'_step', '') ~ '^\\d+$' THEN (i.payload->>'_step')::int ELSE 0 END DESC,
              i.criado_em DESC,
              i.id DESC
          ) AS duplicate_rank
        FROM ${SCHEMA_NAME}.inscricoes AS i
        ${whereClause}
      ) ranked
      WHERE duplicate_rank = 1
    )
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE ${typeExpression} = 'recrutador')::bigint AS recruiters,
      COUNT(*) FILTER (WHERE ${typeExpression} <> 'recrutador')::bigint AS leads,
      COUNT(*) FILTER (WHERE ${indicatorExpression} IS NOT NULL)::bigint AS with_indicator,
      COUNT(*) FILTER (WHERE ${indicatorExpression} IS NULL)::bigint AS without_indicator,
      COUNT(*) FILTER (WHERE i.criado_em >= NOW() - INTERVAL '24 hours')::bigint AS last_24h
    FROM unique_inscricoes AS i
  `;

  try {
    const { rows } = await getPool().query<{
      total: string;
      recruiters: string;
      leads: string;
      with_indicator: string;
      without_indicator: string;
      last_24h: string;
    }>(query, params);

    const row = rows[0];
    if (!row) {
      return {
        total: 0,
        leads: 0,
        recruiters: 0,
        withIndicator: 0,
        withoutIndicator: 0,
        last24h: 0,
      };
    }

    return {
      total: Number(row.total) || 0,
      leads: Number(row.leads) || 0,
      recruiters: Number(row.recruiters) || 0,
      withIndicator: Number(row.with_indicator) || 0,
      withoutIndicator: Number(row.without_indicator) || 0,
      last24h: Number(row.last_24h) || 0,
    };
  } catch (error) {
    console.error('Failed to compute training snapshot', error);
    return {
      total: 0,
      leads: 0,
      recruiters: 0,
      withIndicator: 0,
      withoutIndicator: 0,
      last24h: 0,
    };
  }
}

export async function deleteInscricao(id: number): Promise<void> {
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Invalid inscrição id");
  }

  const query = `
    DELETE FROM ${SCHEMA_NAME}.inscricoes
    WHERE id = $1
    RETURNING id
  `;

  const { rowCount } = await getPool().query(query, [id]);
  if (!rowCount) {
    throw new Error("Inscrição não encontrada");
  }
}

export async function listAllInscricoes(batchSize = 200): Promise<InscricaoItem[]> {
  const pageSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(Math.trunc(batchSize), 500) : 200;
  const firstPage = await listInscricoes({ page: 1, pageSize });
  const items: InscricaoItem[] = [...firstPage.data];

  const totalPages = Math.max(1, Math.ceil(firstPage.total / pageSize));
  if (totalPages === 1) {
    return items;
  }

  for (let page = 2; page <= totalPages; page += 1) {
    const chunk = await listInscricoes({ page, pageSize });
    items.push(...chunk.data);
  }

  return items;
}

export interface ListDuplicateSuspectsOptions {
  windowDays?: number;
  maxGroups?: number;
  sampleSize?: number;
}

/**
 * Obtém um resumo rápido da contagem de duplicados para exibir na dashboard.
 * Usa a mesma lógica de `listDuplicateSuspects`, mas retorna apenas a contagem.
 */
export async function getDuplicateSummaryCount(
  options: { windowDays?: number } = {}
): Promise<{ totalGroups: number; topReasons: Array<{ reason: DuplicateReason; count: number }> }> {
  try {
    const summary = await listDuplicateSuspects({
      windowDays: options.windowDays ?? 30,
      maxGroups: 50,
      sampleSize: 500,
    });

    const reasonCounts = new Map<DuplicateReason, number>();
    for (const group of summary.groups) {
      for (const detail of group.reasons) {
        reasonCounts.set(detail.reason, (reasonCounts.get(detail.reason) ?? 0) + 1);
      }
    }

    const topReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      totalGroups: summary.totalGroups,
      topReasons,
    };
  } catch (error) {
    console.error("Erro ao buscar resumo de duplicados:", error);
    return { totalGroups: 0, topReasons: [] };
  }
}

interface DuplicateEntry {
  item: InscricaoItem;
  createdDay: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  payloadHash: string | null;
  quality: ReturnType<typeof analyzeInscricaoQuality>;
}

export async function listInscricoesByIds(ids: number[]): Promise<InscricaoItem[]> {
  const normalizedIds = Array.from(
    new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.trunc(id))
    )
  ).slice(0, 100);

  if (normalizedIds.length === 0) {
    return [];
  }

  await Promise.all([loadRecruiterCache(), ensureCommercialSchemaForReads()]);

  const query = `
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      ${NAME_EXPRESSION} AS nome,
      ${PHONE_EXPRESSION} AS telefone,
      ${CITY_EXPRESSION} AS cidade,
      ${PROFESSION_EXPRESSION} AS profissao,
      ${TRAINING_EXPRESSION} AS treinamento,
      ${RECRUITER_EXPRESSION} AS traffic_source,
      COALESCE(cl.campaign_source, ${CAMPAIGN_SOURCE_EXPRESSION}) AS campaign_source,
      COALESCE(cl.campaign_name, ${CAMPAIGN_NAME_EXPRESSION}) AS campaign_name,
      COALESCE(cl.campaign_medium, ${CAMPAIGN_MEDIUM_EXPRESSION}) AS campaign_medium,
      COALESCE(cl.campaign_term, ${CAMPAIGN_TERM_EXPRESSION}) AS campaign_term,
      COALESCE(cl.landing_page, ${LANDING_PAGE_EXPRESSION}) AS landing_page,
      cl.commercial_stage,
      cl.assigned_seller_id,
      cl.assigned_seller_email,
      cl.assigned_seller_name,
      cl.assigned_at,
      cl.first_contact_inbox_id,
      cl.first_contact_inbox_name,
      cl.closing_inbox_id,
      cl.closing_inbox_name,
      cl.closing_conversation_id,
      cl.closing_conversation_display_id,
      cl.closing_conversation_url,
      NULL::bigint AS total_count
    FROM ${SCHEMA_NAME}.inscricoes AS i
    LEFT JOIN ${DASHBOARD_SCHEMA_NAME}.commercial_leads cl ON cl.inscricao_id = i.id
    WHERE i.id = ANY($1::int[])
    ORDER BY array_position($1::int[], i.id)
  `;

  try {
    const { rows } = await getPool().query<DbRow>(query, [normalizedIds]);
    return rows.map(mapDbRowToInscricaoItem);
  } catch (error) {
    console.error("Failed to list inscricoes by ids", error);
    throw error;
  }
}

export async function listDuplicateSuspects(
  options: ListDuplicateSuspectsOptions = {}
): Promise<DuplicateSummary> {
  const windowDays = Math.max(1, Math.trunc(options.windowDays ?? 30));
  const maxGroups = Math.max(1, Math.min(50, Math.trunc(options.maxGroups ?? 8)));
  const sampleSize = Math.max(200, Math.min(2000, Math.trunc(options.sampleSize ?? maxGroups * 40)));

  const { rows } = await getPool().query<DuplicateDbRow>(
    `
      SELECT
        i.id,
        i.payload,
        i.criado_em,
        ${NAME_EXPRESSION} AS nome,
        ${PHONE_EXPRESSION} AS telefone,
        ${CITY_EXPRESSION} AS cidade,
        ${PROFESSION_EXPRESSION} AS profissao,
        ${TRAINING_EXPRESSION} AS treinamento,
        ${RECRUITER_EXPRESSION} AS traffic_source,
        NULL::bigint AS total_count,
        REGEXP_REPLACE(${PHONE_EXPRESSION}, '\\D', '', 'g') AS telefone_normalizado,
        LOWER(TRIM(${EMAIL_EXPRESSION})) AS email_normalizado,
        LOWER(TRIM(${NAME_EXPRESSION})) AS nome_normalizado,
        DATE_TRUNC('day', i.criado_em) AS criado_dia,
        MD5(CAST(i.payload AS TEXT)) AS payload_hash
      FROM ${SCHEMA_NAME}.inscricoes AS i
      WHERE ${FINALIZED_INSCRICAO_CONDITION}
        AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''
        AND i.criado_em >= NOW() - ($1::text || ' days')::interval
      ORDER BY i.criado_em DESC
      LIMIT $2
    `,
    [String(windowDays), sampleSize]
  );

  if (!rows.length) {
    return { groups: [], totalGroups: 0 };
  }

  const entries: DuplicateEntry[] = rows.map((row) => {
    const item = mapDbRowToInscricaoItem(row);
    const createdDay =
      row.criado_dia instanceof Date
        ? row.criado_dia.toISOString().slice(0, 10)
        : typeof row.criado_dia === "string"
        ? row.criado_dia.slice(0, 10)
        : null;

    const normalizeValue = (value: string | null | undefined): string | null => {
      if (!value) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    return {
      item,
      createdDay,
      phone: normalizeValue(row.telefone_normalizado),
      email: normalizeValue(row.email_normalizado),
      name: normalizeValue(row.nome_normalizado),
      payloadHash: normalizeValue(row.payload_hash),
      quality: analyzeInscricaoQuality(item),
    };
  });

  // Build a set of dismissed pairs from payload
  const dismissedPairs = new Set<string>();
  for (const entry of entries) {
    const raw = entry.item.payload as Record<string, unknown> | undefined;
    const dismissed = raw?.["dashboard_not_duplicate"];
    if (Array.isArray(dismissed)) {
      for (const otherId of dismissed) {
        // Store as "min-max" key for symmetric lookup
        const a = Math.min(entry.item.id, Number(otherId));
        const b = Math.max(entry.item.id, Number(otherId));
        dismissedPairs.add(`${a}-${b}`);
      }
    }
  }

  function isDismissedPair(idA: number, idB: number): boolean {
    const a = Math.min(idA, idB);
    const b = Math.max(idA, idB);
    return dismissedPairs.has(`${a}-${b}`);
  }

  const parent = new Map<number, number>();
  const rank = new Map<number, number>();

  const find = (id: number): number => {
    const currentParent = parent.get(id) ?? id;
    if (currentParent !== id) {
      const root = find(currentParent);
      parent.set(id, root);
      return root;
    }
    return currentParent;
  };

  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      return;
    }
    const rankA = rank.get(rootA) ?? 0;
    const rankB = rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  };

  for (const entry of entries) {
    parent.set(entry.item.id, entry.item.id);
    rank.set(entry.item.id, 0);
  }

  const bucketReasons: Array<{
    entries: DuplicateEntry[];
    reason: DuplicateReason;
    matchValue: string;
    hint?: string | null;
  }> = [];

  const addToMap = (map: Map<string, DuplicateEntry[]>, key: string, entry: DuplicateEntry) => {
    const current = map.get(key);
    if (current) {
      current.push(entry);
    } else {
      map.set(key, [entry]);
    }
  };

  const phoneMap = new Map<string, DuplicateEntry[]>();
  const emailMap = new Map<string, DuplicateEntry[]>();
  const nameDayMap = new Map<string, DuplicateEntry[]>();
  const nameWindowMap = new Map<string, DuplicateEntry[]>();
  const payloadMap = new Map<string, DuplicateEntry[]>();

  for (const entry of entries) {
    if (entry.phone && entry.phone.length >= 8) {
      addToMap(phoneMap, entry.phone, entry);
    }
    if (entry.email) {
      addToMap(emailMap, entry.email, entry);
    }
    if (entry.name && entry.createdDay) {
      addToMap(nameDayMap, `${entry.name}|${entry.createdDay}`, entry);
    }
    if (entry.name && entry.name.split(" ").length >= 2) {
      addToMap(nameWindowMap, entry.name, entry);
    }
    if (entry.payloadHash) {
      addToMap(payloadMap, entry.payloadHash, entry);
    }
  }

  const registerBuckets = (
    source: Map<string, DuplicateEntry[]>,
    reason: DuplicateReason,
    formatter: (key: string, bucket: DuplicateEntry[]) => { matchValue: string; hint?: string | null }
  ) => {
    for (const [key, bucket] of source.entries()) {
      if (bucket.length < 2) {
        continue;
      }
      // Filter out entries that are mutually dismissed with ALL others in bucket
      const filteredBucket = bucket.filter((entry) => {
        const others = bucket.filter((o) => o.item.id !== entry.item.id);
        // Keep entry if at least one pair is NOT dismissed
        return others.some((o) => !isDismissedPair(entry.item.id, o.item.id));
      });
      if (filteredBucket.length < 2) {
        continue;
      }
      const sortedBucket = filteredBucket
        .slice()
        .sort((a, b) => b.item.criadoEm.localeCompare(a.item.criadoEm));
      const { matchValue, hint } = formatter(key, sortedBucket);
      bucketReasons.push({
        entries: sortedBucket,
        reason,
        matchValue,
        hint: hint ?? null,
      });

      const [first, ...rest] = sortedBucket;
      for (const other of rest) {
        if (!isDismissedPair(first.item.id, other.item.id)) {
          union(first.item.id, other.item.id);
        }
      }
    }
  };

  registerBuckets(phoneMap, "telefone", (key) => ({
    matchValue: formatNormalizedPhone(key),
    hint: key,
  }));

  registerBuckets(emailMap, "email", (key) => ({
    matchValue: key,
  }));

  registerBuckets(nameDayMap, "nome-dia", (key, bucket) => {
    const [name, day] = key.split("|");
    const displayName = bucket.find((entry) => entry.item.nome)?.item.nome ?? name ?? "Nome semelhante";
    const formattedDay = formatDateLabelPtBR(day ?? null);
    return {
      matchValue: `${displayName} em ${formattedDay || day || "data semelhante"}`,
      hint: day ?? null,
    };
  });

  registerBuckets(payloadMap, "payload", (key) => ({
    matchValue: `Payload repetido (${key.slice(0, 8)})`,
    hint: key,
  }));

  // Mesmo nome completo (≥2 palavras) dentro da janela, com telefones distintos
  for (const [name, bucket] of nameWindowMap.entries()) {
    if (bucket.length < 2) continue;
    // Só processar pares que já não foram unidos por telefone/email
    const newPairs: [DuplicateEntry, DuplicateEntry][] = [];
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (find(a.item.id) !== find(b.item.id) && !isDismissedPair(a.item.id, b.item.id)) {
          newPairs.push([a, b]);
        }
      }
    }
    if (newPairs.length === 0) continue;
    const allInvolved = [...new Set(newPairs.flatMap(([a, b]) => [a, b]))];
    const sorted = allInvolved.slice().sort((a, b) => b.item.criadoEm.localeCompare(a.item.criadoEm));
    const displayName = sorted.find((e) => e.item.nome)?.item.nome ?? name;
    bucketReasons.push({
      entries: sorted,
      reason: "nome-dia",
      matchValue: `${displayName} (mesmo nome, telefones diferentes)`,
      hint: sorted.map((e) => e.phone ?? "—").join(" vs "),
    });
    const [first, ...rest] = sorted;
    for (const other of rest) {
      if (!isDismissedPair(first!.item.id, other.item.id)) {
        union(first!.item.id, other.item.id);
      }
    }
  }

  for (const entry of entries) {
    if (!entry.quality.isGhostCandidate || hasQualityDismissed(entry.item)) {
      continue;
    }

    const primaryIssue = entry.quality.issues[0];
    bucketReasons.push({
      entries: [entry],
      reason: primaryIssue ? issueCodeToDuplicateReason(primaryIssue.code) : "fantasma",
      matchValue: entry.quality.primaryLabel ?? "Possivel inscricao fantasma",
      hint: entry.quality.issues.map((issue) => issue.label).join(" | ") || null,
    });
  }

  const groupMap = new Map<number, { entries: Set<InscricaoItem>; reasons: DuplicateReasonDetail[]; latest: string }>();

  for (const entry of entries) {
    const root = find(entry.item.id);
    if (!groupMap.has(root)) {
      groupMap.set(root, {
        entries: new Set<InscricaoItem>(),
        reasons: [],
        latest: entry.item.criadoEm,
      });
    }
    const bucket = groupMap.get(root)!;
    bucket.entries.add(entry.item);
    if (entry.item.criadoEm > bucket.latest) {
      bucket.latest = entry.item.criadoEm;
    }
  }

  for (const reasonBucket of bucketReasons) {
    const root = find(reasonBucket.entries[0]?.item.id ?? 0);
    const group = groupMap.get(root);
    if (!group) {
      continue;
    }
    const alreadyExists = group.reasons.some(
      (detail) =>
        detail.reason === reasonBucket.reason &&
        detail.matchValue === reasonBucket.matchValue &&
        detail.hint === reasonBucket.hint
    );
    if (!alreadyExists) {
      group.reasons.push({
        reason: reasonBucket.reason,
        matchValue: reasonBucket.matchValue,
        hint: reasonBucket.hint ?? null,
      });
    }
  }

  const qualityReasons = new Set<DuplicateReason>([
    "fantasma",
    "nome-suspeito",
    "telefone-invalido",
    "email-suspeito",
    "dados-incompletos",
    "payload-teste",
    "treinamento-ausente",
  ]);

  const groups: DuplicateGroup[] = Array.from(groupMap.entries())
    .map(([root, data]) => {
      const sortedEntries = Array.from(data.entries).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
      return {
        id: `group:${root}`,
        entries: sortedEntries,
        reasons: data.reasons,
        score: sortedEntries.length + data.reasons.length,
        latestCreatedAt: sortedEntries[0]?.criadoEm ?? data.latest,
      };
    })
    .filter((group) => group.entries.length > 1 || group.reasons.some((detail) => qualityReasons.has(detail.reason)))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
    });

  return {
    groups: groups.slice(0, maxGroups),
    totalGroups: groups.length,
  };
}

export interface DashboardStats {
  totalLeads: number;
  newLeadsToday: number;
  conversionRate: number;
  graduados: number;
  growthData: { name: string; leads: number; recruits: number }[];
  distributionData: { name: string; value: number }[];
  topRecruiters: { name: string; recruits: number }[];
}

export interface CommercialStageDashboardStat {
  key: CommercialStage;
  label: string;
  count: number;
  percentage: number;
}

export interface CommercialCampaignDashboardStat {
  source: string;
  name: string | null;
  leads: number;
  won: number;
  hot: number;
}

export interface CommercialSellerDashboardStat {
  name: string;
  email: string | null;
  active: number;
  closing: number;
  won: number;
}

export interface CommercialDashboardStats {
  totalLeads: number;
  newLeadsToday: number;
  activeLeads: number;
  unassignedLeads: number;
  staleLeads: number;
  hotLeads: number;
  assignedToday: number;
  closingLeads: number;
  wonLeads: number;
  lostLeads: number;
  noShowLeads: number;
  winRate: number;
  stageSummary: CommercialStageDashboardStat[];
  topCampaigns: CommercialCampaignDashboardStat[];
  sellerWorkload: CommercialSellerDashboardStat[];
}

interface CommercialDashboardOptions {
  treinamentoId?: string;
}

export interface TrainingWithStats {
  id: string;
  label: string;
  startsAt: string | null;
  days: number;
  totalInscritos: number;
  leads: number;
  recrutadores: number;
  presentes: number;
  last24h: number;
}

function buildCommercialDashboardBaseQuery(trainingCondition: string): string {
  return `
    WITH unique_inscricoes AS (
      SELECT *
      FROM (
        SELECT
          i.id,
          i.payload,
          i.criado_em,
          COALESCE(cl.commercial_stage, 'novo') AS commercial_stage,
          cl.assigned_seller_id,
          cl.assigned_seller_email,
          cl.assigned_seller_name,
          cl.assigned_at,
          cl.updated_at,
          COALESCE(cl.campaign_source, ${CAMPAIGN_SOURCE_EXPRESSION}) AS campaign_source,
          COALESCE(cl.campaign_name, ${CAMPAIGN_NAME_EXPRESSION}) AS campaign_name,
          ROW_NUMBER() OVER (
            PARTITION BY ${UNIQUE_INSCRICAO_PARTITION}
            ORDER BY
              CASE WHEN LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes') THEN 1 ELSE 0 END DESC,
              CASE WHEN COALESCE(i.payload->>'_step', '') ~ '^\\d+$' THEN (i.payload->>'_step')::int ELSE 0 END DESC,
              i.criado_em DESC,
              i.id DESC
          ) AS duplicate_rank
        FROM ${SCHEMA_NAME}.inscricoes AS i
        LEFT JOIN ${DASHBOARD_SCHEMA_NAME}.commercial_leads cl ON cl.inscricao_id = i.id
        WHERE ${FINALIZED_INSCRICAO_CONDITION}
          ${trainingCondition}
      ) ranked
      WHERE duplicate_rank = 1
    )
  `;
}

function dashboardNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

export async function getCommercialDashboardStats(
  options: CommercialDashboardOptions = {}
): Promise<CommercialDashboardStats> {
  await ensureCommercialSchemaForReads();

  const treinamentoId = options.treinamentoId?.trim() ?? "";
  const queryValues = treinamentoId ? [treinamentoId] : [];
  const trainingCondition = treinamentoId ? `AND ${TRAINING_EXPRESSION} = $1` : "";
  const baseQuery = buildCommercialDashboardBaseQuery(trainingCondition);

  const [summaryRes, stageRes, campaignRes, sellerRes] = await Promise.all([
    getPool().query<{
      total_leads: string;
      new_leads_today: string;
      active_leads: string;
      unassigned_leads: string;
      stale_leads: string;
      hot_leads: string;
      assigned_today: string;
      closing_leads: string;
      won_leads: string;
      lost_leads: string;
      no_show_leads: string;
    }>(
      `
        ${baseQuery}
        SELECT
          COUNT(*)::bigint AS total_leads,
          COUNT(*) FILTER (WHERE criado_em >= CURRENT_DATE)::bigint AS new_leads_today,
          COUNT(*) FILTER (WHERE commercial_stage NOT IN ('ganho', 'perdido'))::bigint AS active_leads,
          COUNT(*) FILTER (
            WHERE commercial_stage NOT IN ('ganho', 'perdido')
              AND assigned_seller_id IS NULL
              AND COALESCE(TRIM(assigned_seller_email), '') = ''
          )::bigint AS unassigned_leads,
          COUNT(*) FILTER (
            WHERE commercial_stage NOT IN ('ganho', 'perdido')
              AND COALESCE(updated_at, assigned_at, criado_em) < NOW() - INTERVAL '48 hours'
          )::bigint AS stale_leads,
          COUNT(*) FILTER (
            WHERE COALESCE(payload->>'dashboard_stars', '') = '5'
          )::bigint AS hot_leads,
          COUNT(*) FILTER (WHERE assigned_at >= CURRENT_DATE)::bigint AS assigned_today,
          COUNT(*) FILTER (WHERE commercial_stage = 'fechamento')::bigint AS closing_leads,
          COUNT(*) FILTER (WHERE commercial_stage = 'ganho')::bigint AS won_leads,
          COUNT(*) FILTER (WHERE commercial_stage = 'perdido')::bigint AS lost_leads,
          COUNT(*) FILTER (WHERE commercial_stage = 'no_show')::bigint AS no_show_leads
        FROM unique_inscricoes
      `,
      queryValues
    ),
    getPool().query<{ commercial_stage: string; count: string }>(
      `
        ${baseQuery}
        SELECT commercial_stage, COUNT(*)::bigint AS count
        FROM unique_inscricoes
        GROUP BY commercial_stage
      `,
      queryValues
    ),
    getPool().query<{
      campaign_source: string | null;
      campaign_name: string | null;
      leads: string;
      won: string;
      hot: string;
    }>(
      `
        ${baseQuery}
        SELECT
          NULLIF(TRIM(COALESCE(campaign_source, '')), '') AS campaign_source,
          NULLIF(TRIM(COALESCE(campaign_name, '')), '') AS campaign_name,
          COUNT(*)::bigint AS leads,
          COUNT(*) FILTER (WHERE commercial_stage = 'ganho')::bigint AS won,
          COUNT(*) FILTER (WHERE COALESCE(payload->>'dashboard_stars', '') = '5')::bigint AS hot
        FROM unique_inscricoes
        GROUP BY 1, 2
        ORDER BY COUNT(*) DESC
        LIMIT 6
      `,
      queryValues
    ),
    getPool().query<{
      seller_name: string | null;
      seller_email: string | null;
      active: string;
      closing: string;
      won: string;
    }>(
      `
        ${baseQuery}
        SELECT
          NULLIF(TRIM(COALESCE(assigned_seller_name, '')), '') AS seller_name,
          NULLIF(TRIM(COALESCE(assigned_seller_email, '')), '') AS seller_email,
          COUNT(*) FILTER (WHERE commercial_stage NOT IN ('ganho', 'perdido'))::bigint AS active,
          COUNT(*) FILTER (WHERE commercial_stage = 'fechamento')::bigint AS closing,
          COUNT(*) FILTER (WHERE commercial_stage = 'ganho')::bigint AS won
        FROM unique_inscricoes
        GROUP BY 1, 2
        ORDER BY
          COUNT(*) FILTER (WHERE commercial_stage NOT IN ('ganho', 'perdido')) DESC,
          COUNT(*) FILTER (WHERE commercial_stage = 'ganho') DESC
        LIMIT 6
      `,
      queryValues
    ),
  ]);

  const summary = summaryRes.rows[0];
  const totalLeads = dashboardNumber(summary?.total_leads);
  const wonLeads = dashboardNumber(summary?.won_leads);
  const lostLeads = dashboardNumber(summary?.lost_leads);
  const decidedLeads = wonLeads + lostLeads;
  const stageCounts = new Map<CommercialStage, number>(
    stageRes.rows.map((row): [CommercialStage, number] => [
      normalizeCommercialStage(row.commercial_stage),
      dashboardNumber(row.count),
    ])
  );

  return {
    totalLeads,
    newLeadsToday: dashboardNumber(summary?.new_leads_today),
    activeLeads: dashboardNumber(summary?.active_leads),
    unassignedLeads: dashboardNumber(summary?.unassigned_leads),
    staleLeads: dashboardNumber(summary?.stale_leads),
    hotLeads: dashboardNumber(summary?.hot_leads),
    assignedToday: dashboardNumber(summary?.assigned_today),
    closingLeads: dashboardNumber(summary?.closing_leads),
    wonLeads,
    lostLeads,
    noShowLeads: dashboardNumber(summary?.no_show_leads),
    winRate: decidedLeads > 0 ? Math.round((wonLeads / decidedLeads) * 1000) / 10 : 0,
    stageSummary: COMMERCIAL_STAGE_VALUES.map((key) => {
      const count = stageCounts.get(key) ?? 0;
      return {
        key,
        label: COMMERCIAL_STAGE_LABELS[key],
        count,
        percentage: totalLeads > 0 ? Math.round((count / totalLeads) * 1000) / 10 : 0,
      };
    }),
    topCampaigns: campaignRes.rows.map((row) => ({
      source: row.campaign_source || "Sem campanha",
      name: row.campaign_name || null,
      leads: dashboardNumber(row.leads),
      won: dashboardNumber(row.won),
      hot: dashboardNumber(row.hot),
    })),
    sellerWorkload: sellerRes.rows.map((row) => ({
      name: row.seller_name || row.seller_email || "Sem vendedor",
      email: row.seller_email || null,
      active: dashboardNumber(row.active),
      closing: dashboardNumber(row.closing),
      won: dashboardNumber(row.won),
    })),
  };
}

export async function listTrainingsWithStats(): Promise<TrainingWithStats[]> {
  const pool = getPool();

  // Expressão para extrair treinamento de múltiplos campos possíveis
  const treinamentoExpr = `COALESCE(NULLIF(${TRAINING_EXPRESSION}, ''), 'Sem Treinamento')`;

  const query = `
    WITH base AS (
      SELECT
        i.*,
        TRIM(${UNIQUE_INSCRICAO_PARTITION}) AS person_key,
        ${treinamentoExpr} AS treinamento_id,
        ROW_NUMBER() OVER (
          PARTITION BY TRIM(${UNIQUE_INSCRICAO_PARTITION}), ${treinamentoExpr}
          ORDER BY
            CASE WHEN LOWER(TRIM(COALESCE(i.payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes') THEN 1 ELSE 0 END DESC,
            CASE WHEN COALESCE(i.payload->>'_step', '') ~ '^\\d+$' THEN (i.payload->>'_step')::int ELSE 0 END DESC,
            i.criado_em DESC,
            i.id DESC
        ) AS rn
      FROM ${SCHEMA_NAME}.inscricoes AS i
      WHERE ${FINALIZED_INSCRICAO_CONDITION}
        AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''
    ),
    unique_per_training AS (
      SELECT * FROM base WHERE rn = 1
    )
    SELECT
      treinamento_id,
      BOOL_OR(${UPDAY_PAYLOAD_CONDITION}) AS is_upday,
      COUNT(DISTINCT person_key)::bigint AS total_inscritos,
      COUNT(DISTINCT person_key) FILTER (WHERE LOWER(COALESCE(NULLIF(TRIM(i.payload->>'tipo'), ''), 'lead')) = 'recrutador')::bigint AS recrutadores,
      COUNT(DISTINCT person_key) FILTER (WHERE LOWER(COALESCE(NULLIF(TRIM(i.payload->>'tipo'), ''), 'lead')) <> 'recrutador')::bigint AS leads,
      COUNT(DISTINCT person_key) FILTER (WHERE i.payload->>'presenca_validada' = 'true')::bigint AS presentes,
      COUNT(DISTINCT person_key) FILTER (WHERE i.criado_em >= NOW() - INTERVAL '24 hours')::bigint AS last_24h,
      MIN(i.criado_em) AS first_inscrito,
      MAX(i.criado_em) AS last_inscrito
    FROM unique_per_training AS i
    GROUP BY treinamento_id
    ORDER BY MAX(i.criado_em) DESC
  `;

  try {
    const { rows } = await pool.query<{
      treinamento_id: string;
      is_upday: boolean | null;
      total_inscritos: string;
      recrutadores: string;
      leads: string;
      presentes: string;
      last_24h: string;
      first_inscrito: Date | string | null;
      last_inscrito: Date | string | null;
    }>(query);

    return rows
      .filter((row) => {
        const id = (row.treinamento_id || "").trim();
        return id !== "" && id !== "Sem Treinamento" && !isIgnoredTrainingId(id);
      })
      .map((row) => {
      const treinamentoId = row.treinamento_id || "Sem Treinamento";
      const trainingInfo = getTrainingById(treinamentoId);
      const isUpDay = Boolean(row.is_upday || trainingInfo?.kind === "up-day-plus");
      
      // Tentar formatar como data se o ID parecer uma data
      let label = trainingInfo?.label ?? buildAutoTrainingLabel(treinamentoId, isUpDay ? "up-day-plus" : "online");
      let startsAt = trainingInfo?.startsAt ?? null;
      
      // Se o label ainda for igual ao ID e parece ser uma data ISO, formatar com prefixo
      if (label === treinamentoId && treinamentoId !== "Sem Treinamento") {
        label = buildAutoTrainingLabel(treinamentoId, isUpDay ? "up-day-plus" : "online");
        const formatted = formatTrainingDateLabel(treinamentoId);
        if (formatted && !isUpDay) {
          startsAt = treinamentoId;
        }
      }
      
      return {
        id: treinamentoId,
        label,
        startsAt,
        days: trainingInfo?.days ?? (isUpDay && /\be\b/.test(treinamentoId) ? 2 : 1),
        totalInscritos: Number(row.total_inscritos) || 0,
        leads: Number(row.leads) || 0,
        recrutadores: Number(row.recrutadores) || 0,
        presentes: Number(row.presentes) || 0,
        last24h: Number(row.last_24h) || 0,
      };
    });
  } catch (error) {
    console.error("Failed to list trainings with stats", error);
    return [];
  }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const pool = getPool();

  // Carregar cache de recrutadores do banco
  await loadRecruiterCache();

  const [countsRes, growthRes, topRecruitersRes] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::bigint AS total_leads,
        COUNT(*) FILTER (WHERE criado_em >= CURRENT_DATE)::bigint AS new_leads_today,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(NULLIF(TRIM(i.payload->>'tipo'), ''), 'lead')) = 'recrutador'
        )::bigint AS recruiters,
        COUNT(*) FILTER (WHERE ${PRESENCE_APPROVED_CONDITION})::bigint AS graduados
      FROM ${SCHEMA_NAME}.inscricoes i
      WHERE ${FINALIZED_INSCRICAO_CONDITION}
    `),
    pool.query(`
      SELECT
        TO_CHAR(criado_em, 'Mon') as name,
        EXTRACT(MONTH FROM criado_em) as month_num,
        COUNT(*) as leads,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(NULLIF(TRIM(i.payload->>'tipo'), ''), 'lead')) = 'recrutador'
        ) as recruits
      FROM ${SCHEMA_NAME}.inscricoes i
      WHERE ${FINALIZED_INSCRICAO_CONDITION}
        AND criado_em >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY 1, 2
      ORDER BY 2
    `),
    pool.query(`
      SELECT
        TRIM(COALESCE(
          NULLIF(TRIM(payload->>'traffic_source'), ''),
          NULLIF(TRIM(payload->>'source'), ''),
          NULLIF(TRIM(payload->>'recrutador'), ''),
          NULLIF(TRIM(payload->>'recrutador_codigo'), '')
        )) as code,
        COUNT(*) as recruits
      FROM ${SCHEMA_NAME}.inscricoes i
      WHERE ${FINALIZED_INSCRICAO_CONDITION}
        AND TRIM(COALESCE(
          NULLIF(TRIM(payload->>'traffic_source'), ''),
          NULLIF(TRIM(payload->>'source'), ''),
          NULLIF(TRIM(payload->>'recrutador'), ''),
          NULLIF(TRIM(payload->>'recrutador_codigo'), '')
        )) IS NOT NULL
        AND TRIM(COALESCE(
          NULLIF(TRIM(payload->>'traffic_source'), ''),
          NULLIF(TRIM(payload->>'source'), ''),
          NULLIF(TRIM(payload->>'recrutador'), ''),
          NULLIF(TRIM(payload->>'recrutador_codigo'), '')
        )) != ''
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `),
  ]);

  const totalLeads = parseInt(countsRes.rows[0]?.total_leads ?? "0", 10);
  const newLeadsToday = parseInt(countsRes.rows[0]?.new_leads_today ?? "0", 10);
  const recruitersTotal = parseInt(countsRes.rows[0]?.recruiters ?? "0", 10);
  const graduados = parseInt(countsRes.rows[0]?.graduados ?? "0", 10);

  const growthData = growthRes.rows.map(row => ({
    name: row.name,
    leads: parseInt(row.leads, 10),
    recruits: parseInt(row.recruits, 10) || 0
  }));

  const topRecruiters = topRecruitersRes.rows.map(row => {
    // Prioridade: banco de dados > lista estática (sem placeholders)
    const recruiterDb = getRecruiterFromCache(row.code);
    const recruiterStatic = getRecruiterByCodeIfNamed(row.code);
    const name = recruiterDb?.name ?? recruiterStatic?.name ?? `Código ${row.code}`;
    return {
      name,
      recruits: parseInt(row.recruits, 10)
    };
  });

  const distributionData = [
    { name: "Leads", value: Math.max(totalLeads - recruitersTotal, 0) },
    { name: "Recrutadores", value: recruitersTotal },
    { name: "Graduados", value: graduados },
  ];

  return {
    totalLeads,
    newLeadsToday,
    conversionRate: totalLeads > 0 ? Math.round((graduados / totalLeads) * 1000) / 10 : 0,
    graduados,
    growthData,
    distributionData,
    topRecruiters
  };
}

/**
 * Busca uma inscrição pelo código próprio do recrutador.
 * Usado para encontrar a inscrição de um recrutador quando vinculamos uma anamnese.
 */
export async function getInscricaoByRecruiterCode(code: string): Promise<InscricaoItem | null> {
  if (!code || typeof code !== "string") {
    return null;
  }

  const normalizedCode = normalizeRecruiterCode(code);
  if (!normalizedCode) {
    return null;
  }

  await loadRecruiterCache();

  const pool = getPool();

  const query = `
    SELECT 
      i.id,
      i.payload,
      i.criado_em,
      ${NAME_EXPRESSION} AS nome,
      ${PHONE_EXPRESSION} AS telefone,
      ${CITY_EXPRESSION} AS cidade,
      ${PROFESSION_EXPRESSION} AS profissao,
      ${TRAINING_EXPRESSION} AS treinamento,
      ${RECRUITER_EXPRESSION} AS traffic_source
    FROM ${SCHEMA_NAME}.inscricoes i
    WHERE ${FINALIZED_INSCRICAO_CONDITION}
    AND (
      LOWER(TRIM(COALESCE(i.payload->>'codigoRecrutador', ''))) = LOWER($1) OR
      LOWER(TRIM(COALESCE(i.payload->>'codigo_recrutador', ''))) = LOWER($1) OR
      LOWER(TRIM(COALESCE(i.payload->>'codigo', ''))) = LOWER($1) OR
      LOWER(TRIM(COALESCE(i.payload->>'codigoProprio', ''))) = LOWER($1) OR
      LOWER(TRIM(COALESCE(i.payload->>'codigo_indicador_proprio', ''))) = LOWER($1)
    )
    LIMIT 1
  `;

  try {
    const { rows } = await pool.query<DbRow>(query, [normalizedCode.toLowerCase()]);
    if (rows.length === 0) {
      return null;
    }
    return mapDbRowToInscricaoItem(rows[0]);
  } catch (error) {
    console.error("Failed to get inscricao by recruiter code:", error);
    return null;
  }
}

/**
 * Marca um grupo de inscrições como "não duplicadas" entre si.
 * Cada inscrição recebe no payload um array `dashboard_not_duplicate`
 * contendo os IDs de todas as outras do grupo.
 */
export async function dismissDuplicateGroup(ids: number[]): Promise<void> {
  const normalizedIds = Array.from(
    new Set(
      (ids ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.trunc(id))
    )
  );

  if (normalizedIds.length < 1) return;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const id of normalizedIds) {
      const { rows } = await client.query<{ payload: Record<string, unknown> | null }>(
        `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (rows.length === 0) continue;

      const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
      const existing = Array.isArray(payload["dashboard_not_duplicate"])
        ? (payload["dashboard_not_duplicate"] as number[])
        : [];

      // Merge other IDs in the group
      const otherIds = normalizedIds.filter((oid) => oid !== id);
      const merged = Array.from(new Set([...existing, ...otherIds]));

      const nextPayload = {
        ...payload,
        dashboard_not_duplicate: merged,
        dashboard_quality_dismissed: true,
        dashboard_quality_dismissed_at: new Date().toISOString(),
      };
      await client.query(
        `UPDATE ${SCHEMA_NAME}.inscricoes SET payload = $2::jsonb WHERE id = $1`,
        [id, JSON.stringify(nextPayload)],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
