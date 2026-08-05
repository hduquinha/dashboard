import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db";
import { createAppNotifications } from "@/lib/appNotifications";
import {
  ensureTasksSchema,
  getTask,
  moveTask,
  setTaskAssignees,
  setTaskLabels,
  updateTask,
  userCanAccessBoard,
  type TaskCard,
} from "@/lib/tasks";
import { checklistIsComplete, createChecklist, createComment, logActivity, type ActivityActor } from "@/lib/taskDetails";
import type { PermissionUser } from "@/lib/permissions";

const SCHEMA = "dashboard";

/**
 * Automação estilo Butler do Trello: QUANDO (gatilho) ENTÃO (ações).
 *
 * Três formatos, mesma tabela:
 *  - `rule`     — dispara sozinha quando o evento acontece no quadro;
 *  - `button`   — aparece dentro do card e roda quando alguém clica;
 *  - `schedule` — roda por horário (o loop do server.js chama o endpoint interno).
 *
 * Regra de segurança do motor: automação NÃO dispara automação. Uma regra que
 * move o card para "Concluído" não reexecuta as regras de "movido para
 * Concluído" — sem isso, duas regras cruzadas viram laço infinito no servidor.
 */

export type AutomationKind = "rule" | "button" | "schedule";

export type AutomationTriggerType =
  | "card_created"
  | "card_moved"
  | "label_added"
  | "member_assigned"
  | "checklist_completed"
  | "card_completed"
  | "due_soon"
  | "due_overdue";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** Coluna alvo (card_moved), etiqueta (label_added) ou dias (due_soon). */
  columnId?: number | null;
  labelId?: number | null;
  memberId?: number | null;
  days?: number | null;
}

export type AutomationActionType =
  | "move_column"
  | "add_label"
  | "remove_label"
  | "assign_member"
  | "set_priority"
  | "set_due_days"
  | "add_comment"
  | "add_checklist"
  | "complete_card"
  | "archive_card"
  | "notify_members"
  | "create_card"
  | "webhook";

export interface AutomationAction {
  type: AutomationActionType;
  columnId?: number | null;
  labelId?: number | null;
  memberId?: number | null;
  priority?: string | null;
  days?: number | null;
  text?: string | null;
  items?: string[];
  url?: string | null;
  templateId?: number | null;
}

export interface TaskAutomation {
  id: number;
  boardId: number;
  kind: AutomationKind;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  scheduleKind: "daily" | "weekly" | "monthly" | null;
  scheduleTime: string | null;
  scheduleWeekday: number | null;
  scheduleDay: number | null;
  lastRunAt: string | null;
}

export interface TaskWebhook {
  id: number;
  boardId: number;
  url: string;
  events: string[];
  secret: string | null;
  enabled: boolean;
  lastStatus: string | null;
  lastSentAt: string | null;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function mapAutomation(r: Record<string, unknown>): TaskAutomation {
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    kind: (String(r.kind) as AutomationKind) ?? "rule",
    name: String(r.name),
    trigger: parseJson<AutomationTrigger>(r.trigger, { type: "card_created" }),
    actions: parseJson<AutomationAction[]>(r.actions, []),
    enabled: Boolean(r.enabled),
    scheduleKind: (r.schedule_kind as TaskAutomation["scheduleKind"]) ?? null,
    scheduleTime: (r.schedule_time as string) ?? null,
    scheduleWeekday: r.schedule_weekday === null || r.schedule_weekday === undefined ? null : Number(r.schedule_weekday),
    scheduleDay: r.schedule_day === null || r.schedule_day === undefined ? null : Number(r.schedule_day),
    lastRunAt: r.last_run_at ? new Date(r.last_run_at as string).toISOString() : null,
  };
}

export async function listAutomations(boardId: number): Promise<TaskAutomation[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM ${SCHEMA}.task_automations WHERE board_id=$1 ORDER BY kind, id`,
    [boardId]
  );
  return rows.map(mapAutomation);
}

export async function createAutomation(input: {
  boardId: number;
  kind: AutomationKind;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  scheduleKind?: string | null;
  scheduleTime?: string | null;
  scheduleWeekday?: number | null;
  scheduleDay?: number | null;
}): Promise<TaskAutomation> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_automations
       (board_id, kind, name, trigger, actions, schedule_kind, schedule_time, schedule_weekday, schedule_day)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING *`,
    [
      input.boardId,
      input.kind,
      input.name.trim(),
      JSON.stringify(input.trigger ?? {}),
      JSON.stringify(input.actions ?? []),
      input.scheduleKind ?? null,
      input.scheduleTime ?? null,
      input.scheduleWeekday ?? null,
      input.scheduleDay ?? null,
    ]
  );
  return mapAutomation(rows[0]);
}

