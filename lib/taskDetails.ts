import { getPool } from "@/lib/db";
import { ensureTasksSchema, userCanAccessBoard, userCanAccessTask, type TaskCard } from "@/lib/tasks";
import type { PermissionUser } from "@/lib/permissions";

const SCHEMA = "dashboard";

/**
 * Conteúdo de dentro do card: checklists, comentários, anexos e histórico —
 * o que no Trello vive na tela do card e não no quadro. Fica separado de
 * `lib/tasks.ts` (que cuida da hierarquia setor > quadro > coluna > card) só
 * por tamanho: as duas metades compartilham schema e checagem de acesso.
 */

export interface TaskChecklistItem {
  id: number;
  checklistId: number;
  text: string;
  done: boolean;
  doneAt: string | null;
  memberId: number | null;
  dueDate: string | null;
  position: number;
}

export interface TaskChecklist {
  id: number;
  taskId: number;
  name: string;
  position: number;
  items: TaskChecklistItem[];
}

export interface TaskComment {
  id: number;
  taskId: number;
  memberId: number | null;
  authorName: string;
  authorEmail: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** emoji -> quem reagiu (email). O front usa pra marcar a sua própria reação. */
  reactions: Record<string, string[]>;
}

export interface TaskAttachment {
  id: number;
  taskId: number;
  kind: "file" | "link";
  name: string;
  url: string | null;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
  /** Só imagens podem virar capa do card. */
  isImage: boolean;
}

export interface TaskActivityEntry {
  id: number;
  taskId: number | null;
  boardId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  /** Preenchido só no feed do quadro, para dizer de qual card é a linha. */
  taskTitle?: string | null;
}

export interface TaskDetail {
  checklists: TaskChecklist[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  activity: TaskActivityEntry[];
}

function iso(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function isoDayOrNull(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function mapChecklistItem(r: Record<string, unknown>): TaskChecklistItem {
  return {
    id: Number(r.id),
    checklistId: Number(r.checklist_id),
    text: String(r.text),
    done: Boolean(r.done),
    doneAt: r.done_at ? iso(r.done_at) : null,
    memberId: r.member_id === null || r.member_id === undefined ? null : Number(r.member_id),
    dueDate: isoDayOrNull(r.due_date),
    position: Number(r.position),
  };
}

function mapAttachment(r: Record<string, unknown>): TaskAttachment {
  const mime = (r.mime as string) ?? null;
  return {
    id: Number(r.id),
    taskId: Number(r.task_id),
    kind: r.kind === "link" ? "link" : "file",
    name: String(r.name),
    url: (r.url as string) ?? null,
    mime,
    sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    createdAt: iso(r.created_at),
    isImage: Boolean(mime && mime.startsWith("image/")),
  };
}

function mapActivity(r: Record<string, unknown>): TaskActivityEntry {
  const raw = r.detail;
  const detail = typeof raw === "string" ? JSON.parse(raw || "{}") : ((raw as Record<string, unknown>) ?? {});
  return {
    id: Number(r.id),
    taskId: r.task_id === null || r.task_id === undefined ? null : Number(r.task_id),
    boardId: r.board_id === null || r.board_id === undefined ? null : Number(r.board_id),
    actorName: (r.actor_name as string) ?? null,
    actorEmail: (r.actor_email as string) ?? null,
    action: String(r.action),
    detail,
    createdAt: iso(r.created_at),
    taskTitle: (r.task_title as string) ?? undefined,
  };
}

// ── Histórico ────────────────────────────────────────────────────────────────

export interface ActivityActor {
  name?: string | null;
  email?: string | null;
}

/**
 * Toda mudança relevante passa por aqui. É gravação best-effort de propósito:
 * falhar ao registrar histórico não pode derrubar a ação que o usuário pediu
 * (mover um card não pode dar erro porque o log encheu).
 */
export async function logActivity(input: {
  taskId?: number | null;
  boardId?: number | null;
  actor?: ActivityActor | null;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO ${SCHEMA}.task_activity (task_id, board_id, actor_name, actor_email, action, detail)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        input.taskId ?? null,
        input.boardId ?? null,
        input.actor?.name ?? null,
        input.actor?.email?.toLowerCase() ?? null,
        input.action,
        JSON.stringify(input.detail ?? {}),
      ]
    );
  } catch (error) {
    console.error("[tasks] falha ao registrar atividade", error);
  }
}

export async function listTaskActivity(taskId: number, limit = 100): Promise<TaskActivityEntry[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM ${SCHEMA}.task_activity WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [taskId, limit]
  );
  return rows.map(mapActivity);
}

