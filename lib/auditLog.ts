import { getPool } from "@/lib/db";

const SCHEMA = "dashboard";

/**
 * Registro de auditoria GLOBAL — lê `dashboard.commercial_events` (o mesmo
 * histórico que alimenta a linha do tempo de cada lead) sem filtrar por lead,
 * cruzando com a inscrição (nome/telefone) e com o vendedor responsável. É a
 * base da tela "Registro de Auditoria" do master: ver qualquer mudança de
 * qualquer lead, por quem e quando.
 *
 * Reordenações dentro da mesma coluna do Kanban (stage_changed com from = to)
 * ficam de fora — não são uma mudança real, só arrastar o card no mesmo lugar,
 * exatamente como a linha do tempo do lead já as ignora.
 */

export interface AuditLogEvent {
  id: number;
  type: string;
  fromStage: string | null;
  toStage: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  leadId: number;
  leadName: string | null;
  leadPhone: string | null;
  sellerName: string | null;
}

export interface AuditLogFilters {
  from?: string | null; // YYYY-MM-DD
  to?: string | null; // YYYY-MM-DD
  types?: string[];
  actorEmail?: string | null;
  search?: string | null; // nome / telefone / #id do lead
}

export interface AuditSummary {
  totalEvents: number;
  leadsAffected: number;
  activeActors: number;
  byType: Array<{ type: string; count: number }>;
  byActor: Array<{ actorEmail: string | null; actorName: string | null; count: number }>;
}

export interface AuditFilterOptions {
  actors: Array<{ email: string; name: string | null; count: number }>;
  types: Array<{ type: string; count: number }>;
}

const NOOP_STAGE_CLAUSE = `NOT (e.event_type = 'stage_changed' AND e.from_stage IS NOT DISTINCT FROM e.to_stage)`;

/** Monta o WHERE (com os mesmos placeholders) reaproveitado pelo feed e pelo
 * resumo, para os dois enxergarem exatamente o mesmo conjunto de eventos. */
