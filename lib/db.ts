import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { parsePayload, TRAINING_FIELD_KEYS } from "@/lib/parsePayload";
import type { ImportPayload } from "@/lib/importSpreadsheet";
import {
  getRecruiterByCode,
  listRecruiters,
  normalizeRecruiterCode,
  RECRUITERS_BASE_URL,
} from "@/lib/recruiters";
import {
  getTrainingById,
  listTrainingOptions as listConfiguredTrainingOptions,
  formatTrainingDateLabel,
} from "@/lib/trainings";
import type { TrainingOption } from "@/types/training";
import type {
  DuplicateGroup,
  DuplicateReason,
  DuplicateReasonDetail,
  DuplicateSummary,
  InscricaoItem,
  InscricaoNote,
  InscricaoStatus,
  InscricaoTipo,
  ListInscricoesResult,
  OrderableField,
  OrderDirection,
} from "@/types/inscricao";

const SCHEMA_NAME = "inscricoes";

const RECRUITER_CODE_FIELDS = [
  "codigoRecrutador",
  "codigo_recrutador",
  "codigo",
  "codigoProprio",
  "codigo_indicador_proprio",
];

const ORDERABLE_COLUMNS: Record<OrderableField, string> = {
  id: "i.id",
  nome: "LOWER(COALESCE(i.payload->>'nome', ''))",
  telefone: "COALESCE(i.payload->>'telefone', '')",
  cidade: "LOWER(COALESCE(i.payload->>'cidade', ''))",
  profissao: "LOWER(COALESCE(i.payload->>'profissao', ''))",
  treinamento: "COALESCE(i.payload->>'treinamento', '')",
  recrutador: "COALESCE(i.payload->>'traffic_source', '')",
  criado_em: "i.criado_em",
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
    nome?: string;
    telefone?: string;
    indicacao?: string;
    treinamento?: string;
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
  const recruiter = getRecruiterByCode(codeCandidate);

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
  const treinamentoId = parsedTreinamento ?? rowTreinamento ?? null;
  const treinamentoInfo = treinamentoId ? getTrainingById(treinamentoId) : null;
  const treinamentoLabel =
    treinamentoInfo && typeof treinamentoInfo.label === "string"
      ? treinamentoInfo.label === treinamentoId
        ? null
        : treinamentoInfo.label
      : null;
  const treinamentoData = treinamentoInfo?.startsAt ?? treinamentoId ?? null;

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
    nome: typeof row.nome === "string" ? row.nome : null,
    telefone: typeof row.telefone === "string" ? row.telefone : null,
    cidade: typeof row.cidade === "string" ? row.cidade : null,
    profissao: parsedProfissao ?? rowProfissao ?? null,
    recrutadorCodigo: recruiterCode ?? (codeCandidate ? codeCandidate.trim() : null),
    recrutadorNome: recruiter?.name ?? null,
    recrutadorUrl:
      recruiter?.url ?? (recruiterCode ? `${RECRUITERS_BASE_URL}${recruiterCode}` : null),
    treinamentoId,
    treinamentoNome: treinamentoLabel,
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
  };
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const sslEnabled = process.env.PG_SSL === "true";

  return new Pool({
    connectionString,
    application_name: "painel-inscricoes",
    ssl: sslEnabled
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });
}