/** Feed do quadro inteiro — o "Atividade" da barra lateral do Trello. */
export async function listBoardActivity(boardId: number, limit = 120): Promise<TaskActivityEntry[]> {
  const { rows } = await getPool().query(
    `SELECT a.*, t.title AS task_title
       FROM ${SCHEMA}.task_activity a
       LEFT JOIN ${SCHEMA}.tasks t ON t.id = a.task_id
      WHERE a.board_id = $1 OR t.board_id = $1
      ORDER BY a.created_at DESC, a.id DESC LIMIT $2`,
    [boardId, limit]
  );
  return rows.map(mapActivity);
}

// ── Detalhe completo do card ─────────────────────────────────────────────────

export async function getTaskDetail(taskId: number): Promise<TaskDetail> {
  await ensureTasksSchema();
  const pool = getPool();
  const [listsRes, itemsRes, commentsRes, reactionsRes, attachmentsRes, activity] = await Promise.all([
    pool.query(`SELECT * FROM ${SCHEMA}.task_checklists WHERE task_id=$1 ORDER BY position, id`, [taskId]),
    pool.query(
      `SELECT i.* FROM ${SCHEMA}.task_checklist_items i
         JOIN ${SCHEMA}.task_checklists c ON c.id = i.checklist_id
        WHERE c.task_id = $1 ORDER BY i.position, i.id`,
      [taskId]
    ),
    pool.query(`SELECT * FROM ${SCHEMA}.task_comments WHERE task_id=$1 ORDER BY created_at, id`, [taskId]),
    pool.query(
      `SELECT r.* FROM ${SCHEMA}.task_comment_reactions r
         JOIN ${SCHEMA}.task_comments c ON c.id = r.comment_id
        WHERE c.task_id = $1`,
      [taskId]
    ),
    pool.query(
      `SELECT id, task_id, kind, name, url, mime, size_bytes, created_at
         FROM ${SCHEMA}.task_attachments WHERE task_id=$1 ORDER BY created_at DESC, id DESC`,
      [taskId]
    ),
    listTaskActivity(taskId),
  ]);

  const itemsByList = new Map<number, TaskChecklistItem[]>();
  for (const row of itemsRes.rows) {
    const item = mapChecklistItem(row);
    const bucket = itemsByList.get(item.checklistId);
    if (bucket) bucket.push(item);
    else itemsByList.set(item.checklistId, [item]);
  }

  const reactionsByComment = new Map<number, Record<string, string[]>>();
  for (const row of reactionsRes.rows) {
    const commentId = Number(row.comment_id);
    const emoji = String(row.emoji);
    const bucket = reactionsByComment.get(commentId) ?? {};
    bucket[emoji] = [...(bucket[emoji] ?? []), String(row.actor_email)];
    reactionsByComment.set(commentId, bucket);
  }

  return {
    checklists: listsRes.rows.map((r) => ({
      id: Number(r.id),
      taskId: Number(r.task_id),
      name: String(r.name),
      position: Number(r.position),
      items: itemsByList.get(Number(r.id)) ?? [],
    })),
    comments: commentsRes.rows.map((r) => ({
      id: Number(r.id),
      taskId: Number(r.task_id),
      memberId: r.member_id === null ? null : Number(r.member_id),
      authorName: String(r.author_name),
      authorEmail: (r.author_email as string) ?? null,
      body: String(r.body),
      createdAt: iso(r.created_at),
      editedAt: r.edited_at ? iso(r.edited_at) : null,
      reactions: reactionsByComment.get(Number(r.id)) ?? {},
    })),
    attachments: attachmentsRes.rows.map(mapAttachment),
    activity,
  };
}

// ── Checklists ───────────────────────────────────────────────────────────────