function buildWhere(filters: AuditLogFilters): { clause: string; values: unknown[] } {
  const conditions: string[] = [NOOP_STAGE_CLAUSE];
  const values: unknown[] = [];

  if (filters.from) {
    values.push(filters.from);
    conditions.push(`e.created_at >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`e.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  if (filters.types && filters.types.length > 0) {
    values.push(filters.types);
    conditions.push(`e.event_type = ANY($${values.length}::text[])`);
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
      const digits = term.replace(/\D/g, "");
      if (/^\d+$/.test(term)) {
        values.push(Number.parseInt(term, 10));
        conditions.push(
          `(i.payload->>'nome' ILIKE $${likeIdx} OR i.payload->>'telefone' ILIKE $${likeIdx} OR e.inscricao_id = $${values.length})`
        );
      } else if (digits.length >= 4) {
        values.push(`%${digits}%`);
        conditions.push(
          `(i.payload->>'nome' ILIKE $${likeIdx} OR regexp_replace(COALESCE(i.payload->>'telefone',''), '\\D', '', 'g') ILIKE $${values.length})`
        );
      } else {
        conditions.push(`i.payload->>'nome' ILIKE $${likeIdx}`);
      }
    }
  }

  return { clause: conditions.join("\n        AND "), values };
}

const FROM_JOINS = `
  FROM ${SCHEMA}.commercial_events e
  LEFT JOIN inscricoes.inscricoes i ON i.id = e.inscricao_id
  LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = e.inscricao_id`;

export async function getAuditLog(
  filters: AuditLogFilters,
  pagination: { limit?: number; offset?: number } = {}
): Promise<{ events: AuditLogEvent[]; hasMore: boolean }> {
  const pool = getPool();
  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 200);
  const offset = Math.max(pagination.offset ?? 0, 0);
  const { clause, values } = buildWhere(filters);

  // limit + 1 detecta se há próxima página sem um COUNT extra.
  values.push(limit + 1, offset);
  const limitIdx = values.length - 1;
  const offsetIdx = values.length;

  const { rows } = await pool.query<{
    id: number;
    event_type: string;
    from_stage: string | null;
    to_stage: string | null;
    actor_name: string | null;
    actor_email: string | null;
    payload: Record<string, unknown> | null;
    created_at: Date | string;
    inscricao_id: number;
    lead_name: string | null;
    lead_phone: string | null;
    seller_name: string | null;
  }>(
    `SELECT e.id, e.event_type, e.from_stage, e.to_stage, e.actor_name, e.actor_email,
            e.payload, e.created_at, e.inscricao_id,
            COALESCE(NULLIF(TRIM(i.payload->>'nome'), ''), NULLIF(TRIM(i.payload->>'name'), '')) AS lead_name,
            i.payload->>'telefone' AS lead_phone,
            cl.assigned_seller_name AS seller_name
     ${FROM_JOINS}
     WHERE ${clause}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    values
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    events: page.map((row) => ({
      id: row.id,
      type: row.event_type,
      fromStage: row.from_stage,
      toStage: row.to_stage,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      payload: row.payload ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      leadId: row.inscricao_id,
      leadName: row.lead_name,
      leadPhone: row.lead_phone,
      sellerName: row.seller_name,
    })),
    hasMore,
  };
}

export async function getAuditSummary(filters: AuditLogFilters): Promise<AuditSummary> {
  const pool = getPool();
  const { clause, values } = buildWhere(filters);

  const [totals, byType, byActor] = await Promise.all([
    pool.query<{ total: string; leads: string; actors: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(DISTINCT e.inscricao_id)::text AS leads,
              COUNT(DISTINCT e.actor_email)::text AS actors
       ${FROM_JOINS}
       WHERE ${clause}`,
      values
    ),
    pool.query<{ event_type: string; count: string }>(
      `SELECT e.event_type, COUNT(*)::text AS count
       ${FROM_JOINS}
       WHERE ${clause}
       GROUP BY e.event_type
       ORDER BY COUNT(*) DESC`,
      values
    ),
    pool.query<{ actor_email: string | null; actor_name: string | null; count: string }>(
      `SELECT e.actor_email, MAX(e.actor_name) AS actor_name, COUNT(*)::text AS count
       ${FROM_JOINS}
       WHERE ${clause}
       GROUP BY e.actor_email
       ORDER BY COUNT(*) DESC
       LIMIT 20`,
      values
    ),
  ]);

  return {
    totalEvents: Number(totals.rows[0]?.total ?? 0),
    leadsAffected: Number(totals.rows[0]?.leads ?? 0),
    activeActors: Number(totals.rows[0]?.actors ?? 0),
    byType: byType.rows.map((r) => ({ type: r.event_type, count: Number(r.count) })),
    byActor: byActor.rows.map((r) => ({
      actorEmail: r.actor_email,
      actorName: r.actor_name,
      count: Number(r.count),
    })),
  };
}

/** Opções fixas dos seletores (todos os atores e tipos que já existiram), para
 * o filtro sempre mostrar as escolhas possíveis independentemente do recorte. */
export async function getAuditFilterOptions(): Promise<AuditFilterOptions> {
  const pool = getPool();
  const [actors, types] = await Promise.all([
    pool.query<{ actor_email: string; actor_name: string | null; count: string }>(
      `SELECT e.actor_email, MAX(e.actor_name) AS actor_name, COUNT(*)::text AS count
       FROM ${SCHEMA}.commercial_events e
       WHERE e.actor_email IS NOT NULL AND ${NOOP_STAGE_CLAUSE}
       GROUP BY e.actor_email
       ORDER BY COUNT(*) DESC`
    ),
    pool.query<{ event_type: string; count: string }>(
      `SELECT e.event_type, COUNT(*)::text AS count
       FROM ${SCHEMA}.commercial_events e
       WHERE ${NOOP_STAGE_CLAUSE}
       GROUP BY e.event_type
       ORDER BY COUNT(*) DESC`
    ),
  ]);

  return {
    actors: actors.rows.map((r) => ({ email: r.actor_email, name: r.actor_name, count: Number(r.count) })),
    types: types.rows.map((r) => ({ type: r.event_type, count: Number(r.count) })),
  };
}
