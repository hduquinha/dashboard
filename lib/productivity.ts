import type { PoolClient } from "pg";
import type { DashboardUser } from "@/lib/auth";
import { getPool, listInscricoes } from "@/lib/db";
import { listTeamMembers, updateTeamMember } from "@/lib/teamAuth";
import {
  CLOSING_NO_SHOW_ROWS,
  CLOSING_PRODUCTION_ROWS,
  DAILY_PRODUCTIVITY_ROWS,
  PRODUCTIVITY_CHANNELS,
  createEmptyMetricMatrix,
  normalizeMetricMatrix,
  sumMetricChannels,
  sumMetricMatrix,
  sumMetricRows,
  type MetricMatrix,
} from "@/lib/productivityConfig";
import { getCommercialProductivitySnapshot } from "@/lib/commercialReports";
import { formatTrainingDateLabel } from "@/lib/trainings";
import type {
  LeadDistributionQueueItem,
  LeadDistributionResultItem,
  ProductivityActor,
  ProductivityChartsData,
  ProductivityClosingBoard,
  ProductivityConsultant,
  ProductivityDailyBoard,
  ProductivityDistributionState,
  ProductivityKanbanSnapshot,
  ProductivityLeadAgent,
  ProductivitySummary,
  ProductivityWorkspace,
  SaveProductivityBoardsInput,
} from "@/types/productivity";

const SCHEMA = "dashboard";
const DEFAULT_QUEUE_LIMIT = 25;

let schemaReady = false;

interface ProductivityBoardRow {
  id: number;
  consultant_user_id: number | null;
  consultant_email: string;
  consultant_name: string;
  report_date: string | Date;
  metrics?: unknown;
  no_show_metrics?: unknown;
  production_metrics?: unknown;
  delivery_date?: string | Date | null;
  specialist_signature?: string | null;
  created_by_user_id: number | null;
  created_by_email: string | null;
  created_by_name: string | null;
  verified_at: string | Date | null;
  verified_by_user_id: number | null;
  verified_by_email: string | null;
  verified_by_name: string | null;
  manager_notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function dateOnly(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function assertDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Data invalida.");
  }
  return trimmed;
}

function splitEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\n;]/)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

export function productivityActorFromUser(user: DashboardUser | null | undefined): ProductivityActor {
  const email = normalizeEmail(user?.email) || "dashboard@local";
  return {
    id: typeof user?.id === "number" ? user.id : null,
    email,
    name: normalizeName(user?.name, email),
  };
}

export function isProductivityManager(
  user: Pick<DashboardUser, "role" | "email"> | null | undefined
): boolean {
  if (!user) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  const email = normalizeEmail(user.email);
  const configuredManagers = splitEmailList(
    process.env.PRODUCTIVITY_MANAGER_EMAILS || process.env.DASHBOARD_MANAGER_EMAILS
  );

  return configuredManagers.includes(email);
}

function assertManager(user: DashboardUser | null | undefined): void {
  if (!isProductivityManager(user)) {
    throw new Error("Apenas usuarios autorizados podem executar esta acao.");
  }
}

