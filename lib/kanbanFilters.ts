import type { DashboardUser } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { isProductivityManager } from "@/lib/productivity";

const SCHEMA = "dashboard";

let schemaReady = false;

/**
 * Critérios suportados por um filtro de Kanban. Espelham os filtros já
 * aceitos por listInscricoes — o filtro só restringe QUAIS leads aparecem,
 * nunca as etapas.
 */
export interface KanbanFilterCriteria {
  produto?: "vozup" | "instituto";
  treinamentoIds?: string[];
  campaignSource?: string;
  campaignName?: string;
  caracteristica?: string;
}

export interface KanbanFilter {
  id: number;
  name: string;
  criteria: KanbanFilterCriteria;
  /** E-mails (minúsculos) dos vendedores que enxergam este filtro. */
  sellerEmails: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanFilterInput {
  name: string;
  criteria: KanbanFilterCriteria;
  sellerEmails: string[];
}

interface KanbanFilterRow {
  id: number;
  name: string;
  criteria: Record<string, unknown> | null;
  seller_emails: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

async function ensureKanbanFilterSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.kanban_filters (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
      seller_emails TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  schemaReady = true;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeKanbanFilterCriteria(input: unknown): KanbanFilterCriteria {
  const raw = (input ?? {}) as Record<string, unknown>;
  const produtoRaw = cleanText(raw.produto)?.toLowerCase();
  const treinamentoIds = Array.isArray(raw.treinamentoIds)
    ? raw.treinamentoIds.map((id) => cleanText(id)).filter((id): id is string => Boolean(id))
    : [];

  const criteria: KanbanFilterCriteria = {};
  if (produtoRaw === "vozup" || produtoRaw === "instituto") criteria.produto = produtoRaw;
  if (treinamentoIds.length > 0) criteria.treinamentoIds = treinamentoIds;

  const campaignSource = cleanText(raw.campaignSource);
  if (campaignSource) criteria.campaignSource = campaignSource;

  const campaignName = cleanText(raw.campaignName);
  if (campaignName) criteria.campaignName = campaignName;

  const caracteristica = cleanText(raw.caracteristica);
  if (caracteristica) criteria.caracteristica = caracteristica;

  return criteria;
}

function normalizeSellerEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const emails = input
    .map((value) => normalizeEmail(typeof value === "string" ? value : null))
    .filter((value) => value.length > 0);
  return Array.from(new Set(emails));
}

function filterFromRow(row: KanbanFilterRow): KanbanFilter {
  return {
    id: row.id,
    name: row.name,
    criteria: normalizeKanbanFilterCriteria(row.criteria),
    sellerEmails: (row.seller_emails ?? []).map(normalizeEmail).filter(Boolean),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function assertKanbanFilterAdmin(user: DashboardUser | null | undefined): void {
  if (!isProductivityManager(user)) {
    throw new Error("Apenas administradores podem gerenciar filtros do Kanban.");
  }
}

export async function listKanbanFilters(): Promise<KanbanFilter[]> {
  await ensureKanbanFilterSchema();
  const result = await getPool().query<KanbanFilterRow>(
    `SELECT * FROM ${SCHEMA}.kanban_filters ORDER BY name ASC, id ASC`
  );
  return result.rows.map(filterFromRow);
}

/** Admin vê todos os filtros; vendedor vê apenas os atribuídos a ele. */
export async function listKanbanFiltersForUser(
  user: DashboardUser | null | undefined
): Promise<KanbanFilter[]> {
  const filters = await listKanbanFilters();
  if (isProductivityManager(user)) {
    return filters;
  }
  const email = normalizeEmail(user?.email);
  if (!email) return [];
  return filters.filter((filter) => filter.sellerEmails.includes(email));
}

export async function getKanbanFilter(id: number): Promise<KanbanFilter | null> {
  await ensureKanbanFilterSchema();
  const result = await getPool().query<KanbanFilterRow>(
    `SELECT * FROM ${SCHEMA}.kanban_filters WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? filterFromRow(result.rows[0]) : null;
}

export function canUseKanbanFilter(
  user: DashboardUser | null | undefined,
  filter: KanbanFilter
): boolean {
  if (isProductivityManager(user)) return true;
  return filter.sellerEmails.includes(normalizeEmail(user?.email));
}

export async function createKanbanFilter(
  user: DashboardUser | null | undefined,
  input: KanbanFilterInput
): Promise<KanbanFilter> {
  assertKanbanFilterAdmin(user);
  await ensureKanbanFilterSchema();

  const name = cleanText(input.name);
  if (!name) {
    throw new Error("Informe um nome para o filtro.");
  }

  const result = await getPool().query<KanbanFilterRow>(
    `
      INSERT INTO ${SCHEMA}.kanban_filters (name, criteria, seller_emails)
      VALUES ($1, $2::jsonb, $3)
      RETURNING *
    `,
    [
      name,
      JSON.stringify(normalizeKanbanFilterCriteria(input.criteria)),
      normalizeSellerEmails(input.sellerEmails),
    ]
  );

  return filterFromRow(result.rows[0]);
}

export async function updateKanbanFilter(
  user: DashboardUser | null | undefined,
  id: number,
  input: KanbanFilterInput
): Promise<KanbanFilter> {
  assertKanbanFilterAdmin(user);
  await ensureKanbanFilterSchema();

  const name = cleanText(input.name);
  if (!name) {
    throw new Error("Informe um nome para o filtro.");
  }

  const result = await getPool().query<KanbanFilterRow>(
    `
      UPDATE ${SCHEMA}.kanban_filters
      SET name = $2,
          criteria = $3::jsonb,
          seller_emails = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      name,
      JSON.stringify(normalizeKanbanFilterCriteria(input.criteria)),
      normalizeSellerEmails(input.sellerEmails),
    ]
  );

  if (!result.rows[0]) {
    throw new Error("Filtro nao encontrado.");
  }

  return filterFromRow(result.rows[0]);
}

export async function deleteKanbanFilter(
  user: DashboardUser | null | undefined,
  id: number
): Promise<void> {
  assertKanbanFilterAdmin(user);
  await ensureKanbanFilterSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.kanban_filters WHERE id = $1`, [id]);
}