export async function updateAutomation(
  id: number,
  input: { name?: string; enabled?: boolean; trigger?: AutomationTrigger; actions?: AutomationAction[] }
): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_automations SET
       name = COALESCE($2, name),
       enabled = COALESCE($3, enabled),
       trigger = COALESCE($4::jsonb, trigger),
       actions = COALESCE($5::jsonb, actions)
     WHERE id=$1`,
    [
      id,
      input.name?.trim() || null,
      input.enabled ?? null,
      input.trigger ? JSON.stringify(input.trigger) : null,
      input.actions ? JSON.stringify(input.actions) : null,
    ]
  );
}

export async function deleteAutomation(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_automations WHERE id=$1`, [id]);
}

export async function getAutomation(id: number): Promise<TaskAutomation | null> {
  const { rows } = await getPool().query(`SELECT * FROM ${SCHEMA}.task_automations WHERE id=$1`, [id]);
  return rows[0] ? mapAutomation(rows[0]) : null;
}

export async function userCanAccessAutomation(
  user: PermissionUser | null | undefined,
  id: number
): Promise<boolean> {
  const automation = await getAutomation(id);
  return automation ? userCanAccessBoard(user, automation.boardId) : false;
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export async function listWebhooks(boardId: number): Promise<TaskWebhook[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(`SELECT * FROM ${SCHEMA}.task_webhooks WHERE board_id=$1 ORDER BY id`, [
    boardId,
  ]);
  return rows.map((r) => ({
    id: Number(r.id),
    boardId: Number(r.board_id),
    url: String(r.url),
    events: ((r.events as string[]) ?? []).map(String),
    secret: (r.secret as string) ?? null,
    enabled: Boolean(r.enabled),
    lastStatus: (r.last_status as string) ?? null,
    lastSentAt: r.last_sent_at ? new Date(r.last_sent_at as string).toISOString() : null,
  }));
}

export async function createWebhook(input: {
  boardId: number;
  url: string;
  events: string[];
}): Promise<TaskWebhook> {
  await ensureTasksSchema();
  const secret = randomBytes(16).toString("hex");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_webhooks (board_id, url, events, secret) VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.boardId, input.url.trim(), input.events, secret]
  );
  return {
    id: Number(rows[0].id),
    boardId: input.boardId,
    url: String(rows[0].url),
    events: input.events,
    secret,
    enabled: true,
    lastStatus: null,
    lastSentAt: null,
  };
}

export async function deleteWebhook(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_webhooks WHERE id=$1`, [id]);
}

export async function boardIdOfWebhook(id: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM ${SCHEMA}.task_webhooks WHERE id=$1`,
    [id]
  );
  return rows[0]?.board_id ?? null;
}

/**
 * Dispara os webhooks do quadro para um evento. Não espera a resposta do
 * destino para não travar a requisição do usuário — n8n fora do ar não pode
 * fazer o card demorar 30 segundos pra salvar.
 */
export async function dispatchWebhooks(boardId: number, event: string, payload: Record<string, unknown>): Promise<void> {
  let hooks: TaskWebhook[];
  try {
    hooks = (await listWebhooks(boardId)).filter(
      (hook) => hook.enabled && (hook.events.length === 0 || hook.events.includes(event))
    );
  } catch {
    return;
  }
  for (const hook of hooks) {
    const body = JSON.stringify({ event, boardId, sentAt: new Date().toISOString(), data: payload });
    void fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vozup-Event": event,
        ...(hook.secret ? { "X-Vozup-Signature": createHash("sha256").update(hook.secret + body).digest("hex") } : {}),
      },
      body,
      signal: AbortSignal.timeout(8000),
    })
      .then((res) =>
        getPool().query(
          `UPDATE ${SCHEMA}.task_webhooks SET last_status=$2, last_sent_at=NOW() WHERE id=$1`,
          [hook.id, String(res.status)]
        )
      )
      .catch((error: unknown) =>
        getPool().query(`UPDATE ${SCHEMA}.task_webhooks SET last_status=$2, last_sent_at=NOW() WHERE id=$1`, [
          hook.id,
          `erro: ${error instanceof Error ? error.message.slice(0, 80) : "falhou"}`,
        ])
      );
  }
}

// ── Tokens de API ────────────────────────────────────────────────────────────

