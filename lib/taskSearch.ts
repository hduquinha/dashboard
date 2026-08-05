import { getPool } from "@/lib/db";
import { ensureTasksSchema, listSectorsForUser, mapTask, type TaskCard } from "@/lib/tasks";
import { markdownToPlainText } from "@/lib/taskMarkdown";
import type { PermissionUser } from "@/lib/permissions";

const SCHEMA = "dashboard";

/**
 * Busca e exportação do módulo de Tarefas.
 *
 * A busca sempre parte dos setores que o usuário enxerga — nunca de "todos os
 * cards": um resultado de busca é um vazamento de acesso tão real quanto abrir
 * o quadro direto.
 */

export interface TaskSearchFilters {
  text?: string;
  labelIds?: number[];
  memberIds?: number[];
  priority?: string[];
  /** "open" | "done" | "overdue" | "due_today" | "due_week" | "no_due" */
  status?: string;
  boardId?: number | null;
  sectorId?: number | null;
  includeArchived?: boolean;
}

export interface TaskSearchResult extends TaskCard {
  boardName: string;
  sectorName: string;
  columnName: string | null;
}

export async function searchTasks(
  user: PermissionUser | null | undefined,
  filters: TaskSearchFilters,
  limit = 200
): Promise<TaskSearchResult[]> {
  await ensureTasksSchema();
  const sectors = await listSectorsForUser(user);
  const sectorIds = sectors
    .map((s) => s.id)
    .filter((id) => (filters.sectorId ? id === Number(filters.sectorId) : true));
  if (sectorIds.length === 0) return [];

  const conditions: string[] = ["b.sector_id = ANY($1::int[])", "NOT b.archived", "NOT t.is_template"];
  const params: unknown[] = [sectorIds];

  if (!filters.includeArchived) conditions.push("NOT t.archived");
  if (filters.boardId) {
    params.push(Number(filters.boardId));
    conditions.push(`t.board_id = $${params.length}`);
  }
  if (filters.text?.trim()) {
    params.push(`%${filters.text.trim().toLowerCase()}%`);
    conditions.push(`(LOWER(t.title) LIKE $${params.length} OR LOWER(COALESCE(t.description,'')) LIKE $${params.length})`);
  }
  if (filters.priority?.length) {
    params.push(filters.priority);
    conditions.push(`t.priority = ANY($${params.length}::text[])`);
  }
  if (filters.labelIds?.length) {
    params.push(filters.labelIds);
    conditions.push(
      `EXISTS (SELECT 1 FROM ${SCHEMA}.task_label_links l WHERE l.task_id = t.id AND l.label_id = ANY($${params.length}::int[]))`
    );
  }
  if (filters.memberIds?.length) {
    params.push(filters.memberIds);
    conditions.push(
      `EXISTS (SELECT 1 FROM ${SCHEMA}.task_assignees a2 WHERE a2.task_id = t.id AND a2.member_id = ANY($${params.length}::int[]))`
    );
  }
  switch (filters.status) {
    case "done":
      conditions.push("t.completed_at IS NOT NULL");
      break;
    case "open":
      conditions.push("t.completed_at IS NULL");
      break;
    case "overdue":
      conditions.push("t.completed_at IS NULL AND t.due_date < CURRENT_DATE");
      break;
    case "due_today":
      conditions.push("t.completed_at IS NULL AND t.due_date = CURRENT_DATE");
      break;
    case "due_week":
      conditions.push("t.completed_at IS NULL AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7");
      break;
    case "no_due":
      conditions.push("t.due_date IS NULL");
      break;
    default:
      break;
  }

  params.push(limit);

  const { rows } = await getPool().query(
    `SELECT t.*,
       COALESCE(array_agg(DISTINCT a.member_id) FILTER (WHERE a.member_id IS NOT NULL),'{}') AS assignee_ids,
       COALESCE(array_agg(DISTINCT ll.label_id) FILTER (WHERE ll.label_id IS NOT NULL),'{}') AS label_ids,
       b.name AS board_name, s.name AS sector_name, c.name AS column_name,
       (SELECT COUNT(*) FROM ${SCHEMA}.task_checklist_items ci
          JOIN ${SCHEMA}.task_checklists cl ON cl.id = ci.checklist_id WHERE cl.task_id = t.id) AS checklist_total,
       (SELECT COUNT(*) FROM ${SCHEMA}.task_checklist_items ci
          JOIN ${SCHEMA}.task_checklists cl ON cl.id = ci.checklist_id WHERE cl.task_id = t.id AND ci.done) AS checklist_done,
       (SELECT COUNT(*) FROM ${SCHEMA}.task_comments cm WHERE cm.task_id = t.id) AS comment_count,
       (SELECT COUNT(*) FROM ${SCHEMA}.task_attachments at WHERE at.task_id = t.id) AS attachment_count,
       (SELECT COALESCE(jsonb_object_agg(cv.field_id, cv.value) FILTER (WHERE cv.value IS NOT NULL), '{}'::jsonb)
          FROM ${SCHEMA}.task_custom_values cv WHERE cv.task_id = t.id) AS custom_values
     FROM ${SCHEMA}.tasks t
     JOIN ${SCHEMA}.task_boards b ON b.id = t.board_id
     JOIN ${SCHEMA}.task_sectors s ON s.id = b.sector_id
     LEFT JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
     LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
     LEFT JOIN ${SCHEMA}.task_label_links ll ON ll.task_id = t.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY t.id, b.name, s.name, c.name
     ORDER BY t.due_date NULLS LAST, t.priority DESC, t.id DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    ...mapTask(r),
    boardName: String(r.board_name),
    sectorName: String(r.sector_name),
    columnName: (r.column_name as string) ?? null,
  }));
}

// ── Exportação / importação ──────────────────────────────────────────────────

export interface BoardExport {
  version: 1;
  exportedAt: string;
  board: { name: string; description: string | null; visibility: string };
  columns: { name: string; color: string | null; position: number; wipLimit: number | null; completesTask: boolean }[];
  labels: { name: string; color: string }[];
  customFields: { name: string; type: string; options: string[]; showOnCard: boolean }[];
  tasks: {
    title: string;
    description: string | null;
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    columnName: string | null;
    labels: string[];
    assigneeEmails: string[];
    completed: boolean;
    archived: boolean;
    checklists: { name: string; items: { text: string; done: boolean }[] }[];
    comments: { author: string; body: string; createdAt: string }[];
    customValues: Record<string, string>;
  }[];
}

export async function exportBoard(boardId: number): Promise<BoardExport | null> {
  await ensureTasksSchema();
  const pool = getPool();
  const boardRes = await pool.query(`SELECT * FROM ${SCHEMA}.task_boards WHERE id=$1`, [boardId]);
  if (!boardRes.rows[0]) return null;

  const [cols, labels, fields, tasks] = await Promise.all([
    pool.query(`SELECT * FROM ${SCHEMA}.task_columns WHERE board_id=$1 ORDER BY position, id`, [boardId]),
    pool.query(`SELECT * FROM ${SCHEMA}.task_labels WHERE board_id=$1 ORDER BY id`, [boardId]),
    pool.query(`SELECT * FROM ${SCHEMA}.task_custom_fields WHERE board_id=$1 ORDER BY position, id`, [boardId]),
    pool.query(
      `SELECT t.*, c.name AS column_name,
         COALESCE(array_agg(DISTINCT l.name) FILTER (WHERE l.name IS NOT NULL),'{}') AS label_names,
         COALESCE(array_agg(DISTINCT m.email) FILTER (WHERE m.email IS NOT NULL),'{}') AS assignee_emails,
         (SELECT COALESCE(jsonb_object_agg(f.name, cv.value) FILTER (WHERE cv.value IS NOT NULL),'{}'::jsonb)
            FROM ${SCHEMA}.task_custom_values cv
            JOIN ${SCHEMA}.task_custom_fields f ON f.id = cv.field_id
           WHERE cv.task_id = t.id) AS custom_values
       FROM ${SCHEMA}.tasks t
       LEFT JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
       LEFT JOIN ${SCHEMA}.task_label_links ll ON ll.task_id = t.id
       LEFT JOIN ${SCHEMA}.task_labels l ON l.id = ll.label_id
       LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
       LEFT JOIN ${SCHEMA}.team_members m ON m.id = a.member_id
       WHERE t.board_id=$1 AND NOT t.is_template
       GROUP BY t.id, c.name ORDER BY t.position, t.id`,
      [boardId]
    ),
  ]);

  const taskIds = tasks.rows.map((r) => Number(r.id));
  const [checklists, items, comments] = await Promise.all([
    pool.query(`SELECT * FROM ${SCHEMA}.task_checklists WHERE task_id = ANY($1::int[]) ORDER BY position, id`, [taskIds]),
    pool.query(
      `SELECT i.*, c.task_id FROM ${SCHEMA}.task_checklist_items i
         JOIN ${SCHEMA}.task_checklists c ON c.id = i.checklist_id
        WHERE c.task_id = ANY($1::int[]) ORDER BY i.position, i.id`,
      [taskIds]
    ),
    pool.query(
      `SELECT * FROM ${SCHEMA}.task_comments WHERE task_id = ANY($1::int[]) ORDER BY created_at`,
      [taskIds]
    ),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    board: {
      name: String(boardRes.rows[0].name),
      description: (boardRes.rows[0].description as string) ?? null,
      visibility: String(boardRes.rows[0].visibility ?? "sector"),
    },
    columns: cols.rows.map((c) => ({
      name: String(c.name),
      color: (c.color as string) ?? null,
      position: Number(c.position),
      wipLimit: c.wip_limit === null ? null : Number(c.wip_limit),
      completesTask: Boolean(c.completes_task),
    })),
    labels: labels.rows.map((l) => ({ name: String(l.name), color: String(l.color) })),
    customFields: fields.rows.map((f) => ({
      name: String(f.name),
      type: String(f.type),
      options: typeof f.options === "string" ? JSON.parse(f.options || "[]") : ((f.options as string[]) ?? []),
      showOnCard: Boolean(f.show_on_card),
    })),
    tasks: tasks.rows.map((t) => {
      const id = Number(t.id);
      const myLists = checklists.rows.filter((c) => Number(c.task_id) === id);
      return {
        title: String(t.title),
        description: (t.description as string) ?? null,
        priority: String(t.priority),
        startDate: t.start_date ? new Date(t.start_date as string).toISOString().slice(0, 10) : null,
        dueDate: t.due_date ? new Date(t.due_date as string).toISOString().slice(0, 10) : null,
        columnName: (t.column_name as string) ?? null,
        labels: ((t.label_names as string[]) ?? []).map(String),
        assigneeEmails: ((t.assignee_emails as string[]) ?? []).map(String),
        completed: Boolean(t.completed_at),
        archived: Boolean(t.archived),
        checklists: myLists.map((list) => ({
          name: String(list.name),
          items: items.rows
            .filter((i) => Number(i.checklist_id) === Number(list.id))
            .map((i) => ({ text: String(i.text), done: Boolean(i.done) })),
        })),
        comments: comments.rows
          .filter((c) => Number(c.task_id) === id)
          .map((c) => ({
            author: String(c.author_name),
            body: String(c.body),
            createdAt: new Date(c.created_at as string).toISOString(),
          })),
        customValues:
          typeof t.custom_values === "string" ? JSON.parse(t.custom_values || "{}") : ((t.custom_values as never) ?? {}),
      };
    }),
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** CSV de planilha: uma linha por card, com o essencial pra abrir no Excel. */
export function boardExportToCsv(data: BoardExport): string {
  const header = [
    "Quadro",
    "Coluna",
    "Titulo",
    "Descricao",
    "Prioridade",
    "Inicio",
    "Prazo",
    "Concluida",
    "Arquivada",
    "Etiquetas",
    "Responsaveis",
    "Checklist (feitos/total)",
    "Comentarios",
  ];
  const lines = [header.map(csvCell).join(";")];
  for (const task of data.tasks) {
    const total = task.checklists.reduce((sum, c) => sum + c.items.length, 0);
    const done = task.checklists.reduce((sum, c) => sum + c.items.filter((i) => i.done).length, 0);
    lines.push(
      [
        data.board.name,
        task.columnName ?? "",
        task.title,
        markdownToPlainText(task.description ?? ""),
        task.priority,
        task.startDate ?? "",
        task.dueDate ?? "",
        task.completed ? "sim" : "nao",
        task.archived ? "sim" : "nao",
        task.labels.join(", "),
        task.assigneeEmails.join(", "),
        `${done}/${total}`,
        String(task.comments.length),
      ]
        .map(csvCell)
        .join(";")
    );
  }
  // BOM: sem ele o Excel em pt-BR abre acento quebrado.
  return `﻿${lines.join("\n")}`;
}

/**
 * Importa um quadro exportado (mesmo formato do export). Cria um quadro NOVO —
 * nunca sobrescreve um existente, porque um import errado sobre um quadro vivo
 * é irreversível.
 */
export async function importBoard(
  sectorId: number,
  data: BoardExport,
  nameOverride?: string
): Promise<{ boardId: number; tasks: number }> {
  const { createBoard, createColumn, createLabel, createTask, createCustomField, setCustomValue, deleteColumn } =
    await import("@/lib/tasks");
  const { createChecklist } = await import("@/lib/taskDetails");
  const pool = getPool();

  const board = await createBoard({
    sectorId,
    name: nameOverride?.trim() || `${data.board.name} (importado)`,
    description: data.board.description,
  });

  // createBoard já cria as colunas padrão; num import elas atrapalham.
  const { rows: defaults } = await pool.query<{ id: number }>(
    `SELECT id FROM ${SCHEMA}.task_columns WHERE board_id=$1`,
    [board.id]
  );
  for (const column of defaults) await deleteColumn(column.id);

  const columnByName = new Map<string, number>();
  for (const column of data.columns ?? []) {
    const created = await createColumn(board.id, column.name, column.color ?? undefined, {
      wipLimit: column.wipLimit ?? null,
      completesTask: column.completesTask,
    });
    columnByName.set(column.name, created.id);
  }

  const labelByName = new Map<string, number>();
  for (const label of data.labels ?? []) {
    const created = await createLabel(board.id, label.name, label.color);
    labelByName.set(label.name, created.id);
  }

  const fieldByName = new Map<string, number>();
  for (const field of data.customFields ?? []) {
    const created = await createCustomField({
      boardId: board.id,
      name: field.name,
      type: field.type as "text",
      options: field.options,
      showOnCard: field.showOnCard,
    });
    fieldByName.set(field.name, created.id);
  }

  const { rows: members } = await pool.query<{ id: number; email: string }>(
    `SELECT id, email FROM ${SCHEMA}.team_members WHERE email IS NOT NULL`
  );
  const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));

  let count = 0;
  for (const task of data.tasks ?? []) {
    const created = await createTask({
      boardId: board.id,
      columnId: task.columnName ? columnByName.get(task.columnName) ?? null : null,
      title: task.title,
      description: task.description,
      priority: task.priority as "media",
      startDate: task.startDate,
      dueDate: task.dueDate,
      labelIds: (task.labels ?? []).map((n) => labelByName.get(n)).filter((id): id is number => Boolean(id)),
      assigneeIds: (task.assigneeEmails ?? [])
        .map((email) => memberByEmail.get(email.toLowerCase()))
        .filter((id): id is number => Boolean(id)),
      createdBy: null,
    });
    for (const list of task.checklists ?? []) {
      const checklist = await createChecklist(
        created.id,
        list.name,
        list.items.map((i) => i.text)
      );
      // Reaplica o "feito" item a item — createChecklist cria tudo desmarcado.
      for (const [index, item] of list.items.entries()) {
        if (item.done && checklist.items[index]) {
          await pool.query(
            `UPDATE ${SCHEMA}.task_checklist_items SET done = true, done_at = NOW() WHERE id=$1`,
            [checklist.items[index].id]
          );
        }
      }
    }
    for (const [fieldName, value] of Object.entries(task.customValues ?? {})) {
      const fieldId = fieldByName.get(fieldName);
      if (fieldId) await setCustomValue(created.id, fieldId, String(value));
    }
    if (task.completed) {
      await pool.query(`UPDATE ${SCHEMA}.tasks SET completed_at = NOW() WHERE id=$1`, [created.id]);
    }
    count += 1;
  }

  return { boardId: board.id, tasks: count };
}
