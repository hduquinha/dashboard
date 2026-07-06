import type { DashboardUser } from "@/lib/auth";
import { getPool, listInscricoesByIds } from "@/lib/db";
import { listTeamMembers } from "@/lib/teamAuth";
import {
  isProductivityManager,
  productivityActorFromUser,
  removeProductivityLeadAssignment,
  upsertProductivityLeadAssignment,
} from "@/lib/productivity";
import { hasPermission } from "@/lib/permissions";
import type { CommercialStage } from "@/types/inscricao";
import type { CommercialSeller, CommercialWorkspace } from "@/types/commercial";

const SCHEMA = "dashboard";

export const COMMERCIAL_STAGES: Array<{ key: CommercialStage; label: string }> = [
  { key: "novo", label: "Novo" },
  { key: "primeiro_contato", label: "Primeiro contato" },
  { key: "em_atendimento", label: "Em atendimento" },
  { key: "agendado", label: "Agendado" },
  { key: "fechamento", label: "Fechamento" },
  { key: "ganho", label: "Ganho" },
  { key: "perdido", label: "Perdido" },
  { key: "no_show", label: "No-show" },
];

const COMMERCIAL_STAGE_KEYS = new Set(COMMERCIAL_STAGES.map((stage) => stage.key));

let schemaReady = false;

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function assertSupervisor(user: DashboardUser | null | undefined): void {
  if (!isProductivityManager(user) && !hasPermission(user, "crm.assign_leads")) {
    throw new Error("Apenas administradores podem executar esta acao comercial.");
  }
}

function normalizeStage(value: unknown): CommercialStage {
  if (typeof value === "string" && COMMERCIAL_STAGE_KEYS.has(value as CommercialStage)) {
    return value as CommercialStage;
  }
  throw new Error("Etapa comercial invalida.");
}

