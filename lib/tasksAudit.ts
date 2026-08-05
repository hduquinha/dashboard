import { getPool } from "@/lib/db";
import { listWorkspaceBoards } from "@/lib/tasks";
import type { PermissionUser } from "@/lib/permissions";

const SCHEMA = "dashboard";

export interface TaskAuditEvent {
  id: number;
  taskId: number | null;
  taskTitle: string;
  boardId: number;
  boardName: string;
  sectorName: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  detail: Record<string, unknown>;
  fromColumnName: string | null;
  toColumnName: string | null;
  createdAt: string;
}

export interface TaskAuditFilters {
  from?: string | null;
  to?: string | null;
  boardId?: number | null;
  actions?: string[];
  actorEmail?: string | null;
  search?: string | null;
}

export interface TaskAuditSummary {
  totalEvents: number;
  cardsAffected: number;
  boardsAffected: number;
  activeActors: number;
}

export interface TaskAuditFilterOptions {
  boards: Array<{ id: number; name: string; sectorName: string }>;
  actions: string[];
  actors: Array<{ name: string; email: string }>;
}

export interface TaskAuditScope {
  boardIds: number[];
  boards: Array<{ id: number; name: string; sectorName: string }>;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function detailOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapEvent(row: Record<string, unknown>): TaskAuditEvent {
  return {
    id: Number(row.id),
    taskId: row.task_id === null || row.task_id === undefined ? null : Number(row.task_id),
    taskTitle: String(row.task_title || "Card removido"),
    boardId: Number(row.board_id),
    boardName: String(row.board_name || "Quadro removido"),
    sectorName: String(row.sector_name || "Setor removido"),
    actorName: (row.actor_name as string) ?? null,
    actorEmail: (row.actor_email as string) ?? null,
    action: String(row.action),
    detail: detailOf(row.detail),
    fromColumnName: (row.from_column_name as string) ?? null,
    toColumnName: (row.to_column_name as string) ?? null,
    createdAt: iso(row.created_at),
  };
}

/** Resolve os quadros que o usuário pode enxergar, antes de consultar o log. */
export async function getTaskAuditScope(user: PermissionUser | null | undefined): Promise<TaskAuditScope> {
  const boards = await listWorkspaceBoards(user);
  return {
    boardIds: boards.map((board) => board.id),
    boards: boards.map((board) => ({ id: board.id, name: board.name, sectorName: board.sectorName })),
  };
}

function scopedBoardIds(scope: TaskAuditScope, boardId?: number | null): number[] {
  if (!boardId) return scope.boardIds;
  return scope.boardIds.includes(boardId) ? [boardId] : [];
}

function buildWhere(
  scope: TaskAuditScope,
  filters: TaskAuditFilters
): { clause: string; values: unknown[]; boardIds: number[] } {
  const boardIds = scopedBoardIds(scope, filters.boardId);
  const values: unknown[] = [boardIds];
  const conditions = ["a.board_id = ANY($1::int[])"];

  if (filters.from) {
    values.push(filters.from);
    conditions.push(`a.created_at >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`a.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  if (filters.actions && filters.actions.length > 0) {
    values.push(filters.actions);
    conditions.push(`a.action = ANY($${values.length}::text[])`);
  }
  if (filters.actorEmail) {
    values.push(filters.actorEmail.trim().toLowerCase());
    conditions.push(`LOWER(COALESCE(a.actor_email, '')) = $${values.length}`);
  }
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    const parameter = `$${values.length}`;
    conditions.push(
      `(COALESCE(t.title, a.detail->>'title', '') ILIKE ${parameter}
        OR COALESCE(b.name, '') ILIKE ${parameter}
        OR COALESCE(a.actor_name, '') ILIKE ${parameter}
        OR COALESCE(a.actor_email, '') ILIKE ${parameter})`
    );
  }

  return { clause: conditions.join(" AND "), values, boardIds };
}

/** Lista unificada das ações de todos os cards e quadros acessíveis ao usuário. */
export async function getTaskAuditLog(
  scope: TaskAuditScope,
  filters: TaskAuditFilters,
  pagination: { limit: number; offset: number }
): Promise<{ events: TaskAuditEvent[]; hasMore: boolean }> {
  const { clause, values, boardIds } = buildWhere(scope, filters);
  if (boardIds.length === 0) return { events: [], hasMore: false };

  const limit = Math.max(1, Math.min(pagination.limit, 100));
  const offset = Math.max(0, pagination.offset);
  values.push(limit + 1, offset);
  const limitParameter = `$${values.length - 1}`;
  const offsetParameter = `$${values.length}`;

  const { rows } = await getPool().query(
    `SELECT
       a.*, t.title AS live_task_title,
       COALESCE(t.title, NULLIF(a.detail->>'title', ''), 'Card removido') AS task_title,
       b.name AS board_name,
       s.name AS sector_name,
       from_column.name AS from_column_name,
       to_column.name AS to_column_name
     FROM ${SCHEMA}.task_activity a
     JOIN ${SCHEMA}.task_boards b ON b.id = a.board_id
     JOIN ${SCHEMA}.task_sectors s ON s.id = b.sector_id
     LEFT JOIN ${SCHEMA}.tasks t ON t.id = a.task_id
     LEFT JOIN ${SCHEMA}.task_columns from_column
       ON from_column.id = CASE
         WHEN COALESCE(a.detail->>'fromColumnId', '') ~ '^\\d+$' THEN (a.detail->>'fromColumnId')::int
         ELSE NULL
       END
     LEFT JOIN ${SCHEMA}.task_columns to_column
       ON to_column.id = CASE
         WHEN COALESCE(a.detail->>'toColumnId', '') ~ '^\\d+$' THEN (a.detail->>'toColumnId')::int
         ELSE NULL
       END
     WHERE ${clause}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    values
  );

  const hasMore = rows.length > limit;
  return { events: rows.slice(0, limit).map(mapEvent), hasMore };
}

export async function getTaskAuditSummary(scope: TaskAuditScope, filters: TaskAuditFilters): Promise<TaskAuditSummary> {
  const { clause, values, boardIds } = buildWhere(scope, filters);
  if (boardIds.length === 0) return { totalEvents: 0, cardsAffected: 0, boardsAffected: 0, activeActors: 0 };

  const { rows } = await getPool().query(
    `SELECT
       COUNT(*) AS total_events,
       COUNT(DISTINCT a.task_id) AS cards_affected,
       COUNT(DISTINCT a.board_id) AS boards_affected,
       COUNT(DISTINCT NULLIF(LOWER(a.actor_email), '')) AS active_actors
     FROM ${SCHEMA}.task_activity a
     JOIN ${SCHEMA}.task_boards b ON b.id = a.board_id
     LEFT JOIN ${SCHEMA}.tasks t ON t.id = a.task_id
     WHERE ${clause}`,
    values
  );
  const row = rows[0] ?? {};
  return {
    totalEvents: Number(row.total_events ?? 0),
    cardsAffected: Number(row.cards_affected ?? 0),
    boardsAffected: Number(row.boards_affected ?? 0),
    activeActors: Number(row.active_actors ?? 0),
  };
}

export async function getTaskAuditFilterOptions(scope: TaskAuditScope): Promise<TaskAuditFilterOptions> {
  if (scope.boardIds.length === 0) return { boards: [], actions: [], actors: [] };

  const [actionsResult, actorsResult] = await Promise.all([
    getPool().query<{ action: string }>(
      `SELECT DISTINCT action
       FROM ${SCHEMA}.task_activity
       WHERE board_id = ANY($1::int[])
       ORDER BY action`,
      [scope.boardIds]
    ),
    getPool().query<{ actor_name: string | null; actor_email: string }>(
      `SELECT DISTINCT actor_name, actor_email
       FROM ${SCHEMA}.task_activity
       WHERE board_id = ANY($1::int[]) AND actor_email IS NOT NULL AND actor_email <> ''
       ORDER BY actor_name NULLS LAST, actor_email`,
      [scope.boardIds]
    ),
  ]);

  return {
    boards: scope.boards,
    actions: actionsResult.rows.map((row) => row.action),
    actors: actorsResult.rows.map((row) => ({ name: row.actor_name || row.actor_email, email: row.actor_email })),
  };
}
