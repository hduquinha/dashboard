import type { NextRequest } from "next/server";
import { getRequestDashboardSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { CATALOG_ENTITIES } from "@/lib/finance";
import type {
  FinanceAuditAction,
  FinanceAuditEvent,
  FinanceAuditFieldChange,
  FinanceAuditFilterOptions,
  FinanceAuditFilters,
  FinanceAuditSummary,
} from "@/types/financeAudit";

const SCHEMA = "dashboard";

let schemaReady = false;

/**
 * Registro de auditoria da Gestao Financeira: uma linha por acao que criou,
 * alterou ou excluiu qualquer lancamento. Guarda o estado ANTES e DEPOIS em
 * JSONB, para que a tela consiga abrir o item e mostrar campo a campo o que
 * mudou — inclusive de um registro ja excluido, que nao existe mais na tabela
 * de origem.
 */
async function ensureFinanceAuditSchema(): Promise<void> {
  if (schemaReady) return;

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_events (
      id BIGSERIAL PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id BIGINT,
      action TEXT NOT NULL,
      label TEXT,
      note TEXT,
      actor_name TEXT,
      actor_email TEXT,
      before_state JSONB,
      after_state JSONB,
      changes JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_finance_events_created ON ${SCHEMA}.finance_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_finance_events_entity ON ${SCHEMA}.finance_events(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_finance_events_actor ON ${SCHEMA}.finance_events(actor_email, created_at DESC);
  `);

  // Trava no banco, nao so no codigo: o evento que registra a remocao de outro
  // evento (action = 'purge') nao pode ser apagado por caminho nenhum — nem por
  // uma rota futura, nem por DELETE manual no psql. E o que sustenta a promessa
  // de que o registro nao pode ser limpo em silencio.
  await getPool().query(`
    CREATE OR REPLACE FUNCTION ${SCHEMA}.finance_events_block_purge_delete() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'Evento de remocao do registro de auditoria nao pode ser excluido (id %).', OLD.id;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_finance_events_block_purge_delete ON ${SCHEMA}.finance_events;

    CREATE TRIGGER trg_finance_events_block_purge_delete
      BEFORE DELETE ON ${SCHEMA}.finance_events
      FOR EACH ROW WHEN (OLD.action = 'purge')
      EXECUTE FUNCTION ${SCHEMA}.finance_events_block_purge_delete();
  `);

  schemaReady = true;
}

interface EntityDef {
  /** Tabela de origem; vazia quando o estado nao mora numa linha por id. */
  table: string;
  label: string;
}

const ENTITY_DEFS: Record<string, EntityDef> = {
  revenue: { table: "finance_revenues", label: "Receita" },
  revenue_payment: { table: "finance_revenue_payments", label: "Pagamento de receita" },
  fixed_expense: { table: "finance_fixed_expenses", label: "Despesa fixa" },
  variable_expense: { table: "finance_variable_expenses", label: "Despesa variável" },
  enrollment: { table: "finance_enrollments", label: "Matrícula" },
  commission: { table: "finance_commissions", label: "Comissão" },
  commission_installment: { table: "finance_commission_installments", label: "Parcela de comissão" },
  branch_item: { table: "finance_branch_items", label: "Item da unidade" },
  settings: { table: "", label: "Configuração financeira" },
  installment_rates: { table: "", label: "Taxas de parcelamento" },
  audit_event: { table: "", label: "Registro de auditoria" },
};

const CATALOG_LABELS: Record<string, string> = {
  categories: "Categoria",
  "payment-methods": "Forma de pagamento",
  courses: "Curso",
  branches: "Filial",
  employees: "Funcionário",
  sellers: "Vendedor",
  "card-brands": "Bandeira de cartão",
};

/** Entidades de catalogo entram como `catalog:<entity>` para reusar a mesma tabela de eventos. */
export function catalogAuditEntity(entity: string): string {
  return `catalog:${entity}`;
}

function resolveEntity(entity: string): EntityDef {
  if (entity.startsWith("catalog:")) {
    const key = entity.slice("catalog:".length);
    return {
      table: CATALOG_ENTITIES[key]?.table ?? "",
      label: CATALOG_LABELS[key] ?? "Catálogo",
    };
  }
  return ENTITY_DEFS[entity] ?? { table: "", label: entity };
}

export function financeEntityLabel(entity: string): string {
  return resolveEntity(entity).label;
}

/** Colunas que nunca entram no snapshot: binario do comprovante (BYTEA). */
const IGNORED_COLUMNS = new Set(["invoice_file"]);
/** Colunas ignoradas na comparacao: mudam sozinhas em toda gravacao. */
const IGNORED_ON_DIFF = new Set(["updated_at"]);

type Snapshot = Record<string, unknown>;

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  return value;
}

async function readRowSnapshot(entity: string, entityId: number): Promise<Snapshot | null> {
  const def = resolveEntity(entity);
  if (!def.table) return null;

  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT * FROM ${SCHEMA}.${def.table} WHERE id = $1`,
    [entityId]
  );
  const row = rows[0];
  if (!row) return null;

  const snapshot: Snapshot = {};
  for (const [key, value] of Object.entries(row)) {
    if (IGNORED_COLUMNS.has(key)) continue;
    snapshot[key] = normalizeValue(value);
  }
  return snapshot;
}

function diffSnapshots(before: Snapshot | null, after: Snapshot | null): FinanceAuditFieldChange[] {
  if (!before || !after) return [];

  const changes: FinanceAuditFieldChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (IGNORED_ON_DIFF.has(key)) continue;
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    // Numeric do Postgres volta como string; comparar em texto evita
    // "12.00" != 12 aparecer como mudanca que nao houve.
    if (String(from) === String(to)) continue;
    changes.push({ field: key, before: from, after: to });
  }
  return changes.sort((a, b) => a.field.localeCompare(b.field));
}

/** Rotulo legivel do item, a partir dos proprios campos de texto da linha. */
function describeSnapshot(entity: string, snapshot: Snapshot | null, entityId: number | null): string {
  const def = resolveEntity(entity);
  const parts: string[] = [def.label];

  if (snapshot) {
    const name = ["description", "student", "item", "name", "key"]
      .map((field) => snapshot[field])
      .find((value) => typeof value === "string" && value.trim().length > 0) as string | undefined;
    if (name) parts.push(name.trim());

    const amount = ["amount", "total_amount", "total_commission", "sale_amount", "value"]
      .map((field) => snapshot[field])
      .find((value) => value !== null && value !== undefined);
    if (amount !== undefined) {
      const numeric = Number(amount);
      if (Number.isFinite(numeric)) {
        parts.push(
          numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        );
      }
    }
  } else if (entityId) {
    parts.push(`#${entityId}`);
  }

  return parts.join(" · ");
}

/**
 * Estado das configuracoes financeiras (saldo inicial, taxa de boleto). Nao
 * ha "linha por id" aqui — o registro guarda o mapa chave→valor inteiro.
 */
export async function readFinanceSettingsState(): Promise<Snapshot> {
  const { rows } = await getPool().query<{ key: string; value: unknown }>(
    `SELECT key, value FROM ${SCHEMA}.finance_settings ORDER BY key`
  );
  const state: Snapshot = {};
  for (const row of rows) state[row.key] = normalizeValue(row.value);
  return state;
}

/** Estado da tabela de taxas de parcelamento, indexado por bandeira + parcelas. */
export async function readInstallmentRatesState(): Promise<Snapshot> {
  const { rows } = await getPool().query<{
    installments: number;
    brand_id: number | null;
    rate_pct: string | number;
  }>(
    `SELECT installments, brand_id, rate_pct FROM ${SCHEMA}.finance_installment_rates
     ORDER BY brand_id NULLS FIRST, installments`
  );
  const state: Snapshot = {};
  for (const row of rows) {
    const key = `${row.brand_id === null ? "padrao" : `bandeira ${row.brand_id}`} · ${row.installments}x`;
    state[key] = normalizeValue(row.rate_pct);
  }
  return state;
}

interface AuditSpec {
  entity: string;
  action: FinanceAuditAction;
  /** Obrigatorio em update/delete/attach; em create vem do retorno da acao. */
  entityId?: number | null;
  /** Complemento livre: nome do arquivo anexado, chave da configuracao etc. */
  note?: string | null;
  /** Leitura alternativa do estado (configuracoes e taxas nao tem linha por id). */
  readState?: () => Promise<Snapshot | null>;
  /** Extrai o id quando a criacao nao devolve o numero direto (ex.: { id, revenue }). */
  resolveId?: (result: unknown) => number | null;
}

async function readState(spec: AuditSpec, entityId: number | null): Promise<Snapshot | null> {
  if (spec.readState) return spec.readState();
  if (entityId === null) return null;
  return readRowSnapshot(spec.entity, entityId);
}

/**
 * Executa a acao financeira e registra o antes/depois. Nunca falha por causa
 * da auditoria: erro ao gravar o evento e logado, mas o resultado da operacao
 * (que ja aconteceu no banco) e devolvido normalmente.
 */
export async function auditFinance<T>(
  request: NextRequest,
  spec: AuditSpec,
  run: () => Promise<T>
): Promise<T> {
  const user = getRequestDashboardSession(request)?.user ?? null;

  let before: Snapshot | null = null;
  if (spec.action !== "create") {
    before = await readState(spec, spec.entityId ?? null).catch(() => null);
  }

  const result = await run();

  try {
    // Em create o id so existe depois da acao — as funcoes de criacao do
    // lib/finance devolvem o id novo (direto ou dentro de um objeto).
    let entityId = spec.entityId ?? null;
    if (spec.action === "create") {
      if (spec.resolveId) entityId = spec.resolveId(result);
      else if (typeof result === "number") entityId = result;
    }

    const after = spec.action === "delete" ? null : await readState(spec, entityId).catch(() => null);
    const changes = spec.action === "update" || spec.action === "attach" || spec.action === "status"
      ? diffSnapshots(before, after)
      : [];

    await recordFinanceEvent({
      entity: spec.entity,
      entityId,
      action: spec.action,
      label: describeSnapshot(spec.entity, after ?? before, entityId),
      note: spec.note ?? null,
      actorName: user?.name ?? null,
      actorEmail: user?.email ?? null,
      before,
      after,
      changes,
    });
  } catch (error) {
    console.error("[finance-audit] falha ao registrar evento:", error);
  }

  return result;
}

interface RecordInput {
  entity: string;
  entityId: number | null;
  action: FinanceAuditAction;
  label: string | null;
  note: string | null;
  actorName: string | null;
  actorEmail: string | null;
  before: Snapshot | null;
  after: Snapshot | null;
  changes: FinanceAuditFieldChange[];
}

export async function recordFinanceEvent(input: RecordInput): Promise<void> {
  await ensureFinanceAuditSchema();

  await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_events
       (entity, entity_id, action, label, note, actor_name, actor_email, before_state, after_state, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      input.entity,
      input.entityId,
      input.action,
      input.label,
      input.note,
      input.actorName,
      input.actorEmail,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      JSON.stringify(input.changes),
    ]
  );
}