async function ensureProductivitySchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.productivity_daily_boards (
      id SERIAL PRIMARY KEY,
      consultant_user_id INTEGER,
      consultant_email TEXT NOT NULL,
      consultant_name TEXT NOT NULL,
      report_date DATE NOT NULL,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id INTEGER,
      created_by_email TEXT,
      created_by_name TEXT,
      verified_at TIMESTAMP WITH TIME ZONE,
      verified_by_user_id INTEGER,
      verified_by_email TEXT,
      verified_by_name TEXT,
      manager_notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uk_productivity_daily_consultant_date UNIQUE (consultant_email, report_date)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.productivity_closing_boards (
      id SERIAL PRIMARY KEY,
      consultant_user_id INTEGER,
      consultant_email TEXT NOT NULL,
      consultant_name TEXT NOT NULL,
      report_date DATE NOT NULL,
      no_show_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      production_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      delivery_date DATE,
      specialist_signature TEXT,
      created_by_user_id INTEGER,
      created_by_email TEXT,
      created_by_name TEXT,
      verified_at TIMESTAMP WITH TIME ZONE,
      verified_by_user_id INTEGER,
      verified_by_email TEXT,
      verified_by_name TEXT,
      manager_notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uk_productivity_closing_consultant_date UNIQUE (consultant_email, report_date)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.productivity_lead_assignments (
      id SERIAL PRIMARY KEY,
      dashboard_inscricao_id INTEGER UNIQUE,
      chatwoot_conversation_id INTEGER UNIQUE,
      chatwoot_conversation_display_id INTEGER,
      chatwoot_assignee_id INTEGER NOT NULL,
      assignee_email TEXT NOT NULL,
      assignee_name TEXT NOT NULL,
      assigned_by_user_id INTEGER,
      assigned_by_email TEXT,
      assigned_by_name TEXT,
      source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_productivity_daily_date ON ${SCHEMA}.productivity_daily_boards(report_date DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_daily_consultant ON ${SCHEMA}.productivity_daily_boards(consultant_email);
    CREATE INDEX IF NOT EXISTS idx_productivity_closing_date ON ${SCHEMA}.productivity_closing_boards(report_date DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_closing_consultant ON ${SCHEMA}.productivity_closing_boards(consultant_email);
    CREATE INDEX IF NOT EXISTS idx_productivity_lead_assignments_assignee ON ${SCHEMA}.productivity_lead_assignments(chatwoot_assignee_id, assigned_at DESC);
  `);

  schemaReady = true;
}

function mapDailyBoard(row: ProductivityBoardRow): ProductivityDailyBoard {
  return {
    id: row.id,
    consultantUserId: row.consultant_user_id,
    consultantEmail: row.consultant_email,
    consultantName: row.consultant_name,
    reportDate: dateOnly(row.report_date) ?? "",
    metrics: normalizeMetricMatrix(row.metrics, DAILY_PRODUCTIVITY_ROWS),
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    verifiedAt: toIso(row.verified_at),
    verifiedByUserId: row.verified_by_user_id,
    verifiedByEmail: row.verified_by_email,
    verifiedByName: row.verified_by_name,
    managerNotes: row.manager_notes,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

function mapClosingBoard(row: ProductivityBoardRow): ProductivityClosingBoard {
  return {
    id: row.id,
    consultantUserId: row.consultant_user_id,
    consultantEmail: row.consultant_email,
    consultantName: row.consultant_name,
    reportDate: dateOnly(row.report_date) ?? "",
    noShowMetrics: normalizeMetricMatrix(row.no_show_metrics, CLOSING_NO_SHOW_ROWS),
    productionMetrics: normalizeMetricMatrix(row.production_metrics, CLOSING_PRODUCTION_ROWS),
    deliveryDate: dateOnly(row.delivery_date),
    specialistSignature: row.specialist_signature ?? null,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    verifiedAt: toIso(row.verified_at),
    verifiedByUserId: row.verified_by_user_id,
    verifiedByEmail: row.verified_by_email,
    verifiedByName: row.verified_by_name,
    managerNotes: row.manager_notes,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

function resolveConsultant(
  input: SaveProductivityBoardsInput,
  actor: ProductivityActor,
  manager: boolean
): ProductivityConsultant {
  if (!manager) {
    return {
      userId: actor.id,
      email: actor.email,
      name: actor.name,
    };
  }

  const email = normalizeEmail(input.consultantEmail) || actor.email;
  return {
    userId: typeof input.consultantUserId === "number" ? input.consultantUserId : actor.id,
    email,
    name: normalizeName(input.consultantName, email),
  };
}

async function upsertDailyBoard(
  client: PoolClient,
  consultant: ProductivityConsultant,
  actor: ProductivityActor,
  reportDate: string,
  metrics: MetricMatrix
): Promise<ProductivityDailyBoard> {
  const { rows } = await client.query<ProductivityBoardRow>(
    `
      INSERT INTO ${SCHEMA}.productivity_daily_boards (
        consultant_user_id, consultant_email, consultant_name, report_date, metrics,
        created_by_user_id, created_by_email, created_by_name, updated_at
      )
      VALUES ($1, $2, $3, $4::date, $5::jsonb, $6, $7, $8, NOW())
      ON CONFLICT (consultant_email, report_date)
      DO UPDATE SET
        consultant_user_id = EXCLUDED.consultant_user_id,
        consultant_name = EXCLUDED.consultant_name,
        metrics = EXCLUDED.metrics,
        created_by_user_id = EXCLUDED.created_by_user_id,
        created_by_email = EXCLUDED.created_by_email,
        created_by_name = EXCLUDED.created_by_name,
        verified_at = NULL,
        verified_by_user_id = NULL,
        verified_by_email = NULL,
        verified_by_name = NULL,
        updated_at = NOW()
      RETURNING *
    `,
    [
      consultant.userId,
      consultant.email,
      consultant.name,
      reportDate,
      JSON.stringify(metrics),
      actor.id,
      actor.email,
      actor.name,
    ]
  );

  return mapDailyBoard(rows[0]);
}

async function upsertClosingBoard(
  client: PoolClient,
  consultant: ProductivityConsultant,
  actor: ProductivityActor,
  reportDate: string,
  noShowMetrics: MetricMatrix,
  productionMetrics: MetricMatrix,
  deliveryDate: string | null,
  specialistSignature: string | null
): Promise<ProductivityClosingBoard> {
  const { rows } = await client.query<ProductivityBoardRow>(
    `
      INSERT INTO ${SCHEMA}.productivity_closing_boards (
        consultant_user_id, consultant_email, consultant_name, report_date,
        no_show_metrics, production_metrics, delivery_date, specialist_signature,
        created_by_user_id, created_by_email, created_by_name, updated_at
      )
      VALUES ($1, $2, $3, $4::date, $5::jsonb, $6::jsonb, $7::date, $8, $9, $10, $11, NOW())
      ON CONFLICT (consultant_email, report_date)
      DO UPDATE SET
        consultant_user_id = EXCLUDED.consultant_user_id,
        consultant_name = EXCLUDED.consultant_name,
        no_show_metrics = EXCLUDED.no_show_metrics,
        production_metrics = EXCLUDED.production_metrics,
        delivery_date = EXCLUDED.delivery_date,
        specialist_signature = EXCLUDED.specialist_signature,
        created_by_user_id = EXCLUDED.created_by_user_id,
        created_by_email = EXCLUDED.created_by_email,
        created_by_name = EXCLUDED.created_by_name,
        verified_at = NULL,
        verified_by_user_id = NULL,
        verified_by_email = NULL,
        verified_by_name = NULL,
        updated_at = NOW()
      RETURNING *
    `,
    [
      consultant.userId,
      consultant.email,
      consultant.name,
      reportDate,
      JSON.stringify(noShowMetrics),
      JSON.stringify(productionMetrics),
      deliveryDate,
      specialistSignature,
      actor.id,
      actor.email,
      actor.name,
    ]
  );

  return mapClosingBoard(rows[0]);
}

export async function saveProductivityBoards(
  input: SaveProductivityBoardsInput,
  user: DashboardUser | null | undefined
): Promise<{ daily: ProductivityDailyBoard; closing: ProductivityClosingBoard }> {
  await ensureProductivitySchema();

  const actor = productivityActorFromUser(user);
  const manager = isProductivityManager(user);
  const consultant = resolveConsultant(input, actor, manager);
  const reportDate = assertDate(input.reportDate);
  const dailyMetrics = normalizeMetricMatrix(input.dailyMetrics, DAILY_PRODUCTIVITY_ROWS);
  const noShowMetrics = normalizeMetricMatrix(input.noShowMetrics, CLOSING_NO_SHOW_ROWS);
  const productionMetrics = normalizeMetricMatrix(input.productionMetrics, CLOSING_PRODUCTION_ROWS);
  const deliveryDate = input.deliveryDate ? assertDate(input.deliveryDate) : null;
  const specialistSignature = input.specialistSignature?.trim() || null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const daily = await upsertDailyBoard(client, consultant, actor, reportDate, dailyMetrics);
    const closing = await upsertClosingBoard(
      client,
      consultant,
      actor,
      reportDate,
      noShowMetrics,
      productionMetrics,
      deliveryDate,
      specialistSignature
    );
    await client.query("COMMIT");
    return { daily, closing };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyProductivityBoard(
  model: "daily" | "closing",
  id: number,
  user: DashboardUser | null | undefined
): Promise<ProductivityDailyBoard | ProductivityClosingBoard> {
  await ensureProductivitySchema();
  assertManager(user);

  const actor = productivityActorFromUser(user);
  const table = model === "daily" ? "productivity_daily_boards" : "productivity_closing_boards";
  const { rows } = await getPool().query<ProductivityBoardRow>(
    `
      UPDATE ${SCHEMA}.${table}
      SET verified_at = NOW(),
          verified_by_user_id = $2,
          verified_by_email = $3,
          verified_by_name = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, actor.id, actor.email, actor.name]
  );

  if (!rows[0]) {
    throw new Error("Registro nao encontrado.");
  }

  return model === "daily" ? mapDailyBoard(rows[0]) : mapClosingBoard(rows[0]);
}

async function listDailyBoards(
  user: DashboardUser | null | undefined,
  dateFrom: string,
  dateTo: string
): Promise<ProductivityDailyBoard[]> {
  const manager = isProductivityManager(user);
  const actor = productivityActorFromUser(user);
  const params: unknown[] = [dateFrom, dateTo];
  const conditions = ["report_date BETWEEN $1::date AND $2::date"];

  if (!manager) {
    params.push(actor.email);
    conditions.push(`consultant_email = $${params.length}`);
  }

  const { rows } = await getPool().query<ProductivityBoardRow>(
    `
      SELECT *
      FROM ${SCHEMA}.productivity_daily_boards
      WHERE ${conditions.join(" AND ")}
      ORDER BY report_date DESC, consultant_name ASC
    `,
    params
  );

  return rows.map(mapDailyBoard);
}

async function listClosingBoards(
  user: DashboardUser | null | undefined,
  dateFrom: string,
  dateTo: string
): Promise<ProductivityClosingBoard[]> {
  const manager = isProductivityManager(user);
  const actor = productivityActorFromUser(user);
  const params: unknown[] = [dateFrom, dateTo];
  const conditions = ["report_date BETWEEN $1::date AND $2::date"];

  if (!manager) {
    params.push(actor.email);
    conditions.push(`consultant_email = $${params.length}`);
  }

  const { rows } = await getPool().query<ProductivityBoardRow>(
    `
      SELECT *
      FROM ${SCHEMA}.productivity_closing_boards
      WHERE ${conditions.join(" AND ")}
      ORDER BY report_date DESC, consultant_name ASC
    `,
    params
  );

  return rows.map(mapClosingBoard);
}

function uniqueConsultants(
  actor: ProductivityActor,
  dailyBoards: ProductivityDailyBoard[],
  closingBoards: ProductivityClosingBoard[],
  agents: ProductivityLeadAgent[]
): ProductivityConsultant[] {
  const map = new Map<string, ProductivityConsultant>();
  const add = (consultant: ProductivityConsultant) => {
    if (!consultant.email) {
      return;
    }
    map.set(consultant.email, consultant);
  };

  add({ userId: actor.id, email: actor.email, name: actor.name });
  for (const board of dailyBoards) {
    add({
      userId: board.consultantUserId,
      email: board.consultantEmail,
      name: board.consultantName,
    });
  }
  for (const board of closingBoards) {
    add({
      userId: board.consultantUserId,
      email: board.consultantEmail,
      name: board.consultantName,
    });
  }
  for (const agent of agents) {
    add({ userId: agent.chatwootUserId, email: agent.email, name: agent.name });
  }

  return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildSummary(
  dailyBoards: ProductivityDailyBoard[],
  closingBoards: ProductivityClosingBoard[]
): ProductivitySummary {
  const totalAttempts = dailyBoards.reduce(
    (total, board) => total + sumMetricRows(board.metrics, ["tentativas"]),
    0
  );
  const totalConnections = dailyBoards.reduce(
    (total, board) => total + sumMetricRows(board.metrics, ["conexao_falada", "conexao_whatsapp"]),
    0
  );
  const totalAppointments = dailyBoards.reduce(
    (total, board) => total + sumMetricRows(board.metrics, ["agendamento_falado", "agendamento_wpp"]),
    0
  );
  const totalConsultorias = dailyBoards.reduce(
    (total, board) => total + sumMetricRows(board.metrics, ["consultoria_presencial", "consultoria_google_meet"]),
    0
  );
  const totalNoShows = closingBoards.reduce((total, board) => total + sumMetricMatrix(board.noShowMetrics), 0);
  const totalProduction = closingBoards.reduce(
    (total, board) => total + sumMetricMatrix(board.productionMetrics),
    0
  );
  const verifiedDailyBoards = dailyBoards.filter((board) => board.verifiedAt).length;
  const verifiedClosingBoards = closingBoards.filter((board) => board.verifiedAt).length;

  return {
    totalAttempts,
    totalConnections,
    totalAppointments,
    totalConsultorias,
    totalNoShows,
    totalProduction,
    verifiedDailyBoards,
    verifiedClosingBoards,
    pendingVerification:
      dailyBoards.length + closingBoards.length - verifiedDailyBoards - verifiedClosingBoards,
  };
}

function buildCharts(
  dailyBoards: ProductivityDailyBoard[],
  closingBoards: ProductivityClosingBoard[]
): ProductivityChartsData {
  const trend = new Map<
    string,
    {
      date: string;
      label: string;
      tentativas: number;
      conexoes: number;
      agendamentos: number;
      consultorias: number;
      producao: number;
      bolos: number;
    }
  >();
  const consultants = new Map<
    string,
    { email: string; name: string; tentativas: number; agendamentos: number; producao: number }
  >();
  const channelTotals = PRODUCTIVITY_CHANNELS.reduce<Record<string, number>>((acc, channel) => {
    acc[channel.key] = 0;
    return acc;
  }, {});

  const ensureTrend = (date: string) => {
    const existing = trend.get(date);
    if (existing) {
      return existing;
    }
    const item = {
      date,
      label: date.slice(5).split("-").reverse().join("/"),
      tentativas: 0,
      conexoes: 0,
      agendamentos: 0,
      consultorias: 0,
      producao: 0,
      bolos: 0,
    };
    trend.set(date, item);
    return item;
  };

  const ensureConsultant = (email: string, name: string) => {
    const existing = consultants.get(email);
    if (existing) {
      return existing;
    }
    const item = { email, name, tentativas: 0, agendamentos: 0, producao: 0 };
    consultants.set(email, item);
    return item;
  };

  for (const board of dailyBoards) {
    const point = ensureTrend(board.reportDate);
    const consultant = ensureConsultant(board.consultantEmail, board.consultantName);
    const attempts = sumMetricRows(board.metrics, ["tentativas"]);
    const appointments = sumMetricRows(board.metrics, ["agendamento_falado", "agendamento_wpp"]);
    point.tentativas += attempts;
    point.conexoes += sumMetricRows(board.metrics, ["conexao_falada", "conexao_whatsapp"]);
    point.agendamentos += appointments;
    point.consultorias += sumMetricRows(board.metrics, ["consultoria_presencial", "consultoria_google_meet"]);
    consultant.tentativas += attempts;
    consultant.agendamentos += appointments;
  }

  for (const board of closingBoards) {
    const point = ensureTrend(board.reportDate);
    const consultant = ensureConsultant(board.consultantEmail, board.consultantName);
    const production = sumMetricMatrix(board.productionMetrics);
    point.producao += production;
    point.bolos += sumMetricRows(board.productionMetrics, ["bolos"]);
    consultant.producao += production;

    const totals = sumMetricChannels(board.productionMetrics);
    for (const channel of PRODUCTIVITY_CHANNELS) {
      channelTotals[channel.key] += totals[channel.key] ?? 0;
    }
  }

  return {
    trend: Array.from(trend.values()).sort((left, right) => left.date.localeCompare(right.date)),
    channels: PRODUCTIVITY_CHANNELS.map((channel) => ({
      channel: channel.key,
      label: channel.label,
      value: channelTotals[channel.key] ?? 0,
    })).filter((item) => item.value > 0),
    consultants: Array.from(consultants.values()).sort((left, right) => right.producao - left.producao),
  };
}

export async function listProductivityLeadAgents(): Promise<ProductivityLeadAgent[]> {
  const members = await listTeamMembers();

  return members
    .map((member) => ({
      id: member.id,
      chatwootUserId: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      inboxIds: [],
      active: member.active,
      position: member.distributionPosition,
      institutoUpOnly: member.institutoUpOnly,
    }))
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

export async function saveProductivityLeadAgents(
  user: DashboardUser | null | undefined,
  agents: Array<{ chatwootUserId: number; active: boolean; position: number }>
): Promise<ProductivityLeadAgent[]> {
  assertManager(user);

  for (const item of agents) {
    await updateTeamMember(item.chatwootUserId, {
      active: item.active,
      distributionPosition: Number.isFinite(item.position) ? Math.max(1, Math.trunc(item.position)) : 1,
    });
  }

  return listProductivityLeadAgents();
}

export async function listLeadDistributionQueue(limit = DEFAULT_QUEUE_LIMIT): Promise<LeadDistributionQueueItem[]> {
  await ensureProductivitySchema();

  const result = await listInscricoes({
    page: 1,
    pageSize: Math.min(Math.max(limit, 1), 100),
    orderBy: "criado_em",
    orderDirection: "desc",
    filters: { status: "aguardando", unassignedOnly: true },
  });

  return result.data.slice(0, limit).map((item) => ({
    inscricaoId: item.id,
    name: item.nome,
    phone: item.telefone,
    createdAt: item.criadoEm,
    trainingLabel:
      item.treinamentoData
        ? formatTrainingDateLabel(item.treinamentoData)
        : item.treinamentoNome || item.treinamentoId,
    assigneeId: item.commercial?.assignedSellerId ?? null,
    assigneeName: item.commercial?.assignedSellerName ?? null,
  }));
}

async function activeLeadAgents(): Promise<ProductivityLeadAgent[]> {
  const agents = await listProductivityLeadAgents();
  return agents
    .filter((agent) => agent.active)
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

async function getNextAgentStartIndex(agents: ProductivityLeadAgent[]): Promise<number> {
  if (agents.length === 0) {
    return 0;
  }

  const { rows } = await getPool().query<{ chatwoot_assignee_id: number | null }>(
    `
      SELECT chatwoot_assignee_id
      FROM ${SCHEMA}.productivity_lead_assignments
      ORDER BY assigned_at DESC
      LIMIT 1
    `
  );
  const lastAssigneeId = rows[0]?.chatwoot_assignee_id ?? null;
  const lastIndex = agents.findIndex((agent) => agent.chatwootUserId === lastAssigneeId);
  return lastIndex >= 0 ? (lastIndex + 1) % agents.length : 0;
}

export async function upsertProductivityLeadAssignment(input: {
  inscricaoId: number;
  name?: string | null;
  phone?: string | null;
  createdAt?: string | null;
  trainingLabel?: string | null;
  sourceGroupTitle?: string | null;
  leadPath?: string[] | null;
  assigneeId: number;
  assigneeEmail: string;
  assigneeName: string;
  actor: ProductivityActor;
}): Promise<void> {
  await ensureProductivitySchema();

  const sourceSnapshot = {
    inscricaoId: input.inscricaoId,
    name: input.name ?? null,
    phone: input.phone ?? null,
    createdAt: input.createdAt ?? null,
    trainingLabel: input.trainingLabel ?? null,
    sourceGroupTitle: input.sourceGroupTitle ?? null,
    leadPath: input.leadPath ?? null,
  };

  await getPool().query(
    `
      INSERT INTO ${SCHEMA}.productivity_lead_assignments (
        dashboard_inscricao_id, chatwoot_assignee_id, assignee_email, assignee_name,
        assigned_by_user_id, assigned_by_email, assigned_by_name, source_snapshot,
        assigned_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (dashboard_inscricao_id)
      DO UPDATE SET
        chatwoot_assignee_id = EXCLUDED.chatwoot_assignee_id,
        assignee_email = EXCLUDED.assignee_email,
        assignee_name = EXCLUDED.assignee_name,
        assigned_by_user_id = EXCLUDED.assigned_by_user_id,
        assigned_by_email = EXCLUDED.assigned_by_email,
        assigned_by_name = EXCLUDED.assigned_by_name,
        source_snapshot = EXCLUDED.source_snapshot,
        assigned_at = NOW()
    `,
    [
      input.inscricaoId,
      input.assigneeId,
      input.assigneeEmail,
      input.assigneeName,
      input.actor.id,
      input.actor.email,
      input.actor.name,
      JSON.stringify(sourceSnapshot),
    ]
  );
}

export async function distributeNextLeads(
  user: DashboardUser | null | undefined,
  limit: number
): Promise<LeadDistributionResultItem[]> {
  await ensureProductivitySchema();
  assertManager(user);

  // Import tardio para evitar ciclo estatico entre lib/commercial.ts <-> lib/productivity.ts
  // (ambos so se referenciam dentro de corpos de funcao, resolvidos em runtime).
  const { assignCommercialLead } = await import("@/lib/commercial");

  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit || 1)));
  const [agents, queue] = await Promise.all([activeLeadAgents(), listLeadDistributionQueue(safeLimit)]);

  if (agents.length === 0) {
    throw new Error("Configure pelo menos um integrante ativo na ordem de distribuicao.");
  }

  const startIndex = await getNextAgentStartIndex(agents);
  const assigned: LeadDistributionResultItem[] = [];

  for (let index = 0; index < queue.length && assigned.length < safeLimit; index += 1) {
    const item = queue[index];
    const agent = agents[(startIndex + assigned.length) % agents.length];
    const { seller } = await assignCommercialLead(user, item.inscricaoId, agent.chatwootUserId);
    assigned.push({
      inscricaoId: item.inscricaoId,
      assigneeId: seller.chatwootUserId,
      assigneeName: seller.name,
      assigneeEmail: seller.email,
    });
  }

  return assigned;
}

async function getDistributionState(isManager: boolean): Promise<ProductivityDistributionState> {
  if (!isManager) {
    return { configured: false, agents: [], queue: [], lastAssignments: [] };
  }

  const [agents, queue] = await Promise.all([
    listProductivityLeadAgents(),
    listLeadDistributionQueue(DEFAULT_QUEUE_LIMIT),
  ]);

  return {
    configured: agents.length > 0,
    agents,
    queue,
    lastAssignments: [],
  };
}

function defaultRange(): { dateFrom: string; dateTo: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

export async function getProductivityWorkspace(
  user: DashboardUser | null | undefined,
  filters: { dateFrom?: string | null; dateTo?: string | null } = {}
): Promise<ProductivityWorkspace> {
  await ensureProductivitySchema();

  const range = defaultRange();
  const dateFrom = filters.dateFrom ? assertDate(filters.dateFrom) : range.dateFrom;
  const dateTo = filters.dateTo ? assertDate(filters.dateTo) : range.dateTo;
  const currentUser = productivityActorFromUser(user);
  const isManager = isProductivityManager(user);

  const [dailyBoards, closingBoards, distribution, kanban] = await Promise.all([
    listDailyBoards(user, dateFrom, dateTo),
    listClosingBoards(user, dateFrom, dateTo),
    getDistributionState(isManager),
    getCommercialProductivitySnapshot({
      dateFrom,
      dateTo,
      sellerEmail: isManager ? null : currentUser.email,
    }),
  ]);

  return {
    currentUser,
    isManager,
    dateFrom,
    dateTo,
    consultants: uniqueConsultants(currentUser, dailyBoards, closingBoards, distribution.agents),
    dailyBoards,
    closingBoards,
    summary: buildSummary(dailyBoards, closingBoards),
    charts: buildCharts(dailyBoards, closingBoards),
    distribution,
    kanban,
  };
}

export function emptyDailyMetrics(): MetricMatrix {
  return createEmptyMetricMatrix(DAILY_PRODUCTIVITY_ROWS);
}

export function emptyNoShowMetrics(): MetricMatrix {
  return createEmptyMetricMatrix(CLOSING_NO_SHOW_ROWS);
}

export function emptyProductionMetrics(): MetricMatrix {
  return createEmptyMetricMatrix(CLOSING_PRODUCTION_ROWS);
}

export type { ProductivityKanbanSnapshot };