export interface TaskApiToken {
  id: number;
  name: string;
  userEmail: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listApiTokens(): Promise<TaskApiToken[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT id, name, user_email, created_at, last_used_at, revoked FROM ${SCHEMA}.task_api_tokens ORDER BY id DESC`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    userEmail: String(r.user_email),
    createdAt: new Date(r.created_at as string).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
    revoked: Boolean(r.revoked),
  }));
}

/** Devolve o token em claro — é a única vez que ele existe fora do hash. */
export async function createApiToken(name: string, userEmail: string): Promise<{ token: string; id: number }> {
  await ensureTasksSchema();
  const token = `vzp_${randomBytes(24).toString("hex")}`;
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.task_api_tokens (name, token_hash, user_email) VALUES ($1,$2,$3) RETURNING id`,
    [name.trim() || "Token", hashToken(token), userEmail.toLowerCase()]
  );
  return { token, id: rows[0].id };
}

export async function revokeApiToken(id: number): Promise<void> {
  await getPool().query(`UPDATE ${SCHEMA}.task_api_tokens SET revoked = true WHERE id=$1`, [id]);
}

/**
 * Valida um token de API. A comparação é por hash e em tempo constante, para
 * não vazar prefixo por diferença de tempo de resposta.
 */
export async function resolveApiToken(token: string): Promise<{ email: string } | null> {
  if (!token.startsWith("vzp_")) return null;
  await ensureTasksSchema();
  const hash = hashToken(token);
  const { rows } = await getPool().query<{ id: number; token_hash: string; user_email: string }>(
    `SELECT id, token_hash, user_email FROM ${SCHEMA}.task_api_tokens WHERE NOT revoked`
  );
  for (const row of rows) {
    const a = Buffer.from(row.token_hash);
    const b = Buffer.from(hash);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      void getPool().query(`UPDATE ${SCHEMA}.task_api_tokens SET last_used_at = NOW() WHERE id=$1`, [row.id]);
      return { email: row.user_email };
    }
  }
  return null;
}

// ── Motor ────────────────────────────────────────────────────────────────────

export interface AutomationEvent {
  type: AutomationTriggerType;
  boardId: number;
  taskId: number;
  columnId?: number | null;
  labelId?: number | null;
  memberId?: number | null;
  actor?: ActivityActor | null;
}

function triggerMatches(trigger: AutomationTrigger, event: AutomationEvent): boolean {
  if (trigger.type !== event.type) return false;
  switch (trigger.type) {
    case "card_moved":
      // Sem coluna definida, a regra vale para qualquer movimento.
      return !trigger.columnId || Number(trigger.columnId) === Number(event.columnId);
    case "label_added":
      return !trigger.labelId || Number(trigger.labelId) === Number(event.labelId);
    case "member_assigned":
      return !trigger.memberId || Number(trigger.memberId) === Number(event.memberId);
    default:
      return true;
  }
}

/**
 * Roda as regras do quadro para um evento. Chamada depois que a ação do
 * usuário já foi gravada; erros aqui são registrados e engolidos para não
 * desfazer o que o usuário fez.
 */
export async function runAutomations(event: AutomationEvent): Promise<void> {
  try {
    const automations = await listAutomations(event.boardId);
    const matching = automations.filter((a) => a.kind === "rule" && a.enabled && triggerMatches(a.trigger, event));
    for (const automation of matching) {
      await runActions(automation, event.taskId, event.actor ?? { name: "Automação" });
    }
    await dispatchWebhooks(event.boardId, event.type, {
      taskId: event.taskId,
      columnId: event.columnId ?? null,
      labelId: event.labelId ?? null,
      memberId: event.memberId ?? null,
      actor: event.actor?.email ?? null,
    });
  } catch (error) {
    console.error("[tasks] falha ao rodar automações", error);
  }
}

/** Executa a lista de ações de uma automação sobre um card. */
export async function runActions(
  automation: TaskAutomation,
  taskId: number,
  actor: ActivityActor
): Promise<string[]> {
  const applied: string[] = [];
  const task = await getTask(taskId);
  if (!task) return applied;

  for (const action of automation.actions ?? []) {
    try {
      await runSingleAction(action, task, automation, actor);
      applied.push(action.type);
    } catch (error) {
      console.error("[tasks] ação de automação falhou", action.type, error);
    }
  }

  if (applied.length > 0) {
    await logActivity({
      taskId,
      boardId: task.boardId,
      actor: { name: `⚡ ${automation.name}`, email: actor.email ?? null },
      action: "automation_ran",
      detail: { automation: automation.name, actions: applied },
    });
    await getPool().query(`UPDATE ${SCHEMA}.task_automations SET last_run_at = NOW() WHERE id=$1`, [automation.id]);
  }
  return applied;
}

