import type { DashboardUser } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { isProductivityManager } from "@/lib/productivity";
import {
  normalizeStageColorToken,
  stageColorTokenForIndex,
  type StageColorToken,
} from "@/lib/stageColors";
import type { CommercialStageKind } from "@/types/inscricao";
import type { Funnel, FunnelInput, FunnelStage, FunnelStageInput } from "@/types/funnel";

export type { Funnel, FunnelInput, FunnelStage, FunnelStageInput };

const SCHEMA = "dashboard";

interface FunnelRow {
  id: number;
  name: string;
  is_default: boolean;
  seller_ids: number[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface FunnelStageRow {
  id: number;
  funnel_id: number;
  key: string;
  label: string;
  kind: string;
  color: string;
  position: number;
}

/** Etapas do "Funil Padrão", com as mesmas chaves que já existem em leads hoje — sem isso, leads antigos ficariam sem etapa correspondente. */
const DEFAULT_FUNNEL_STAGES: Array<{ key: string; label: string; kind: CommercialStageKind; color: StageColorToken }> = [
  { key: "novo", label: "Novo", kind: "entry", color: "slate" },
  { key: "primeiro_contato", label: "1º Contato", kind: "normal", color: "cyan" },
  { key: "em_atendimento", label: "Em Atendimento", kind: "normal", color: "blue" },
  { key: "agendado", label: "Agendado", kind: "normal", color: "violet" },
  { key: "fechamento", label: "Fechamento", kind: "normal", color: "amber" },
  { key: "no_show", label: "No-show", kind: "normal", color: "orange" },
  { key: "ganho", label: "Ganho", kind: "won", color: "emerald" },
  { key: "perdido", label: "Perdido", kind: "lost", color: "rose" },
];

let schemaReady = false;

function normalizeKind(value: unknown): CommercialStageKind {
  return value === "entry" || value === "normal" || value === "won" || value === "lost"
    ? value
    : "normal";
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "etapa"
  );
}

function stageFromRow(row: FunnelStageRow): FunnelStage {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    kind: normalizeKind(row.kind),
    color: normalizeStageColorToken(row.color),
    position: row.position,
  };
}

async function ensureFunnelSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const pool = getPool();
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.funnels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      seller_ids INTEGER[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.funnel_stages (
      id SERIAL PRIMARY KEY,
      funnel_id INTEGER NOT NULL REFERENCES ${SCHEMA}.funnels(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('entry','normal','won','lost')),
      color TEXT NOT NULL DEFAULT 'slate',
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE (funnel_id, key)
    );
  `);

  // Semeia o funil padrão uma única vez, com as mesmas chaves que os leads
  // já usam hoje (novo/primeiro_contato/.../ganho/perdido) — assim nenhum
  // lead existente fica "orfão" de etapa.
  const existingDefault = await pool.query<{ id: number }>(
    `SELECT id FROM ${SCHEMA}.funnels WHERE is_default = true LIMIT 1`
  );

  let defaultFunnelId = existingDefault.rows[0]?.id ?? null;

  if (!defaultFunnelId) {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO ${SCHEMA}.funnels (name, is_default) VALUES ('Funil Padrão', true) RETURNING id`
    );
    defaultFunnelId = inserted.rows[0].id;

    for (const [index, stage] of DEFAULT_FUNNEL_STAGES.entries()) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.funnel_stages (funnel_id, key, label, kind, color, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [defaultFunnelId, stage.key, stage.label, stage.kind, stage.color, index]
      );
    }
  }

  // commercial_leads.funnel_id/commercial_stage_kind podem ainda não existir
  // se lib/commercial.ts ou lib/db.ts não rodaram ensure* ainda nesta conexão;
  // garante as colunas antes do backfill.
  await pool.query(`
    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS funnel_id INTEGER;
    ALTER TABLE ${SCHEMA}.commercial_leads ADD COLUMN IF NOT EXISTS commercial_stage_kind TEXT NOT NULL DEFAULT 'entry';
  `);

  await pool.query(
    `
      UPDATE ${SCHEMA}.commercial_leads
      SET funnel_id = $1,
          commercial_stage_kind = COALESCE(
            (SELECT kind FROM ${SCHEMA}.funnel_stages WHERE funnel_id = $1 AND key = commercial_stage),
            'entry'
          )
      WHERE funnel_id IS NULL
    `,
    [defaultFunnelId]
  );

  schemaReady = true;
}

