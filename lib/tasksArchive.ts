import { getPool } from "@/lib/db";
import { ensureTasksSchema, listWorkspaceBoards } from "@/lib/tasks";
import { markdownToPlainText } from "@/lib/taskMarkdown";
import type { PermissionUser } from "@/lib/permissions";

const SCHEMA = "dashboard";

/**
 * Arquivo mensal das tarefas concluídas.
 *
 * A regra combinada com o time: quando o mês vira, tudo que foi concluído no mês
 * anterior sai do kanban (`archived = true`) e passa a ser consultado aqui, por
 * mês. O quadro fica com o mês corrente; o histórico continua inteiro, só que
 * fora do caminho.
 *
 * Duas escolhas que valem explicar:
 *
 * 1. O mês de um card é o do `completed_at`, NÃO o do `archived_at`. Lançamento
 *    retroativo é rotina aqui (a equipe manda o relatório do dia dias depois) —
 *    agrupar pela data em que a máquina arquivou jogaria o trabalho de agosto
 *    dentro de setembro.
 * 2. A consulta lista card concluído de qualquer mês, arquivado ou não. Assim o
 *    mês corrente — que ainda está no quadro — aparece no mesmo seletor, e a
 *    tela responde "o que a equipe entregou no mês X" sem depender de o
 *    arquivamento já ter rodado.
 */

/** Fuso do negócio: o corte do mês é o de Brasília, não o UTC do servidor. */
const LOCAL = "AT TIME ZONE 'America/Sao_Paulo'";

export interface TaskArchiveScope {
  boardIds: number[];
  boards: Array<{ id: number; name: string; sectorName: string }>;
}

export interface TaskArchiveFilters {
  /** "YYYY-MM"; vazio = todos os meses. */
  month?: string | null;
  boardId?: number | null;
  memberId?: number | null;
  search?: string | null;
}