async function runSingleAction(
  action: AutomationAction,
  task: TaskCard,
  automation: TaskAutomation,
  actor: ActivityActor
): Promise<void> {
  switch (action.type) {
    case "move_column": {
      if (!action.columnId) return;
      const { rows } = await getPool().query<{ id: number }>(
        `SELECT id FROM ${SCHEMA}.tasks WHERE column_id=$1 AND NOT archived ORDER BY position`,
        [action.columnId]
      );
      await moveTask(task.id, Number(action.columnId), [...rows.map((r) => r.id), task.id]);
      return;
    }
    case "add_label":
      if (action.labelId) await setTaskLabels(task.id, [...new Set([...task.labelIds, Number(action.labelId)])]);
      return;
    case "remove_label":
      if (action.labelId) await setTaskLabels(task.id, task.labelIds.filter((id) => id !== Number(action.labelId)));
      return;
    case "assign_member":
      if (action.memberId) {
        await setTaskAssignees(task.id, [...new Set([...task.assigneeIds, Number(action.memberId)])]);
        await notifyTaskMembers([Number(action.memberId)], task, "task_assigned", `${automation.name} atribuiu esta tarefa a você.`);
      }
      return;
    case "set_priority":
      await updateTask(task.id, { priority: (action.priority as TaskCard["priority"]) ?? "media" });
      return;
    case "set_due_days":
      await updateTask(task.id, {
        dueDate: new Date(Date.now() + (action.days ?? 0) * 86_400_000).toISOString().slice(0, 10),
      });
      return;
    case "add_comment":
      if (action.text) {
        await createComment({
          taskId: task.id,
          memberId: null,
          authorName: `⚡ ${automation.name}`,
          authorEmail: actor.email ?? null,
          body: action.text,
        });
      }
      return;
    case "add_checklist":
      if (action.text) await createChecklist(task.id, action.text, action.items ?? []);
      return;
    case "complete_card":
      await updateTask(task.id, { completed: true });
      return;
    case "archive_card":
      await updateTask(task.id, { archived: true });
      return;
    case "notify_members":
      await notifyTaskMembers(task.assigneeIds, task, "task_assigned", action.text || `Automação "${automation.name}" tocou esta tarefa.`);
      return;
    case "create_card": {
      if (!action.templateId) return;
      const { applyCardTemplate } = await import("@/lib/taskDetails");
      await applyCardTemplate({
        templateId: Number(action.templateId),
        columnId: action.columnId ?? null,
        createdBy: null,
      });
      return;
    }
    case "webhook":
      if (action.url) {
        void fetch(action.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "automation", automation: automation.name, task }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }
      return;
    default:
      return;
  }
}

// ── Notificações de tarefa ───────────────────────────────────────────────────

/**
 * Manda a notificação para os membros indicados (ids de `team_members`). O
 * feed do site é por email, então resolvemos os emails aqui.
 */
export async function notifyTaskMembers(
  memberIds: number[],
  task: Pick<TaskCard, "id" | "title" | "boardId">,
  kind: "task_assigned" | "task_mention" | "task_due",
  body: string
): Promise<void> {
  if (memberIds.length === 0) return;
  try {
    const { rows } = await getPool().query<{ email: string }>(
      `SELECT email FROM ${SCHEMA}.team_members WHERE id = ANY($1::int[]) AND email IS NOT NULL`,
      [memberIds]
    );
    const emails = rows.map((r) => r.email).filter(Boolean);
    if (emails.length === 0) return;
    await createAppNotifications(emails, [
      {
        kind,
        title: task.title.slice(0, 90),
        body,
        url: `/tarefas?board=${task.boardId}&card=${task.id}`,
        // Uma notificação por card/tipo/dia: o ciclo de prazo roda a cada 5
        // minutos e sem isso a pessoa receberia o mesmo aviso 288 vezes por dia.
        dedupeKey: `${kind}:${task.id}:${new Date().toISOString().slice(0, 10)}`,
      },
    ]);
  } catch (error) {
    console.error("[tasks] falha ao notificar membros", error);
  }
}

// ── Agendados e prazos (chamado pelo loop interno) ───────────────────────────

function scheduleIsDue(automation: TaskAutomation, now: Date): boolean {
  const [hh, mm] = (automation.scheduleTime ?? "09:00").split(":").map((n) => Number.parseInt(n, 10));
  const target = new Date(now);
  target.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (now < target) return false;
  if (automation.scheduleKind === "weekly" && now.getDay() !== (automation.scheduleWeekday ?? 1)) return false;
  if (automation.scheduleKind === "monthly" && now.getDate() !== (automation.scheduleDay ?? 1)) return false;
  // Já rodou depois do horário de hoje? Então não roda de novo.
  if (automation.lastRunAt && new Date(automation.lastRunAt) >= target) return false;
  return true;
}