function getPool(): Pool {
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

  enqueue(value);

  while (queue.length > 0) {
    const current = queue.shift()!;

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

export async function listInscricoes(
  options: ListInscricoesOptions = {}
): Promise<ListInscricoesResult> {
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

  const conditions: string[] = [];
  const filtersValues: unknown[] = [];

  if (filters.nome && filters.nome.trim().length > 0) {
    filtersValues.push(`%${filters.nome.trim()}%`);
    conditions.push(`(i.payload->>'nome') ILIKE $${filtersValues.length}`);
  }

  if (filters.telefone && filters.telefone.trim().length > 0) {
    const cleaned = filters.telefone.replace(/\D+/g, "");
    filtersValues.push(`%${cleaned}%`);
    conditions.push(
      `REGEXP_REPLACE(COALESCE(i.payload->>'telefone', ''), '\\D', '', 'g') ILIKE $${filtersValues.length}`
    );
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
        `(COALESCE(i.payload->>'traffic_source', '') ILIKE $${likeIndex} OR COALESCE(i.payload->>'traffic_source', '') = ANY($${arrayIndex}))`
      );
    } else {
      conditions.push(`COALESCE(i.payload->>'traffic_source', '') ILIKE $${likeIndex}`);
    }
  }

  if (filters.treinamento && filters.treinamento.trim().length > 0) {
    const rawCandidates = buildTrainingFilterCandidates(filters.treinamento.trim());
    const likePatterns = Array.from(
      rawCandidates.reduce((accumulator, candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) {
          return accumulator;
        }
        accumulator.add(`%${trimmed}%`);
        return accumulator;
      }, new Set<string>())
    );

    if (likePatterns.length > 0) {
      filtersValues.push(likePatterns);
      const arrayIndex = filtersValues.length;
      const normalizedTrainingFields = TRAINING_FIELD_KEYS.map(
        (key) => `NULLIF(TRIM(COALESCE(i.payload->>'${key}', '')), '')`
      );
      const matches = normalizedTrainingFields.map(
        (expr) => `${expr} IS NOT NULL AND ${expr} ILIKE ANY($${arrayIndex})`
      );
      if (matches.length > 0) {
        conditions.push(`(${matches.join(' OR ')})`);
      }
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const offset = (page - 1) * pageSizeValue;
  const limitIndex = filtersValues.length + 1;
  const offsetIndex = filtersValues.length + 2;
  const queryValues = [...filtersValues, pageSizeValue, offset];

  const query = `
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      i.payload->>'nome' AS nome,
      i.payload->>'telefone' AS telefone,
      i.payload->>'cidade' AS cidade,
      i.payload->>'profissao' AS profissao,
      i.payload->>'treinamento' AS treinamento,
      i.payload->>'traffic_source' AS traffic_source,
      COUNT(*) OVER() AS total_count
    FROM ${SCHEMA_NAME}.inscricoes AS i
    ${whereClause}
    ORDER BY ${sortColumn} ${sortDirection}, i.id ${sortDirection}
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;

  try {
    const queryResult = await getPool().query<DbRow>(query, queryValues);
    const rows: DbRow[] = queryResult.rows;

    let total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

    if (rows.length === 0) {
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM ${SCHEMA_NAME}.inscricoes AS i
        ${whereClause}
      `;
      const { rows: countRows } = await getPool().query<{ total: number | string | null }>(
        countQuery,
        filtersValues
      );
      total = countRows[0]?.total ? Number(countRows[0].total) : 0;
    }

    const data: InscricaoItem[] = rows.map(mapDbRowToInscricaoItem);

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

export async function getInscricaoById(id: number): Promise<InscricaoItem | null> {
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Invalid inscrição id");
  }

  const query = `
    SELECT
      i.id,
      i.payload,
      i.criado_em,
      i.payload->>'nome' AS nome,
      i.payload->>'telefone' AS telefone,
      i.payload->>'cidade' AS cidade,
      i.payload->>'profissao' AS profissao,
      i.payload->>'treinamento' AS treinamento,
      i.payload->>'traffic_source' AS traffic_source,
      NULL::bigint AS total_count
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE i.id = $1
    LIMIT 1
  `;

  const { rows } = await getPool().query<DbRow>(query, [id]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return mapDbRowToInscricaoItem(row);
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
  const seen = new Set(orderedOptions.map((option) => option.id));

  const query = `
    SELECT DISTINCT TRIM(COALESCE(i.payload->>'treinamento', '')) AS treinamento
    FROM ${SCHEMA_NAME}.inscricoes AS i
    WHERE TRIM(COALESCE(i.payload->>'treinamento', '')) <> ''
    ORDER BY 1
  `;

  try {
    const { rows } = await getPool().query<{ treinamento: string | null }>(query);
    const extras: TrainingOption[] = [];

    for (const row of rows) {
      const rawId = typeof row.treinamento === "string" ? row.treinamento.trim() : "";
      if (!rawId) {
        continue;
      }

      const info = getTrainingById(rawId);
      if (info) {
        if (!seen.has(info.id)) {
          seen.add(info.id);
          extras.push(info);
        }
        continue;
      }

      if (!seen.has(rawId)) {
        seen.add(rawId);
        extras.push({ id: rawId, label: rawId });
      }
    }

    extras.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return [...orderedOptions, ...extras];
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
  const conditions: string[] = [];

  if (filters.treinamentoId) {
    params.push(filters.treinamentoId.trim());
    conditions.push(`TRIM(COALESCE(i.payload->>'treinamento', '')) = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const typeExpression = "LOWER(COALESCE(NULLIF(TRIM(i.payload->>'tipo'), ''), 'lead'))";
  const indicatorExpression = `COALESCE(
    NULLIF(TRIM(i.payload->>'recrutadorCodigo'), ''),
    NULLIF(TRIM(i.payload->>'codigo_indicador'), ''),
    NULLIF(TRIM(i.payload->>'traffic_source'), '')
  )`;

  const query = `
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE ${typeExpression} = 'recrutador')::bigint AS recruiters,
      COUNT(*) FILTER (WHERE ${typeExpression} <> 'recrutador')::bigint AS leads,
      COUNT(*) FILTER (WHERE ${indicatorExpression} IS NOT NULL)::bigint AS with_indicator,
      COUNT(*) FILTER (WHERE ${indicatorExpression} IS NULL)::bigint AS without_indicator,
      COUNT(*) FILTER (WHERE i.criado_em >= NOW() - INTERVAL '24 hours')::bigint AS last_24h
    FROM ${SCHEMA_NAME}.inscricoes AS i
    ${whereClause}
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

interface DuplicateEntry {
  item: InscricaoItem;
  createdDay: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  payloadHash: string | null;
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
        i.payload->>'nome' AS nome,
        i.payload->>'telefone' AS telefone,
        i.payload->>'cidade' AS cidade,
        i.payload->>'profissao' AS profissao,
        i.payload->>'treinamento' AS treinamento,
        i.payload->>'traffic_source' AS traffic_source,
        NULL::bigint AS total_count,
        REGEXP_REPLACE(COALESCE(i.payload->>'telefone', ''), '\\D', '', 'g') AS telefone_normalizado,
        LOWER(TRIM(COALESCE(i.payload->>'email', ''))) AS email_normalizado,
        LOWER(TRIM(COALESCE(i.payload->>'nome', ''))) AS nome_normalizado,
        DATE_TRUNC('day', i.criado_em) AS criado_dia,
        MD5(CAST(i.payload AS TEXT)) AS payload_hash
      FROM ${SCHEMA_NAME}.inscricoes AS i
      WHERE i.criado_em >= NOW() - ($1::text || ' days')::interval
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
    };
  });

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
      const sortedBucket = bucket
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
        union(first.item.id, other.item.id);
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

  const groups: DuplicateGroup[] = Array.from(groupMap.entries())
    .map(([root, data]) => {
      const sortedEntries = Array.from(data.entries).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
      return {
        id: `group:${root}`,
        entries: sortedEntries,
        reasons: data.reasons,
        score: sortedEntries.length,
        latestCreatedAt: sortedEntries[0]?.criadoEm ?? data.latest,
      };
    })
    .filter((group) => group.entries.length > 1)
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

export type { ListInscricoesOptions };