export async function ensureCommercialSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.commercial_leads (
      inscricao_id INTEGER PRIMARY KEY,
      campaign_source TEXT,
      campaign_name TEXT,
      campaign_medium TEXT,
      campaign_term TEXT,
      landing_page TEXT,
      commercial_stage TEXT NOT NULL DEFAULT 'novo',
      position DOUBLE PRECISION,
      assigned_seller_id INTEGER,
      assigned_seller_email TEXT,
      assigned_seller_name TEXT,
      assigned_by_user_id INTEGER,
      assigned_by_email TEXT,
      assigned_by_name TEXT,
      assigned_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION;
    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS closed_reason TEXT;
    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS closed_course TEXT;
    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS closed_value NUMERIC;
    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.commercial_events (
      id BIGSERIAL PRIMARY KEY,
      inscricao_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      actor_user_id INTEGER,
      actor_email TEXT,
      actor_name TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_commercial_leads_stage ON ${SCHEMA}.commercial_leads(commercial_stage);
    CREATE INDEX IF NOT EXISTS idx_commercial_leads_stage_position ON ${SCHEMA}.commercial_leads(commercial_stage, position);
    CREATE INDEX IF NOT EXISTS idx_commercial_leads_seller ON ${SCHEMA}.commercial_leads(assigned_seller_email, assigned_seller_id);
    CREATE INDEX IF NOT EXISTS idx_commercial_leads_campaign ON ${SCHEMA}.commercial_leads(campaign_source, campaign_name);
    CREATE INDEX IF NOT EXISTS idx_commercial_events_inscricao ON ${SCHEMA}.commercial_events(inscricao_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_commercial_events_actor_created ON ${SCHEMA}.commercial_events(actor_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_commercial_events_to_stage_created ON ${SCHEMA}.commercial_events(to_stage, created_at DESC);
  `);

  schemaReady = true;
}

async function insertEvent(
  inscricaoId: number,
  type: string,
  user: DashboardUser | null | undefined,
  payload: Record<string, unknown> = {},
  fromStage?: string | null,
  toStage?: string | null
): Promise<void> {
  const actor = productivityActorFromUser(user);
  await getPool().query(
    `
      INSERT INTO ${SCHEMA}.commercial_events (
        inscricao_id, event_type, from_stage, to_stage,
        actor_user_id, actor_email, actor_name, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      inscricaoId,
      type,
      fromStage ?? null,
      toStage ?? null,
      actor.id,
      actor.email,
      actor.name,
      JSON.stringify(payload),
    ]
  );
}

async function ensureCommercialLeadRow(inscricaoId: number): Promise<void> {
  await ensureCommercialSchema();
  const items = await listInscricoesByIds([inscricaoId]);
  const item = items[0];
  if (!item) {
    throw new Error("Lead nao encontrado.");
  }

  await getPool().query(
    `
      INSERT INTO ${SCHEMA}.commercial_leads (
        inscricao_id, campaign_source, campaign_name, campaign_medium, campaign_term, landing_page, position
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        (SELECT COALESCE(MAX(position), 0) + 1000 FROM ${SCHEMA}.commercial_leads WHERE commercial_stage = 'novo')
      )
      ON CONFLICT (inscricao_id)
      DO UPDATE SET
        campaign_source = COALESCE(${SCHEMA}.commercial_leads.campaign_source, EXCLUDED.campaign_source),
        campaign_name = COALESCE(${SCHEMA}.commercial_leads.campaign_name, EXCLUDED.campaign_name),
        campaign_medium = COALESCE(${SCHEMA}.commercial_leads.campaign_medium, EXCLUDED.campaign_medium),
        campaign_term = COALESCE(${SCHEMA}.commercial_leads.campaign_term, EXCLUDED.campaign_term),
        landing_page = COALESCE(${SCHEMA}.commercial_leads.landing_page, EXCLUDED.landing_page),
        updated_at = NOW()
    `,
    [
      inscricaoId,
      item.commercial?.campaignSource ?? item.recrutadorCodigo ?? null,
      item.commercial?.campaignName ?? item.treinamentoNome ?? item.treinamentoId ?? null,
      item.commercial?.campaignMedium ?? null,
      item.commercial?.campaignTerm ?? null,
      item.commercial?.landingPage ?? null,
    ]
  );
}

export async function listCommercialSellers(): Promise<CommercialSeller[]> {
  const members = await listTeamMembers({ activeOnly: true });

  return members.map((member) => ({
    id: member.id,
    chatwootUserId: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    inboxIds: [],
    active: member.active,
    position: member.distributionPosition,
    institutoUpOnly: member.institutoUpOnly,
    isSupervisor: isProductivityManager(member),
  }));
}

export async function getCommercialWorkspace(
  user: DashboardUser | null | undefined
): Promise<CommercialWorkspace> {
  await ensureCommercialSchema();
  const sellers = await listCommercialSellers();

  return {
    isSupervisor: isProductivityManager(user),
    sellers,
    stages: COMMERCIAL_STAGES,
  };
}

export async function setCommercialStage(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  stageInput: unknown,
  positionInput?: unknown
): Promise<void> {
  await ensureCommercialLeadRow(inscricaoId);
  const stage = normalizeStage(stageInput);
  const position =
    typeof positionInput === "number" && Number.isFinite(positionInput) ? positionInput : null;
  const actor = productivityActorFromUser(user);
  const item = (await listInscricoesByIds([inscricaoId]))[0];
  const assignedEmail = normalizeEmail(item?.commercial?.assignedSellerEmail);
  if (!isProductivityManager(user) && assignedEmail !== actor.email) {
    throw new Error("Voce nao pode alterar etapa de lead de outro vendedor.");
  }
  const current = await getPool().query<{ commercial_stage: string | null }>(
    `SELECT commercial_stage FROM ${SCHEMA}.commercial_leads WHERE inscricao_id = $1`,
    [inscricaoId]
  );
  const fromStage = current.rows[0]?.commercial_stage ?? null;

  await getPool().query(
    `
      UPDATE ${SCHEMA}.commercial_leads
      SET commercial_stage = $2,
          position = COALESCE($3, position),
          updated_at = NOW()
      WHERE inscricao_id = $1
    `,
    [inscricaoId, stage, position]
  );
  await insertEvent(inscricaoId, "stage_changed", user, { actor }, fromStage, stage);
}

export interface CommercialTimelineEvent {
  id: number;
  type: string;
  fromStage: string | null;
  toStage: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Linha do tempo do lead: tudo que aconteceu (atribuicoes, trocas de etapa,
 * fechamento, reabertura e atividades manuais), do mais recente ao mais
 * antigo. Reordenacoes dentro da mesma coluna (from = to) ficam de fora.
 */
export async function listCommercialLeadTimeline(
  inscricaoId: number
): Promise<CommercialTimelineEvent[]> {
  await ensureCommercialSchema();
  const result = await getPool().query<{
    id: number;
    event_type: string;
    from_stage: string | null;
    to_stage: string | null;
    actor_name: string | null;
    actor_email: string | null;
    payload: Record<string, unknown> | null;
    created_at: Date | string;
  }>(
    `
      SELECT id, event_type, from_stage, to_stage, actor_name, actor_email, payload, created_at
      FROM ${SCHEMA}.commercial_events
      WHERE inscricao_id = $1
        AND NOT (event_type = 'stage_changed' AND from_stage IS NOT DISTINCT FROM to_stage)
      ORDER BY created_at DESC, id DESC
      LIMIT 300
    `,
    [inscricaoId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    payload: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export const COMMERCIAL_ACTIVITY_KINDS = ["whatsapp", "ligacao", "email", "anotacao"] as const;
export type CommercialActivityKind = (typeof COMMERCIAL_ACTIVITY_KINDS)[number];

/** Registro manual na linha do tempo: "falei no WhatsApp", "liguei", etc. */
export async function logCommercialLeadActivity(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  kindInput: unknown,
  descriptionInput: unknown
): Promise<void> {
  await ensureCommercialLeadRow(inscricaoId);

  const kind = COMMERCIAL_ACTIVITY_KINDS.includes(kindInput as CommercialActivityKind)
    ? (kindInput as CommercialActivityKind)
    : null;
  if (!kind) {
    throw new Error("Tipo de atividade invalido.");
  }

  const description =
    typeof descriptionInput === "string" ? descriptionInput.trim().slice(0, 2000) : "";
  if (!description && kind === "anotacao") {
    throw new Error("Escreva a anotacao.");
  }

  await insertEvent(inscricaoId, "activity", user, { kind, description });
}

export type CommercialCloseReason = "curso_fechado" | "sem_continuidade";

export interface CommercialCloseInput {
  reason: CommercialCloseReason;
  courseName?: string | null;
  value?: number | null;
}

/**
 * Fecha o lead e ele sai do Kanban da equipe: "curso_fechado" vira etapa
 * "ganho" (com nome do curso e valor pago) e "sem_continuidade" vira
 * "perdido". Redistribuir o lead depois reabre como "novo" (ver
 * applyCommercialLeadAssignment), preservando o historico.
 */
export async function closeCommercialLead(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  input: CommercialCloseInput
): Promise<void> {
  await ensureCommercialLeadRow(inscricaoId);

  if (input.reason !== "curso_fechado" && input.reason !== "sem_continuidade") {
    throw new Error("Motivo de fechamento invalido.");
  }

  const actor = productivityActorFromUser(user);
  const item = (await listInscricoesByIds([inscricaoId]))[0];
  const assignedEmail = normalizeEmail(item?.commercial?.assignedSellerEmail);
  if (!isProductivityManager(user) && assignedEmail !== actor.email) {
    throw new Error("Voce nao pode fechar lead de outro vendedor.");
  }

  const courseName = typeof input.courseName === "string" ? input.courseName.trim() || null : null;
  const value =
    typeof input.value === "number" && Number.isFinite(input.value) && input.value >= 0
      ? input.value
      : null;
  if (input.reason === "curso_fechado" && !courseName) {
    throw new Error("Informe o nome do curso fechado.");
  }

  const fromStage = item?.commercial?.stage ?? "novo";
  const toStage: CommercialStage = input.reason === "curso_fechado" ? "ganho" : "perdido";

  await getPool().query(
    `
      UPDATE ${SCHEMA}.commercial_leads
      SET commercial_stage = $2,
          closed_reason = $3,
          closed_course = $4,
          closed_value = $5,
          closed_at = NOW(),
          updated_at = NOW()
      WHERE inscricao_id = $1
    `,
    [inscricaoId, toStage, input.reason, courseName, value]
  );

  await insertEvent(
    inscricaoId,
    "closed",
    user,
    { reason: input.reason, courseName, value },
    fromStage,
    toStage
  );
}

interface CommercialLeadAssignmentContext {
  sourceGroupTitle?: string | null;
  leadPath?: string[] | null;
}

export async function assignCommercialLead(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  sellerId: number,
  context: CommercialLeadAssignmentContext = {}
): Promise<{ seller: CommercialSeller }> {
  assertSupervisor(user);
  return applyCommercialLeadAssignment(user, inscricaoId, sellerId, context);
}

/**
 * Núcleo da atribuição de responsável, sem o gate de supervisor. Usado pelo
 * repasse (assignCommercialLead, supervisores) e pela criação manual de lead,
 * onde quem não é supervisor pode atribuir apenas a si mesmo (regra aplicada
 * pelo chamador).
 */
export async function applyCommercialLeadAssignment(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  sellerId: number,
  context: CommercialLeadAssignmentContext = {}
): Promise<{ seller: CommercialSeller }> {
  await ensureCommercialLeadRow(inscricaoId);

  const sellers = await listCommercialSellers();
  const seller = sellers.find((candidate) => candidate.chatwootUserId === sellerId);
  if (!seller) {
    throw new Error("Integrante da equipe nao encontrado.");
  }

  const actor = productivityActorFromUser(user);
  const items = await listInscricoesByIds([inscricaoId]);
  const item = items[0];

  // Lead distribuido/redistribuido chega como "novo" no Kanban do vendedor.
  // Lead fechado (ganho/perdido) que for redistribuido reabre como "novo",
  // mantendo todo o historico de eventos.
  const previousStage = item?.commercial?.stage ?? "novo";
  const previousSellerId = item?.commercial?.assignedSellerId ?? null;
  const wasClosed = previousStage === "ganho" || previousStage === "perdido";
  const resetToNovo = wasClosed || previousSellerId !== seller.chatwootUserId;

  await getPool().query(
    `
      UPDATE ${SCHEMA}.commercial_leads
      SET assigned_seller_id = $2,
          assigned_seller_email = $3,
          assigned_seller_name = $4,
          assigned_by_user_id = $5,
          assigned_by_email = $6,
          assigned_by_name = $7,
          assigned_at = NOW(),
          commercial_stage = CASE WHEN $8 THEN 'novo' ELSE commercial_stage END,
          position = CASE WHEN $8 THEN NULL ELSE position END,
          closed_reason = CASE WHEN $9 THEN NULL ELSE closed_reason END,
          closed_course = CASE WHEN $9 THEN NULL ELSE closed_course END,
          closed_value = CASE WHEN $9 THEN NULL ELSE closed_value END,
          closed_at = CASE WHEN $9 THEN NULL ELSE closed_at END,
          updated_at = NOW()
      WHERE inscricao_id = $1
    `,
    [
      inscricaoId,
      seller.chatwootUserId,
      seller.email,
      seller.name,
      actor.id,
      actor.email,
      actor.name,
      resetToNovo,
      wasClosed,
    ]
  );
  if (wasClosed) {
    await insertEvent(inscricaoId, "reopened", user, {
      sellerId: seller.chatwootUserId,
      sellerEmail: seller.email,
      sellerName: seller.name,
    }, previousStage, "novo");
  }
  await insertEvent(inscricaoId, "assigned", user, {
    sellerId: seller.chatwootUserId,
    sellerEmail: seller.email,
    sellerName: seller.name,
  });

  await upsertProductivityLeadAssignment({
    inscricaoId,
    name: item?.nome ?? null,
    phone: item?.telefone ?? null,
    createdAt: item?.criadoEm ?? null,
    trainingLabel: item?.treinamentoNome ?? item?.treinamentoId ?? null,
    sourceGroupTitle: context.sourceGroupTitle ?? null,
    leadPath: context.leadPath ?? null,
    assigneeId: seller.chatwootUserId,
    assigneeEmail: seller.email,
    assigneeName: seller.name,
    actor,
  });

  return { seller };
}

/**
 * Remove a associação lead ↔ vendedor ("Repassar para vendedor" selecionado de
 * volta na ficha). Limpa as colunas assigned_* em commercial_leads — todos os
 * indicadores de "sem responsável" leem assigned_seller_id IS NULL — e o
 * vínculo de produtividade. Etapa comercial e histórico ficam intactos.
 */
export async function unassignCommercialLead(
  user: DashboardUser | null | undefined,
  inscricaoId: number
): Promise<void> {
  assertSupervisor(user);
  await ensureCommercialSchema();

  const item = (await listInscricoesByIds([inscricaoId]))[0];
  if (!item) {
    throw new Error("Lead nao encontrado.");
  }
  const previousSellerId = item.commercial?.assignedSellerId ?? null;
  const previousSellerEmail = item.commercial?.assignedSellerEmail ?? null;
  const previousSellerName = item.commercial?.assignedSellerName ?? null;
  if (previousSellerId === null && !previousSellerEmail) {
    return;
  }

  await getPool().query(
    `
      UPDATE ${SCHEMA}.commercial_leads
      SET assigned_seller_id = NULL,
          assigned_seller_email = NULL,
          assigned_seller_name = NULL,
          assigned_by_user_id = NULL,
          assigned_by_email = NULL,
          assigned_by_name = NULL,
          assigned_at = NULL,
          updated_at = NOW()
      WHERE inscricao_id = $1
    `,
    [inscricaoId]
  );

  await insertEvent(inscricaoId, "unassigned", user, {
    sellerId: previousSellerId,
    sellerEmail: previousSellerEmail,
    sellerName: previousSellerName,
  });

  await removeProductivityLeadAssignment(inscricaoId);
}