export async function createChecklist(taskId: number, name: string, items: string[] = []): Promise<TaskChecklist> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.task_checklists (task_id, name, position)
     VALUES ($1,$2, COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_checklists WHERE task_id=$1),0))
     RETURNING *`,
    [taskId, name.trim() || "Checklist"]
  );
  const checklist: TaskChecklist = {
    id: Number(rows[0].id),
    taskId,
    name: String(rows[0].name),
    position: Number(rows[0].position),
    items: [],
  };
  for (const text of items) {
    if (text.trim()) checklist.items.push(await createChecklistItem(checklist.id, text));
  }
  return checklist;
}

export async function updateChecklist(id: number, name: string): Promise<void> {
  await getPool().query(`UPDATE ${SCHEMA}.task_checklists SET name=$2 WHERE id=$1`, [id, name.trim()]);
}

export async function deleteChecklist(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_checklists WHERE id=$1`, [id]);
}

export async function createChecklistItem(
  checklistId: number,
  text: string,
  input?: { memberId?: number | null; dueDate?: string | null }
): Promise<TaskChecklistItem> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_checklist_items (checklist_id, text, member_id, due_date, position)
     VALUES ($1,$2,$3,$4,
       COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_checklist_items WHERE checklist_id=$1),0))
     RETURNING *`,
    [checklistId, text.trim(), input?.memberId ?? null, input?.dueDate || null]
  );
  return mapChecklistItem(rows[0]);
}

export async function updateChecklistItem(
  id: number,
  input: { text?: string; done?: boolean; memberId?: number | null; dueDate?: string | null }
): Promise<void> {
  const touchMember = input.memberId !== undefined;
  const touchDue = input.dueDate !== undefined;
  await getPool().query(
    `UPDATE ${SCHEMA}.task_checklist_items SET
       text = COALESCE($2, text),
       done = COALESCE($3, done),
       done_at = CASE WHEN $3::boolean IS NULL THEN done_at WHEN $3 THEN NOW() ELSE NULL END,
       member_id = CASE WHEN $4::boolean THEN $5::int ELSE member_id END,
       due_date = CASE WHEN $6::boolean THEN $7::date ELSE due_date END
     WHERE id=$1`,
    [
      id,
      input.text?.trim() || null,
      input.done === undefined ? null : input.done,
      touchMember,
      touchMember ? input.memberId ?? null : null,
      touchDue,
      touchDue ? input.dueDate || null : null,
    ]
  );
}

export async function deleteChecklistItem(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_checklist_items WHERE id=$1`, [id]);
}

/** true quando TODOS os itens de TODAS as checklists do card estão marcados. */
export async function checklistIsComplete(taskId: number): Promise<boolean> {
  const { rows } = await getPool().query<{ total: string; done: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE i.done) AS done
       FROM ${SCHEMA}.task_checklist_items i
       JOIN ${SCHEMA}.task_checklists c ON c.id = i.checklist_id
      WHERE c.task_id = $1`,
    [taskId]
  );
  const total = Number(rows[0]?.total ?? 0);
  return total > 0 && total === Number(rows[0]?.done ?? 0);
}

// ── Comentários ──────────────────────────────────────────────────────────────

/** Nomes citados com @ no corpo do comentário (usado para notificar). */
export function extractMentions(body: string): string[] {
  const found = body.match(/@([\p{L}\p{N}._-]+)/gu) ?? [];
  return [...new Set(found.map((m) => m.slice(1).toLowerCase()))];
}

export async function createComment(input: {
  taskId: number;
  memberId: number | null;
  authorName: string;
  authorEmail: string | null;
  body: string;
}): Promise<TaskComment> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_comments (task_id, member_id, author_name, author_email, body)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [input.taskId, input.memberId, input.authorName, input.authorEmail?.toLowerCase() ?? null, input.body.trim()]
  );
  const r = rows[0];
  return {
    id: Number(r.id),
    taskId: input.taskId,
    memberId: input.memberId,
    authorName: String(r.author_name),
    authorEmail: (r.author_email as string) ?? null,
    body: String(r.body),
    createdAt: iso(r.created_at),
    editedAt: null,
    reactions: {},
  };
}

export async function updateComment(id: number, body: string, authorEmail: string | null): Promise<boolean> {
  // Só o autor edita o próprio comentário — a checagem vai no WHERE pra não
  // depender de o chamador lembrar de comparar.
  const { rowCount } = await getPool().query(
    `UPDATE ${SCHEMA}.task_comments SET body=$2, edited_at=NOW()
      WHERE id=$1 AND LOWER(COALESCE(author_email,'')) = LOWER(COALESCE($3,''))`,
    [id, body.trim(), authorEmail ?? ""]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteComment(id: number, authorEmail: string | null, force = false): Promise<boolean> {
  const { rowCount } = force
    ? await getPool().query(`DELETE FROM ${SCHEMA}.task_comments WHERE id=$1`, [id])
    : await getPool().query(
        `DELETE FROM ${SCHEMA}.task_comments WHERE id=$1
           AND LOWER(COALESCE(author_email,'')) = LOWER(COALESCE($2,''))`,
        [id, authorEmail ?? ""]
      );
  return (rowCount ?? 0) > 0;
}

/** Alterna a reação (clicar de novo no mesmo emoji desfaz). */
export async function toggleReaction(commentId: number, actorEmail: string, emoji: string): Promise<void> {
  const pool = getPool();
  const email = actorEmail.toLowerCase();
  const { rowCount } = await pool.query(
    `DELETE FROM ${SCHEMA}.task_comment_reactions WHERE comment_id=$1 AND actor_email=$2 AND emoji=$3`,
    [commentId, email, emoji]
  );
  if ((rowCount ?? 0) === 0) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_comment_reactions (comment_id, actor_email, emoji) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [commentId, email, emoji]
    );
  }
}

export async function taskIdOfComment(commentId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ task_id: number }>(
    `SELECT task_id FROM ${SCHEMA}.task_comments WHERE id=$1`,
    [commentId]
  );
  return rows[0]?.task_id ?? null;
}

// ── Anexos ───────────────────────────────────────────────────────────────────

/** Arquivo acima disso não entra: o anexo mora no Postgres, não em disco. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export async function createFileAttachment(input: {
  taskId: number;
  name: string;
  mime: string;
  buffer: Buffer;
  createdBy: number | null;
}): Promise<TaskAttachment> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_attachments (task_id, kind, name, mime, size_bytes, content, created_by)
     VALUES ($1,'file',$2,$3,$4,$5,$6)
     RETURNING id, task_id, kind, name, url, mime, size_bytes, created_at`,
    [input.taskId, input.name, input.mime, input.buffer.length, input.buffer, input.createdBy]
  );
  return mapAttachment(rows[0]);
}