function assertCanManageFunnels(user: DashboardUser | null | undefined): void {
  if (!isProductivityManager(user) && !hasPermission(user, "crm.manage_funnels")) {
    throw new Error("Voce nao tem permissao para gerenciar funis.");
  }
}

async function fetchFunnels(where = "", values: unknown[] = []): Promise<Funnel[]> {
  const pool = getPool();
  const funnelRes = await pool.query<FunnelRow>(
    `SELECT * FROM ${SCHEMA}.funnels ${where} ORDER BY is_default DESC, name ASC`,
    values
  );
  if (funnelRes.rows.length === 0) return [];

  const ids = funnelRes.rows.map((row) => row.id);
  const stageRes = await pool.query<FunnelStageRow>(
    `SELECT * FROM ${SCHEMA}.funnel_stages WHERE funnel_id = ANY($1::int[]) ORDER BY funnel_id, position ASC`,
    [ids]
  );
  const stagesByFunnel = new Map<number, FunnelStage[]>();
  for (const row of stageRes.rows) {
    const list = stagesByFunnel.get(row.funnel_id) ?? [];
    list.push(stageFromRow(row));
    stagesByFunnel.set(row.funnel_id, list);
  }

  return funnelRes.rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    sellerIds: row.seller_ids ?? [],
    stages: stagesByFunnel.get(row.id) ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function listFunnels(): Promise<Funnel[]> {
  await ensureFunnelSchema();
  return fetchFunnels();
}

/** Admin/supervisor ve todos os funis; vendedor comum so os que tem atribuidos (+ sempre o padrao, como fallback). */
export async function listFunnelsForUser(user: DashboardUser | null | undefined): Promise<Funnel[]> {
  await ensureFunnelSchema();
  const all = await fetchFunnels();
  if (isProductivityManager(user)) {
    return all;
  }
  const userId = typeof user?.id === "number" ? user.id : null;
  return all.filter((funnel) => funnel.isDefault || (userId !== null && funnel.sellerIds.includes(userId)));
}

export async function getFunnelById(id: number): Promise<Funnel | null> {
  await ensureFunnelSchema();
  const rows = await fetchFunnels(`WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getDefaultFunnel(): Promise<Funnel> {
  await ensureFunnelSchema();
  const rows = await fetchFunnels(`WHERE is_default = true`);
  if (!rows[0]) {
    throw new Error("Funil padrao nao encontrado.");
  }
  return rows[0];
}

export function findStageByKey(funnel: Funnel, key: string): FunnelStage | null {
  return funnel.stages.find((stage) => stage.key === key) ?? null;
}

export function findStageByKind(funnel: Funnel, kind: CommercialStageKind): FunnelStage | null {
  return funnel.stages.find((stage) => stage.kind === kind) ?? null;
}

function validateStageSet(stages: FunnelStageInput[]): void {
  if (stages.length === 0) {
    throw new Error("O funil precisa de pelo menos uma etapa.");
  }
  const entryCount = stages.filter((stage) => stage.kind === "entry").length;
  const wonCount = stages.filter((stage) => stage.kind === "won").length;
  const lostCount = stages.filter((stage) => stage.kind === "lost").length;
  if (entryCount !== 1) {
    throw new Error("O funil precisa de exatamente uma etapa de entrada.");
  }
  if (wonCount < 1) {
    throw new Error("O funil precisa de pelo menos uma etapa de ganho.");
  }
  if (lostCount < 1) {
    throw new Error("O funil precisa de pelo menos uma etapa de perda.");
  }
}

function uniqueKeyFor(label: string, taken: Set<string>): string {
  const base = slugify(label);
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

export async function createFunnel(
  user: DashboardUser | null | undefined,
  input: FunnelInput
): Promise<Funnel> {
  assertCanManageFunnels(user);
  await ensureFunnelSchema();

  const name = input.name.trim();
  if (!name) {
    throw new Error("Informe um nome para o funil.");
  }
  validateStageSet(input.stages);

  const pool = getPool();
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.funnels (name, seller_ids) VALUES ($1, $2) RETURNING id`,
    [name, Array.from(new Set(input.sellerIds ?? []))]
  );
  const funnelId = inserted.rows[0].id;

  const takenKeys = new Set<string>();
  for (const [index, stage] of input.stages.entries()) {
    const label = stage.label.trim() || `Etapa ${index + 1}`;
    const key = uniqueKeyFor(label, takenKeys);
    const color = stage.color ? normalizeStageColorToken(stage.color) : stageColorTokenForIndex(index);
    await pool.query(
      `INSERT INTO ${SCHEMA}.funnel_stages (funnel_id, key, label, kind, color, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [funnelId, key, label, stage.kind, color, index]
    );
  }

  const funnel = await getFunnelById(funnelId);
  if (!funnel) {
    throw new Error("Falha ao criar funil.");
  }
  return funnel;
}

export async function updateFunnel(
  user: DashboardUser | null | undefined,
  id: number,
  input: FunnelInput
): Promise<Funnel> {
  assertCanManageFunnels(user);
  await ensureFunnelSchema();

  const existing = await getFunnelById(id);
  if (!existing) {
    throw new Error("Funil nao encontrado.");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("Informe um nome para o funil.");
  }
  validateStageSet(input.stages);

  const pool = getPool();

  const keptIds = new Set(input.stages.map((stage) => stage.id).filter((sid): sid is number => sid !== null));
  const removedStages = existing.stages.filter((stage) => !keptIds.has(stage.id));

  if (removedStages.length > 0) {
    const removedKeys = removedStages.map((stage) => stage.key);
    const inUse = await pool.query<{ key: string; total: string }>(
      `SELECT commercial_stage AS key, COUNT(*)::text AS total
       FROM ${SCHEMA}.commercial_leads
       WHERE funnel_id = $1 AND commercial_stage = ANY($2::text[])
       GROUP BY commercial_stage`,
      [id, removedKeys]
    );
    if (inUse.rows.length > 0) {
      const details = inUse.rows.map((row) => `"${row.key}" (${row.total} lead(s))`).join(", ");
      throw new Error(`Nao e possivel remover etapas em uso: ${details}. Mova os leads antes.`);
    }
  }

  await pool.query(
    `UPDATE ${SCHEMA}.funnels SET name = $2, seller_ids = $3, updated_at = NOW() WHERE id = $1`,
    [id, name, Array.from(new Set(input.sellerIds ?? existing.sellerIds))]
  );

  if (removedStages.length > 0) {
    await pool.query(
      `DELETE FROM ${SCHEMA}.funnel_stages WHERE funnel_id = $1 AND id = ANY($2::int[])`,
      [id, removedStages.map((stage) => stage.id)]
    );
  }

  const takenKeys = new Set(
    input.stages
      .filter((stage) => stage.id !== null)
      .map((stage) => existing.stages.find((existingStage) => existingStage.id === stage.id)?.key)
      .filter((key): key is string => Boolean(key))
  );

  for (const [index, stage] of input.stages.entries()) {
    const label = stage.label.trim() || `Etapa ${index + 1}`;
    const color = stage.color ? normalizeStageColorToken(stage.color) : stageColorTokenForIndex(index);
    if (stage.id !== null) {
      await pool.query(
        `UPDATE ${SCHEMA}.funnel_stages SET label = $2, kind = $3, color = $4, position = $5 WHERE id = $1 AND funnel_id = $6`,
        [stage.id, label, stage.kind, color, index, id]
      );
    } else {
      const key = uniqueKeyFor(label, takenKeys);
      await pool.query(
        `INSERT INTO ${SCHEMA}.funnel_stages (funnel_id, key, label, kind, color, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, key, label, stage.kind, color, index]
      );
    }
  }

  const funnel = await getFunnelById(id);
  if (!funnel) {
    throw new Error("Falha ao atualizar funil.");
  }
  return funnel;
}

export async function deleteFunnel(user: DashboardUser | null | undefined, id: number): Promise<void> {
  assertCanManageFunnels(user);
  await ensureFunnelSchema();

  const funnel = await getFunnelById(id);
  if (!funnel) {
    return;
  }
  if (funnel.isDefault) {
    throw new Error("O funil padrao nao pode ser excluido.");
  }

  const pool = getPool();
  const inUse = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM ${SCHEMA}.commercial_leads WHERE funnel_id = $1`,
    [id]
  );
  const total = Number.parseInt(inUse.rows[0]?.total ?? "0", 10);
  if (total > 0) {
    throw new Error(`Este funil tem ${total} lead(s). Mova-os para outro funil antes de excluir.`);
  }

  await pool.query(`DELETE FROM ${SCHEMA}.funnels WHERE id = $1`, [id]);
}