export interface ArchivedTaskRow {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  boardId: number;
  boardName: string;
  sectorName: string;
  columnName: string | null;
  /** Dia da conclusão em Brasília ("YYYY-MM-DD"). */
  completedDay: string;
  completedAt: string;
  dueDate: string | null;
  dueTime: string | null;
  month: string;
  archived: boolean;
  assignees: string[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  attachmentCount: number;
  inscricaoId: number | null;
}

export interface ArchiveMonth {
  month: string;
  total: number;
  archived: number;
}

export interface ArchiveSummary {
  total: number;
  archived: number;
  onBoard: number;
  boards: number;
  byMember: Array<{ memberId: number | null; name: string; count: number }>;
}

// ── Fechamento automático ────────────────────────────────────────────────────

/**
 * Arquiva as tarefas concluídas em meses já fechados. Roda dentro do ciclo de 5
 * minutos das automações: é um UPDATE de alcance estreito que devolve 0 linhas
 * no resto do mês, e no dia 1º limpa o quadro sozinho.
 */
export async function archiveClosedMonths(): Promise<{ archived: number }> {
  await ensureTasksSchema();
  const pool = getPool();

  const { rows } = await pool.query<{ id: number; board_id: number; title: string; month: string }>(
    `UPDATE ${SCHEMA}.tasks t
        SET archived = true,
            archived_at = NOW(),
            updated_at = NOW()
      WHERE NOT t.archived
        AND NOT t.is_template
        AND t.completed_at IS NOT NULL
        AND (t.completed_at ${LOCAL}) < date_trunc('month', (NOW() ${LOCAL}))
      RETURNING t.id, t.board_id, t.title,
                to_char(t.completed_at ${LOCAL}, 'YYYY-MM') AS month`
  );

  if (rows.length > 0) {
    // Um evento por card, com o motivo: sem isso o card some do quadro e a
    // auditoria não explica por quê.
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_activity (task_id, board_id, actor_name, action, detail)
       SELECT x.id, x.board_id, 'Sistema', 'card_archived',
              jsonb_build_object('title', x.title, 'motivo', 'fechamento mensal', 'mes', x.month)
         FROM jsonb_to_recordset($1::jsonb) AS x(id int, board_id int, title text, month text)`,
      [JSON.stringify(rows)]
    );
  }

  return { archived: rows.length };
}

// ── Consulta ─────────────────────────────────────────────────────────────────

/** Quadros que o usuário enxerga — o arquivo nunca mostra card fora do escopo dele. */
export async function getTaskArchiveScope(user: PermissionUser | null | undefined): Promise<TaskArchiveScope> {
  const boards = await listWorkspaceBoards(user);
  return {
    boardIds: boards.map((board) => board.id),
    boards: boards.map((board) => ({ id: board.id, name: board.name, sectorName: board.sectorName })),
  };
}

function buildWhere(
  scope: TaskArchiveScope,
  filters: TaskArchiveFilters
): { clause: string; values: unknown[]; empty: boolean } {
  const boardIds = filters.boardId
    ? scope.boardIds.filter((id) => id === Number(filters.boardId))
    : scope.boardIds;
  if (boardIds.length === 0) return { clause: "FALSE", values: [], empty: true };

  const values: unknown[] = [boardIds];
  const conditions = [
    "t.board_id = ANY($1::int[])",
    "NOT t.is_template",
    "t.completed_at IS NOT NULL",
  ];

  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    values.push(filters.month);
    conditions.push(`to_char(t.completed_at ${LOCAL}, 'YYYY-MM') = $${values.length}`);
  }
  if (filters.memberId) {
    values.push(Number(filters.memberId));
    conditions.push(
      `EXISTS (SELECT 1 FROM ${SCHEMA}.task_assignees a2 WHERE a2.task_id = t.id AND a2.member_id = $${values.length})`
    );
  }
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    conditions.push(
      `(t.title ILIKE $${values.length} OR COALESCE(t.description, '') ILIKE $${values.length})`
    );
  }

  return { clause: conditions.join(" AND "), values, empty: false };
}

/** Meses que têm tarefa concluída, do mais novo para o mais antigo. */
export async function listArchiveMonths(scope: TaskArchiveScope): Promise<ArchiveMonth[]> {
  await ensureTasksSchema();
  if (scope.boardIds.length === 0) return [];

  const { rows } = await getPool().query<{ month: string; total: string; archived: string }>(
    `SELECT to_char(t.completed_at ${LOCAL}, 'YYYY-MM') AS month,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.archived) AS archived
       FROM ${SCHEMA}.tasks t
      WHERE t.board_id = ANY($1::int[]) AND NOT t.is_template AND t.completed_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC`,
    [scope.boardIds]
  );

  return rows.map((row) => ({
    month: row.month,
    total: Number(row.total),
    archived: Number(row.archived),
  }));
}

const ROW_SELECT = `
  SELECT t.id, t.title, t.description, t.priority, t.board_id, t.archived,
         t.due_date, t.due_time, t.inscricao_id, t.completed_at,
         to_char(t.completed_at ${LOCAL}, 'YYYY-MM-DD') AS completed_day,
         to_char(t.completed_at ${LOCAL}, 'YYYY-MM') AS month,
         b.name AS board_name, s.name AS sector_name, c.name AS column_name,
         COALESCE(array_agg(DISTINCT m.name) FILTER (WHERE m.name IS NOT NULL), '{}') AS assignees,
         (SELECT COUNT(*) FROM ${SCHEMA}.task_checklist_items ci
            JOIN ${SCHEMA}.task_checklists cl ON cl.id = ci.checklist_id WHERE cl.task_id = t.id) AS checklist_total,
         (SELECT COUNT(*) FROM ${SCHEMA}.task_checklist_items ci
            JOIN ${SCHEMA}.task_checklists cl ON cl.id = ci.checklist_id WHERE cl.task_id = t.id AND ci.done) AS checklist_done,
         (SELECT COUNT(*) FROM ${SCHEMA}.task_comments cm WHERE cm.task_id = t.id) AS comment_count,
         (SELECT COUNT(*) FROM ${SCHEMA}.task_attachments at WHERE at.task_id = t.id) AS attachment_count
    FROM ${SCHEMA}.tasks t
    JOIN ${SCHEMA}.task_boards b ON b.id = t.board_id
    JOIN ${SCHEMA}.task_sectors s ON s.id = b.sector_id
    LEFT JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
    LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
    LEFT JOIN ${SCHEMA}.team_members m ON m.id = a.member_id`;

function mapRow(r: Record<string, unknown>): ArchivedTaskRow {
  return {
    id: Number(r.id),
    title: String(r.title),
    description: (r.description as string) ?? null,
    priority: String(r.priority),
    boardId: Number(r.board_id),
    boardName: String(r.board_name),
    sectorName: String(r.sector_name),
    columnName: (r.column_name as string) ?? null,
    completedDay: String(r.completed_day),
    completedAt: new Date(r.completed_at as string).toISOString(),
    dueDate: r.due_date ? new Date(r.due_date as string).toISOString().slice(0, 10) : null,
    dueTime: typeof r.due_time === "string" ? r.due_time.slice(0, 5) : null,
    month: String(r.month),
    archived: Boolean(r.archived),
    assignees: ((r.assignees as string[]) ?? []).map(String),
    checklistDone: Number(r.checklist_done ?? 0),
    checklistTotal: Number(r.checklist_total ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    attachmentCount: Number(r.attachment_count ?? 0),
    inscricaoId: r.inscricao_id === null || r.inscricao_id === undefined ? null : Number(r.inscricao_id),
  };
}

/** Página de cards concluídos do mês escolhido, do mais recente para o mais antigo. */
export async function listArchivedTasksByMonth(
  scope: TaskArchiveScope,
  filters: TaskArchiveFilters,
  page: { limit: number; offset: number }
): Promise<{ tasks: ArchivedTaskRow[]; hasMore: boolean }> {
  await ensureTasksSchema();
  const where = buildWhere(scope, filters);
  if (where.empty) return { tasks: [], hasMore: false };

  const values = [...where.values, page.limit + 1, page.offset];
  const { rows } = await getPool().query(
    `${ROW_SELECT}
      WHERE ${where.clause}
      GROUP BY t.id, b.name, s.name, c.name
      ORDER BY t.completed_at DESC, t.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  const tasks = rows.slice(0, page.limit).map(mapRow);
  return { tasks, hasMore: rows.length > page.limit };
}

/** Totais do mês filtrado, incluindo quanto cada pessoa entregou. */
export async function getArchiveSummary(
  scope: TaskArchiveScope,
  filters: TaskArchiveFilters
): Promise<ArchiveSummary> {
  await ensureTasksSchema();
  const where = buildWhere(scope, filters);
  if (where.empty) return { total: 0, archived: 0, onBoard: 0, boards: 0, byMember: [] };

  const [totals, byMember] = await Promise.all([
    getPool().query<{ total: string; archived: string; boards: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE t.archived) AS archived,
              COUNT(DISTINCT t.board_id) AS boards
         FROM ${SCHEMA}.tasks t
        WHERE ${where.clause}`,
      where.values
    ),
    getPool().query<{ member_id: number | null; name: string | null; count: string }>(
      `SELECT a.member_id, m.name, COUNT(*) AS count
         FROM ${SCHEMA}.tasks t
         LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
         LEFT JOIN ${SCHEMA}.team_members m ON m.id = a.member_id
        WHERE ${where.clause}
        GROUP BY a.member_id, m.name
        ORDER BY COUNT(*) DESC, m.name`,
      where.values
    ),
  ]);

  const row = totals.rows[0];
  const total = Number(row?.total ?? 0);
  const archived = Number(row?.archived ?? 0);

  return {
    total,
    archived,
    onBoard: total - archived,
    boards: Number(row?.boards ?? 0),
    byMember: byMember.rows.map((item) => ({
      memberId: item.member_id === null ? null : Number(item.member_id),
      name: item.name ?? "Sem responsável",
      count: Number(item.count),
    })),
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** CSV do mês para abrir no Excel (mesmo formato do export de quadro). */
export function archiveToCsv(rows: ArchivedTaskRow[]): string {
  const header = [
    "Mes",
    "Concluida em",
    "Setor",
    "Quadro",
    "Coluna",
    "Titulo",
    "Descricao",
    "Responsaveis",
    "Prioridade",
    "Prazo",
    "Hora",
    "Checklist",
    "Comentarios",
    "Arquivada",
  ];
  const lines = [header.map(csvCell).join(";")];
  for (const task of rows) {
    lines.push(
      [
        task.month,
        task.completedDay,
        task.sectorName,
        task.boardName,
        task.columnName ?? "",
        task.title,
        markdownToPlainText(task.description ?? ""),
        task.assignees.join(", "),
        task.priority,
        task.dueDate ?? "",
        task.dueTime ?? "",
        `${task.checklistDone}/${task.checklistTotal}`,
        String(task.commentCount),
        task.archived ? "sim" : "nao",
      ]
        .map(csvCell)
        .join(";")
    );
  }
  // BOM: sem ele o Excel em pt-BR abre acento quebrado.
  return `﻿${lines.join("\n")}`;
}