/**
 * Ciclo periódico: comandos agendados + gatilhos de prazo (due_soon /
 * due_overdue) + o aviso de prazo para os responsáveis. Chamado pela rota
 * interna que o server.js aciona.
 */
export async function runScheduledAutomations(): Promise<{ scheduled: number; dueTriggered: number; notified: number }> {
  await ensureTasksSchema();
  const pool = getPool();
  const now = new Date();
  let scheduled = 0;
  let dueTriggered = 0;
  let notified = 0;

  const { rows: scheduleRows } = await pool.query(
    `SELECT * FROM ${SCHEMA}.task_automations WHERE kind='schedule' AND enabled`
  );
  for (const row of scheduleRows) {
    const automation = mapAutomation(row);
    if (!scheduleIsDue(automation, now)) continue;
    // Agendado age no quadro, não num card específico: as ações que precisam de
    // card (mover, etiquetar) rodam sobre cada card aberto do quadro; as que não
    // precisam (create_card) rodam uma vez.
    const cardActions = automation.actions.filter((a) => a.type !== "create_card");
    const boardActions = automation.actions.filter((a) => a.type === "create_card");
    if (boardActions.length > 0) {
      await runActionsWithoutCard(automation, boardActions);
    }
    if (cardActions.length > 0) {
      const { rows: cards } = await pool.query<{ id: number }>(
        `SELECT id FROM ${SCHEMA}.tasks WHERE board_id=$1 AND NOT archived AND NOT is_template AND completed_at IS NULL`,
        [automation.boardId]
      );
      for (const card of cards) {
        await runActions({ ...automation, actions: cardActions }, card.id, { name: `⚡ ${automation.name}` });
      }
    }
    await pool.query(`UPDATE ${SCHEMA}.task_automations SET last_run_at = NOW() WHERE id=$1`, [automation.id]);
    scheduled += 1;
  }

  // Gatilhos de prazo: hoje/amanhã (due_soon) e vencido (due_overdue).
  const { rows: dueCards } = await pool.query<{ id: number; board_id: number; title: string; due_date: string; overdue: boolean }>(
    `SELECT id, board_id, title, due_date, (due_date < CURRENT_DATE) AS overdue
       FROM ${SCHEMA}.tasks
      WHERE NOT archived AND NOT is_template AND completed_at IS NULL
        AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + 1`
  );
  for (const card of dueCards) {
    const type: AutomationTriggerType = card.overdue ? "due_overdue" : "due_soon";
    const automations = (await listAutomations(card.board_id)).filter(
      (a) => a.kind === "rule" && a.enabled && a.trigger.type === type
    );
    for (const automation of automations) {
      await runActions(automation, card.id, { name: `⚡ ${automation.name}` });
      dueTriggered += 1;
    }
    const { rows: assignees } = await pool.query<{ member_id: number }>(
      `SELECT member_id FROM ${SCHEMA}.task_assignees WHERE task_id=$1`,
      [card.id]
    );
    if (assignees.length > 0) {
      await notifyTaskMembers(
        assignees.map((a) => a.member_id),
        { id: card.id, title: card.title, boardId: card.board_id },
        "task_due",
        card.overdue ? "Esta tarefa está atrasada." : "Esta tarefa vence hoje ou amanhã."
      );
      notified += 1;
    }
  }

  return { scheduled, dueTriggered, notified };
}

/** Ações de agendado que não dependem de um card existente (ex.: criar sprint). */
async function runActionsWithoutCard(automation: TaskAutomation, actions: AutomationAction[]): Promise<void> {
  const { applyCardTemplate } = await import("@/lib/taskDetails");
  for (const action of actions) {
    if (action.type === "create_card" && action.templateId) {
      await applyCardTemplate({
        templateId: Number(action.templateId),
        columnId: action.columnId ?? null,
        createdBy: null,
      });
    }
  }
  await logActivity({
    boardId: automation.boardId,
    actor: { name: `⚡ ${automation.name}` },
    action: "automation_scheduled",
    detail: { automation: automation.name },
  });
}

/** Reavalia o gatilho de checklist concluída (chamado ao marcar um item). */
export async function maybeTriggerChecklistComplete(taskId: number, boardId: number, actor: ActivityActor): Promise<void> {
  if (!(await checklistIsComplete(taskId))) return;
  await runAutomations({ type: "checklist_completed", boardId, taskId, actor });
}