export async function createLinkAttachment(input: {
  taskId: number;
  name: string;
  url: string;
  createdBy: number | null;
}): Promise<TaskAttachment> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_attachments (task_id, kind, name, url, created_by)
     VALUES ($1,'link',$2,$3,$4)
     RETURNING id, task_id, kind, name, url, mime, size_bytes, created_at`,
    [input.taskId, input.name, input.url, input.createdBy]
  );
  return mapAttachment(rows[0]);
}

export async function getAttachmentFile(
  id: number
): Promise<{ buffer: Buffer; mime: string; name: string; taskId: number } | null> {
  const { rows } = await getPool().query(
    `SELECT task_id, name, mime, content FROM ${SCHEMA}.task_attachments WHERE id=$1`,
    [id]
  );
  const row = rows[0];
  if (!row?.content) return null;
  return {
    buffer: row.content as Buffer,
    mime: (row.mime as string) || "application/octet-stream",
    name: String(row.name),
    taskId: Number(row.task_id),
  };
}

export async function deleteAttachment(id: number): Promise<void> {
  const pool = getPool();
  // Se este anexo era a capa do card, a capa precisa sair junto — senão o card
  // aponta pra uma imagem que não existe mais e a capa some sem explicação.
  await pool.query(
    `UPDATE ${SCHEMA}.tasks SET cover_attachment_id = NULL WHERE cover_attachment_id = $1`,
    [id]
  );
  await pool.query(`DELETE FROM ${SCHEMA}.task_attachments WHERE id=$1`, [id]);
}

export async function taskIdOfAttachment(id: number): Promise<number | null> {
  const { rows } = await getPool().query<{ task_id: number }>(
    `SELECT task_id FROM ${SCHEMA}.task_attachments WHERE id=$1`,
    [id]
  );
  return rows[0]?.task_id ?? null;
}

// ── Templates de card ────────────────────────────────────────────────────────

export interface TaskCardTemplate {
  id: number;
  boardId: number;
  name: string;
  payload: {
    title?: string;
    description?: string | null;
    priority?: string;
    labelIds?: number[];
    assigneeIds?: number[];
    dueInDays?: number | null;
    checklists?: { name: string; items: string[] }[];
  };
  createdAt: string;
}

export async function listCardTemplates(boardId: number): Promise<TaskCardTemplate[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM ${SCHEMA}.task_card_templates WHERE board_id=$1 ORDER BY name`,
    [boardId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    boardId: Number(r.board_id),
    name: String(r.name),
    payload: typeof r.payload === "string" ? JSON.parse(r.payload || "{}") : (r.payload as never),
    createdAt: iso(r.created_at),
  }));
}