// ── Leitura ────────────────────────────────────────────────────────

function buildWhere(filters: FinanceAuditFilters): { clause: string; values: unknown[] } {
  const conditions: string[] = ["TRUE"];
  const values: unknown[] = [];

  if (filters.from) {
    values.push(filters.from);
    conditions.push(`e.created_at >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`e.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  if (filters.entities && filters.entities.length > 0) {
    values.push(filters.entities);
    conditions.push(`e.entity = ANY($${values.length}::text[])`);
  }
  if (filters.actions && filters.actions.length > 0) {
    values.push(filters.actions);
    conditions.push(`e.action = ANY($${values.length}::text[])`);
  }
  if (filters.actorEmail) {
    values.push(filters.actorEmail.toLowerCase());
    conditions.push(`LOWER(e.actor_email) = $${values.length}`);
  }
  if (filters.search) {
    const term = filters.search.trim();
    if (term) {
      values.push(`%${term}%`);
      const likeIdx = values.length;
      if (/^\d+$/.test(term)) {
        values.push(Number.parseInt(term, 10));
        conditions.push(`(e.label ILIKE $${likeIdx} OR e.note ILIKE $${likeIdx} OR e.entity_id = $${values.length})`);
      } else {
        conditions.push(`(e.label ILIKE $${likeIdx} OR e.note ILIKE $${likeIdx})`);
      }
    }
  }

  return { clause: conditions.join("\n       AND "), values };
}

interface EventRow {
  id: number;
  entity: string;
  entity_id: number | null;
  action: string;
  label: string | null;
  note: string | null;
  actor_name: string | null;
  actor_email: string | null;
  changes: FinanceAuditFieldChange[] | null;
  before_state: Snapshot | null;
  after_state: Snapshot | null;
  created_at: Date | string;
}

function mapEvent(row: EventRow, withState: boolean): FinanceAuditEvent {
  return {
    id: Number(row.id),
    entity: row.entity,
    entityLabel: financeEntityLabel(row.entity),
    entityId: row.entity_id === null ? null : Number(row.entity_id),
    action: row.action as FinanceAuditAction,
    label: row.label,
    note: row.note,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    changes: Array.isArray(row.changes) ? row.changes : [],
    before: withState ? row.before_state : null,
    after: withState ? row.after_state : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getFinanceAuditLog(
  filters: FinanceAuditFilters,
  pagination: { limit?: number; offset?: number } = {}
): Promise<{ events: FinanceAuditEvent[]; hasMore: boolean }> {
  await ensureFinanceAuditSchema();

  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 200);
  const offset = Math.max(pagination.offset ?? 0, 0);
  const { clause, values } = buildWhere(filters);

  // limit + 1 detecta a proxima pagina sem um COUNT extra.
  values.push(limit + 1, offset);
  const limitIdx = values.length - 1;
  const offsetIdx = values.length;

  // before_state/after_state ficam fora da listagem (payload grande); a tela
  // busca o detalhe do evento quando o usuario abre o item.
  const { rows } = await getPool().query<EventRow>(
    `SELECT e.id, e.entity, e.entity_id, e.action, e.label, e.note,
            e.actor_name, e.actor_email, e.changes, e.created_at,
            NULL::jsonb AS before_state, NULL::jsonb AS after_state
     FROM ${SCHEMA}.finance_events e
     WHERE ${clause}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    values
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return { events: page.map((row) => mapEvent(row, false)), hasMore };
}

export async function getFinanceAuditEvent(id: number): Promise<FinanceAuditEvent | null> {
  await ensureFinanceAuditSchema();

  const { rows } = await getPool().query<EventRow>(
    `SELECT e.id, e.entity, e.entity_id, e.action, e.label, e.note,
            e.actor_name, e.actor_email, e.changes, e.created_at,
            e.before_state, e.after_state
     FROM ${SCHEMA}.finance_events e
     WHERE e.id = $1`,
    [id]
  );

  return rows[0] ? mapEvent(rows[0], true) : null;
}

const ACTION_LABELS_PT: Record<string, string> = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
  attach: "Comprovante",
  status: "Mudança de status",
  purge: "Remoção de evento",
};

export interface DeleteAuditEventResult {
  removedId: number;
  purgeEventId: number;
}

/**
 * Remove UM evento do registro e grava, no lugar, um evento `purge` contando
 * o que foi removido e por quem. O evento de remocao nao pode ser apagado
 * (trigger no banco), entao o registro nunca fica vazio em silencio.
 *
 * O rastro guarda a identificacao do evento removido — tipo, item, autor, data
 * e quantos campos haviam mudado — mas nao o antes/depois completo: senao a
 * exclusao nao excluiria nada.
 */
export async function deleteFinanceAuditEvent(
  eventId: number,
  actor: { name?: string | null; email?: string | null },
  reason?: string | null
): Promise<DeleteAuditEventResult> {
  await ensureFinanceAuditSchema();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<EventRow>(
      `SELECT e.id, e.entity, e.entity_id, e.action, e.label, e.note,
              e.actor_name, e.actor_email, e.changes, e.created_at,
              NULL::jsonb AS before_state, NULL::jsonb AS after_state
       FROM ${SCHEMA}.finance_events e
       WHERE e.id = $1
       FOR UPDATE`,
      [eventId]
    );

    const row = rows[0];
    if (!row) throw new Error("Evento não encontrado.");
    if (row.action === "purge") {
      throw new Error("Evento de remoção não pode ser excluído do registro.");
    }

    const removed = mapEvent(row, false);
    const trace: Snapshot = {
      evento_removido: removed.id,
      acao: ACTION_LABELS_PT[removed.action] ?? removed.action,
      tipo: removed.entityLabel,
      item: removed.label,
      item_id: removed.entityId,
      autor_original: removed.actorName || removed.actorEmail || "não identificado",
      registrado_em: removed.createdAt,
      campos_alterados: removed.changes.length,
      observacao_original: removed.note,
    };

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO ${SCHEMA}.finance_events
         (entity, entity_id, action, label, note, actor_name, actor_email, before_state, after_state, changes)
       VALUES ('audit_event', $1, 'purge', $2, $3, $4, $5, $6::jsonb, NULL, '[]'::jsonb)
       RETURNING id`,
      [
        removed.id,
        `Evento #${removed.id} removido · ${removed.label ?? removed.entityLabel}`,
        reason?.trim() || null,
        actor.name ?? null,
        actor.email ?? null,
        JSON.stringify(trace),
      ]
    );

    await client.query(`DELETE FROM ${SCHEMA}.finance_events WHERE id = $1`, [eventId]);
    await client.query("COMMIT");

    return { removedId: eventId, purgeEventId: Number(inserted.rows[0].id) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getFinanceAuditSummary(
  filters: FinanceAuditFilters
): Promise<FinanceAuditSummary> {
  await ensureFinanceAuditSchema();
  const { clause, values } = buildWhere(filters);

  const [totals, byAction, byEntity, byActor] = await Promise.all([
    getPool().query<{ total: string; items: string; actors: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(DISTINCT (e.entity, e.entity_id))::text AS items,
              COUNT(DISTINCT e.actor_email)::text AS actors
       FROM ${SCHEMA}.finance_events e
       WHERE ${clause}`,
      values
    ),
    getPool().query<{ action: string; count: string }>(
      `SELECT e.action, COUNT(*)::text AS count
       FROM ${SCHEMA}.finance_events e
       WHERE ${clause}
       GROUP BY e.action
       ORDER BY COUNT(*) DESC`,
      values
    ),
    getPool().query<{ entity: string; count: string }>(
      `SELECT e.entity, COUNT(*)::text AS count
       FROM ${SCHEMA}.finance_events e
       WHERE ${clause}
       GROUP BY e.entity
       ORDER BY COUNT(*) DESC`,
      values
    ),
    getPool().query<{ actor_email: string | null; actor_name: string | null; count: string }>(
      `SELECT e.actor_email, MAX(e.actor_name) AS actor_name, COUNT(*)::text AS count
       FROM ${SCHEMA}.finance_events e
       WHERE ${clause}
       GROUP BY e.actor_email
       ORDER BY COUNT(*) DESC
       LIMIT 20`,
      values
    ),
  ]);

  return {
    totalEvents: Number(totals.rows[0]?.total ?? 0),
    itemsAffected: Number(totals.rows[0]?.items ?? 0),
    activeActors: Number(totals.rows[0]?.actors ?? 0),
    byAction: byAction.rows.map((row) => ({ action: row.action as FinanceAuditAction, count: Number(row.count) })),
    byEntity: byEntity.rows.map((row) => ({
      entity: row.entity,
      entityLabel: financeEntityLabel(row.entity),
      count: Number(row.count),
    })),
    byActor: byActor.rows.map((row) => ({
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      count: Number(row.count),
    })),
  };
}

/** Opcoes dos seletores: tudo que ja apareceu no registro, independente do recorte. */
export async function getFinanceAuditFilterOptions(): Promise<FinanceAuditFilterOptions> {
  await ensureFinanceAuditSchema();

  const [actors, entities] = await Promise.all([
    getPool().query<{ actor_email: string; actor_name: string | null; count: string }>(
      `SELECT e.actor_email, MAX(e.actor_name) AS actor_name, COUNT(*)::text AS count
       FROM ${SCHEMA}.finance_events e
       WHERE e.actor_email IS NOT NULL
       GROUP BY e.actor_email
       ORDER BY COUNT(*) DESC`
    ),
    getPool().query<{ entity: string; count: string }>(
      `SELECT e.entity, COUNT(*)::text AS count
       FROM ${SCHEMA}.finance_events e
       GROUP BY e.entity
       ORDER BY COUNT(*) DESC`
    ),
  ]);

  return {
    actors: actors.rows.map((row) => ({
      email: row.actor_email,
      name: row.actor_name,
      count: Number(row.count),
    })),
    entities: entities.rows.map((row) => ({
      entity: row.entity,
      entityLabel: financeEntityLabel(row.entity),
      count: Number(row.count),
    })),
  };
}