export async function createCardTemplate(
  boardId: number,
  name: string,
  payload: TaskCardTemplate["payload"]
): Promise<TaskCardTemplate> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_card_templates (board_id, name, payload) VALUES ($1,$2,$3::jsonb) RETURNING *`,
    [boardId, name.trim(), JSON.stringify(payload)]
  );
  return {
    id: Number(rows[0].id),
    boardId,
    name: String(rows[0].name),
    payload,
    createdAt: iso(rows[0].created_at),
  };
}

export async function deleteCardTemplate(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_card_templates WHERE id=$1`, [id]);
}

export async function getCardTemplate(id: number): Promise<TaskCardTemplate | null> {
  const { rows } = await getPool().query(`SELECT * FROM ${SCHEMA}.task_card_templates WHERE id=$1`, [id]);
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    boardId: Number(rows[0].board_id),
    name: String(rows[0].name),
    payload: typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload || "{}") : rows[0].payload,
    createdAt: iso(rows[0].created_at),
  };
}

/** Cria um card a partir do template, já com as checklists montadas. */
export async function applyCardTemplate(input: {
  templateId: number;
  columnId: number | null;
  createdBy: number | null;
  titleOverride?: string;
}): Promise<TaskCard | null> {
  const template = await getCardTemplate(input.templateId);
  if (!template) return null;
  const { createTask } = await import("@/lib/tasks");
  const payload = template.payload ?? {};
  const dueDate =
    typeof payload.dueInDays === "number"
      ? new Date(Date.now() + payload.dueInDays * 86_400_000).toISOString().slice(0, 10)
      : null;
  const task = await createTask({
    boardId: template.boardId,
    columnId: input.columnId,
    title: input.titleOverride?.trim() || payload.title || template.name,
    description: payload.description ?? null,
    priority: (payload.priority as TaskCard["priority"]) ?? "media",
    dueDate,
    assigneeIds: payload.assigneeIds ?? [],
    labelIds: payload.labelIds ?? [],
    createdBy: input.createdBy,
  });
  for (const list of payload.checklists ?? []) {
    await createChecklist(task.id, list.name, list.items ?? []);
  }
  return task;
}

async function boardIdOfTemplate(id: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM ${SCHEMA}.task_card_templates WHERE id=$1`,
    [id]
  );
  return rows[0]?.board_id ?? null;
}

export async function userCanAccessTemplate(
  user: PermissionUser | null | undefined,
  templateId: number
): Promise<boolean> {
  const boardId = await boardIdOfTemplate(templateId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}

export async function userCanAccessChecklist(
  user: PermissionUser | null | undefined,
  checklistId: number
): Promise<boolean> {
  const { rows } = await getPool().query<{ task_id: number }>(
    `SELECT task_id FROM ${SCHEMA}.task_checklists WHERE id=$1`,
    [checklistId]
  );
  return rows[0] ? userCanAccessTask(user, rows[0].task_id) : false;
}

export async function userCanAccessChecklistItem(
  user: PermissionUser | null | undefined,
  itemId: number
): Promise<boolean> {
  const { rows } = await getPool().query<{ task_id: number }>(
    `SELECT c.task_id FROM ${SCHEMA}.task_checklist_items i
       JOIN ${SCHEMA}.task_checklists c ON c.id = i.checklist_id WHERE i.id=$1`,
    [itemId]
  );
  return rows[0] ? userCanAccessTask(user, rows[0].task_id) : false;
}

/** Card de uma checklist (para logar atividade e disparar automação). */
export async function taskIdOfChecklistItem(itemId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ task_id: number }>(
    `SELECT c.task_id FROM ${SCHEMA}.task_checklist_items i
       JOIN ${SCHEMA}.task_checklists c ON c.id = i.checklist_id WHERE i.id=$1`,
    [itemId]
  );
  return rows[0]?.task_id ?? null;
}

export async function taskIdOfChecklist(checklistId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ task_id: number }>(
    `SELECT task_id FROM ${SCHEMA}.task_checklists WHERE id=$1`,
    [checklistId]
  );
  return rows[0]?.task_id ?? null;
}
