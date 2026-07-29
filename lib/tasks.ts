import { getPool } from "@/lib/db";
import { isSuperMaster, type PermissionUser } from "@/lib/permissions";

const SCHEMA = "dashboard";

/**
 * Gerenciador de tarefas (estilo Trello/ClickUp) da dashboard.
 *
 * Hierarquia: Setor (espaço) -> Quadro (kanban) -> Coluna -> Tarefa (card).
 * Equipe = grupo de usuários (team_members) que ganha acesso a setores.
 * Acesso: só super_master vê todos os setores. Todos os demais (inclusive admin)
 * veem os setores das equipes de que participam, mais os setores marcados como
 * `open_to_all` (ex.: o setor Geral). Estrutura (setores/equipes/quadros) exige
 * tasks.admin — administrar é uma coisa, enxergar é outra.
 */

export type TaskPriority = "baixa" | "media" | "alta" | "urgente";
export const TASK_PRIORITIES: TaskPriority[] = ["baixa", "media", "alta", "urgente"];

export interface TaskSector {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  position: number;
  archived: boolean;
  /** Setor visível para todo mundo, sem depender de equipe (ex.: Geral). */
  openToAll: boolean;
  boardCount?: number;
}

export interface TaskTeam {
  id: number;
  name: string;
  description: string | null;
  color: string;
  memberIds: number[];
  /** Setores que esta equipe destrava — usado só para exibição. */
  sectorNames: string[];
}

export interface TaskBoard {
  id: number;
  sectorId: number;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
}

export interface TaskColumn {
  id: number;
  boardId: number;
  name: string;
  color: string | null;
  position: number;
}

export interface TaskLabel {
  id: number;
  boardId: number;
  name: string;
  color: string;
}

export interface TaskCard {
  id: number;
  boardId: number;
  columnId: number | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  assigneeIds: number[];
  labelIds: number[];
  createdBy: number | null;
  createdAt: string;
}

let schemaReady = false;

export async function ensureTasksSchema(): Promise<void> {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_sectors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#6366f1',
      icon TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE ${SCHEMA}.task_sectors
      ADD COLUMN IF NOT EXISTS open_to_all BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#0ea5e9',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_team_members (
      team_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_teams(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL,
      PRIMARY KEY (team_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_sector_teams (
      sector_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_sectors(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_teams(id) ON DELETE CASCADE,
      PRIMARY KEY (sector_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_boards (
      id SERIAL PRIMARY KEY,
      sector_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_sectors(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_columns (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_labels (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b'
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.tasks (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
      column_id INTEGER REFERENCES ${SCHEMA}.task_columns(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'media',
      due_date DATE,
      position INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_assignees (
      task_id INTEGER NOT NULL REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_label_links (
      task_id INTEGER NOT NULL REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_board ON ${SCHEMA}.tasks(board_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_column ON ${SCHEMA}.tasks(column_id);
    CREATE INDEX IF NOT EXISTS idx_task_boards_sector ON ${SCHEMA}.task_boards(sector_id);
  `);
  schemaReady = true;
}

function normalizePriority(value: unknown): TaskPriority {
  return TASK_PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : "media";
}

/** Ids das equipes de que o usuário participa (casando por email do team_member). */
async function memberIdForUser(user: PermissionUser | null | undefined): Promise<number | null> {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return null;
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT id FROM ${SCHEMA}.team_members WHERE LOWER(email) = $1 LIMIT 1`,
    [email]
  );
  return rows[0]?.id ?? null;
}

/**
 * Só super_master vê todos os setores. Para os demais (inclusive admin) a lista é
 * os setores abertos a todos + os das equipes de que participam.
 */
export async function listSectorsForUser(user: PermissionUser | null | undefined): Promise<TaskSector[]> {
  await ensureTasksSchema();
  const pool = getPool();
  const boardCount = `(SELECT COUNT(*) FROM ${SCHEMA}.task_boards b WHERE b.sector_id = s.id AND NOT b.archived) AS board_count`;

  let rows;
  if (isSuperMaster(user)) {
    ({ rows } = await pool.query(
      `SELECT s.*, ${boardCount}
       FROM ${SCHEMA}.task_sectors s
       WHERE NOT s.archived
       ORDER BY s.position, s.id`
    ));
  } else {
    // memberId nulo (usuário sem cadastro em team_members) ainda enxerga os
    // setores abertos — o Geral não pode depender de vínculo de equipe.
    const memberId = await memberIdForUser(user);
    ({ rows } = await pool.query(
      `SELECT DISTINCT s.*, ${boardCount}
       FROM ${SCHEMA}.task_sectors s
       WHERE NOT s.archived
         AND (
           s.open_to_all
           OR EXISTS (
             SELECT 1 FROM ${SCHEMA}.task_sector_teams st
             JOIN ${SCHEMA}.task_team_members tm ON tm.team_id = st.team_id
             WHERE st.sector_id = s.id AND tm.member_id = $1
           )
         )
       ORDER BY s.position, s.id`,
      [memberId]
    ));
  }
  return rows.map(mapSector);
}

export async function userCanAccessSector(
  user: PermissionUser | null | undefined,
  sectorId: number
): Promise<boolean> {
  if (isSuperMaster(user)) return true;
  const memberId = await memberIdForUser(user);
  const { rows } = await getPool().query(
    `SELECT 1 FROM ${SCHEMA}.task_sectors s
     WHERE s.id = $1
       AND (
         s.open_to_all
         OR EXISTS (
           SELECT 1 FROM ${SCHEMA}.task_sector_teams st
           JOIN ${SCHEMA}.task_team_members tm ON tm.team_id = st.team_id
           WHERE st.sector_id = s.id AND tm.member_id = $2
         )
       )
     LIMIT 1`,
    [sectorId, memberId]
  );
  return rows.length > 0;
}

function mapSector(r: Record<string, unknown>): TaskSector {
  return {
    id: Number(r.id),
    name: String(r.name),
    description: (r.description as string) ?? null,
    color: String(r.color),
    icon: (r.icon as string) ?? null,
    position: Number(r.position),
    archived: Boolean(r.archived),
    openToAll: Boolean(r.open_to_all),
    boardCount: r.board_count !== undefined ? Number(r.board_count) : undefined,
  };
}

// ── Setores ────────────────────────────────────────────────────────────────
export async function createSector(input: {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  openToAll?: boolean;
  createdBy?: number | null;
}): Promise<TaskSector> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_sectors (name, description, color, icon, open_to_all, created_by,
       position)
     VALUES ($1,$2,COALESCE($3,'#6366f1'),$4,COALESCE($5,false),$6,
       COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_sectors),0))
     RETURNING *`,
    [
      input.name.trim(),
      input.description ?? null,
      input.color ?? null,
      input.icon ?? null,
      input.openToAll ?? null,
      input.createdBy ?? null,
    ]
  );
  return mapSector(rows[0]);
}

export async function updateSector(
  id: number,
  input: {
    name?: string;
    description?: string | null;
    color?: string;
    icon?: string | null;
    archived?: boolean;
    openToAll?: boolean;
  }
): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_sectors SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       color = COALESCE($4, color),
       icon = COALESCE($5, icon),
       archived = COALESCE($6, archived),
       open_to_all = COALESCE($7, open_to_all),
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      input.name ?? null,
      input.description ?? null,
      input.color ?? null,
      input.icon ?? null,
      input.archived ?? null,
      input.openToAll ?? null,
    ]
  );
}

export async function setSectorTeams(sectorId: number, teamIds: number[]): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM ${SCHEMA}.task_sector_teams WHERE sector_id = $1`, [sectorId]);
  for (const teamId of teamIds) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_sector_teams (sector_id, team_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [sectorId, teamId]
    );
  }
}

export async function getSectorTeamIds(sectorId: number): Promise<number[]> {
  const { rows } = await getPool().query<{ team_id: number }>(
    `SELECT team_id FROM ${SCHEMA}.task_sector_teams WHERE sector_id = $1`,
    [sectorId]
  );
  return rows.map((r) => r.team_id);
}

// ── Equipes ────────────────────────────────────────────────────────────────
export async function listTeams(): Promise<TaskTeam[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT t.*,
       COALESCE(array_agg(DISTINCT tm.member_id) FILTER (WHERE tm.member_id IS NOT NULL), '{}') AS member_ids,
       COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS sector_names
     FROM ${SCHEMA}.task_teams t
     LEFT JOIN ${SCHEMA}.task_team_members tm ON tm.team_id = t.id
     LEFT JOIN ${SCHEMA}.task_sector_teams st ON st.team_id = t.id
     LEFT JOIN ${SCHEMA}.task_sectors s ON s.id = st.sector_id AND NOT s.archived
     GROUP BY t.id ORDER BY t.name`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    description: (r.description as string) ?? null,
    color: String(r.color),
    memberIds: ((r.member_ids as number[]) ?? []).map(Number),
    sectorNames: ((r.sector_names as string[]) ?? []).map(String),
  }));
}

export async function createTeam(input: { name: string; description?: string | null; color?: string }): Promise<number> {
  await ensureTasksSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.task_teams (name, description, color) VALUES ($1,$2,COALESCE($3,'#0ea5e9')) RETURNING id`,
    [input.name.trim(), input.description ?? null, input.color ?? null]
  );
  return rows[0].id;
}

export async function updateTeam(
  id: number,
  input: { name?: string; description?: string | null; color?: string }
): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_teams SET name=COALESCE($2,name), description=COALESCE($3,description), color=COALESCE($4,color) WHERE id=$1`,
    [id, input.name ?? null, input.description ?? null, input.color ?? null]
  );
}

export async function deleteTeam(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_teams WHERE id = $1`, [id]);
}

export async function setTeamMembers(teamId: number, memberIds: number[]): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM ${SCHEMA}.task_team_members WHERE team_id = $1`, [teamId]);
  for (const memberId of memberIds) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_team_members (team_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [teamId, memberId]
    );
  }
}

// ── Quadros / colunas ────────────────────────────────────────────────────────
const DEFAULT_COLUMNS = [
  { name: "A fazer", color: "#94a3b8" },
  { name: "Fazendo", color: "#3b82f6" },
  // Sem esta coluna, o que depende de outra pessoa fica parado em "Fazendo"
  // fingindo que anda.
  { name: "Travado / Aguardando terceiro", color: "#f59e0b" },
  { name: "Concluído", color: "#22c55e" },
];

export async function listBoards(sectorId: number): Promise<TaskBoard[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM ${SCHEMA}.task_boards WHERE sector_id = $1 AND NOT archived ORDER BY position, id`,
    [sectorId]
  );
  return rows.map(mapBoard);
}

function mapBoard(r: Record<string, unknown>): TaskBoard {
  return {
    id: Number(r.id),
    sectorId: Number(r.sector_id),
    name: String(r.name),
    description: (r.description as string) ?? null,
    position: Number(r.position),
    archived: Boolean(r.archived),
  };
}

export async function createBoard(input: {
  sectorId: number;
  name: string;
  description?: string | null;
}): Promise<TaskBoard> {
  await ensureTasksSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.task_boards (sector_id, name, description, position)
     VALUES ($1,$2,$3, COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_boards WHERE sector_id=$1),0))
     RETURNING *`,
    [input.sectorId, input.name.trim(), input.description ?? null]
  );
  const board = mapBoard(rows[0]);
  // Colunas padrão
  let pos = 0;
  for (const col of DEFAULT_COLUMNS) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_columns (board_id, name, color, position) VALUES ($1,$2,$3,$4)`,
      [board.id, col.name, col.color, pos++]
    );
  }
  return board;
}

export async function updateBoard(
  id: number,
  input: { name?: string; description?: string | null; archived?: boolean }
): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_boards SET name=COALESCE($2,name), description=COALESCE($3,description), archived=COALESCE($4,archived) WHERE id=$1`,
    [id, input.name ?? null, input.description ?? null, input.archived ?? null]
  );
}

export async function createColumn(boardId: number, name: string, color?: string): Promise<TaskColumn> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_columns (board_id, name, color, position)
     VALUES ($1,$2,$3, COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_columns WHERE board_id=$1),0))
     RETURNING *`,
    [boardId, name.trim(), color ?? null]
  );
  const r = rows[0];
  return { id: Number(r.id), boardId, name: String(r.name), color: (r.color as string) ?? null, position: Number(r.position) };
}

export async function updateColumn(id: number, input: { name?: string; color?: string }): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_columns SET name=COALESCE($2,name), color=COALESCE($3,color) WHERE id=$1`,
    [id, input.name ?? null, input.color ?? null]
  );
}

export async function deleteColumn(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_columns WHERE id = $1`, [id]);
}

// ── Board completo (colunas + tarefas + etiquetas) ───────────────────────────
export interface BoardData {
  board: TaskBoard;
  columns: TaskColumn[];
  tasks: TaskCard[];
  labels: TaskLabel[];
}

export async function getBoardData(boardId: number): Promise<BoardData | null> {
  await ensureTasksSchema();
  const pool = getPool();
  const boardRes = await pool.query(`SELECT * FROM ${SCHEMA}.task_boards WHERE id = $1`, [boardId]);
  if (!boardRes.rows[0]) return null;
  const [colsRes, tasksRes, labelsRes] = await Promise.all([
    pool.query(`SELECT * FROM ${SCHEMA}.task_columns WHERE board_id=$1 ORDER BY position, id`, [boardId]),
    pool.query(
      `SELECT t.*,
         COALESCE(array_agg(DISTINCT a.member_id) FILTER (WHERE a.member_id IS NOT NULL),'{}') AS assignee_ids,
         COALESCE(array_agg(DISTINCT ll.label_id) FILTER (WHERE ll.label_id IS NOT NULL),'{}') AS label_ids
       FROM ${SCHEMA}.tasks t
       LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
       LEFT JOIN ${SCHEMA}.task_label_links ll ON ll.task_id = t.id
       WHERE t.board_id=$1 AND NOT t.archived
       GROUP BY t.id ORDER BY t.position, t.id`,
      [boardId]
    ),
    pool.query(`SELECT * FROM ${SCHEMA}.task_labels WHERE board_id=$1 ORDER BY id`, [boardId]),
  ]);
  return {
    board: mapBoard(boardRes.rows[0]),
    columns: colsRes.rows.map((r) => ({
      id: Number(r.id),
      boardId,
      name: String(r.name),
      color: (r.color as string) ?? null,
      position: Number(r.position),
    })),
    tasks: tasksRes.rows.map(mapTask),
    labels: labelsRes.rows.map((r) => ({
      id: Number(r.id),
      boardId,
      name: String(r.name),
      color: String(r.color),
    })),
  };
}

function mapTask(r: Record<string, unknown>): TaskCard {
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    columnId: r.column_id === null ? null : Number(r.column_id),
    title: String(r.title),
    description: (r.description as string) ?? null,
    priority: normalizePriority(r.priority),
    dueDate: r.due_date ? new Date(r.due_date as string).toISOString().slice(0, 10) : null,
    position: Number(r.position),
    completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
    assigneeIds: ((r.assignee_ids as number[]) ?? []).map(Number),
    labelIds: ((r.label_ids as number[]) ?? []).map(Number),
    createdBy: r.created_by === null ? null : Number(r.created_by),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

// ── Tarefas ──────────────────────────────────────────────────────────────────
export async function createTask(input: {
  boardId: number;
  columnId: number | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeIds?: number[];
  labelIds?: number[];
  createdBy?: number | null;
}): Promise<TaskCard> {
  await ensureTasksSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.tasks (board_id, column_id, title, description, priority, due_date, created_by, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.tasks WHERE board_id=$1 AND column_id IS NOT DISTINCT FROM $2),0))
     RETURNING *`,
    [
      input.boardId,
      input.columnId,
      input.title.trim(),
      input.description ?? null,
      normalizePriority(input.priority),
      input.dueDate || null,
      input.createdBy ?? null,
    ]
  );
  const task = mapTask({ ...rows[0], assignee_ids: [], label_ids: [] });
  if (input.assigneeIds?.length) await setTaskAssignees(task.id, input.assigneeIds);
  if (input.labelIds?.length) await setTaskLabels(task.id, input.labelIds);
  return { ...task, assigneeIds: input.assigneeIds ?? [], labelIds: input.labelIds ?? [] };
}

export async function updateTask(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
    completed?: boolean;
    archived?: boolean;
  }
): Promise<void> {
  // due_date e description não podem usar COALESCE: o usuário precisa conseguir
  // APAGAR um prazo/descrição, e COALESCE(null, valor) devolveria o valor antigo.
  // Por isso a flag "mexeu neste campo?" ($5/$7) separada do valor novo ($6/$8).
  const touchDueDate = input.dueDate !== undefined;
  const touchDescription = input.description !== undefined;
  await getPool().query(
    `UPDATE ${SCHEMA}.tasks SET
       title = COALESCE($2, title),
       priority = COALESCE($3, priority),
       completed_at = CASE WHEN $4::boolean IS NULL THEN completed_at WHEN $4 THEN NOW() ELSE NULL END,
       due_date = CASE WHEN $5::boolean THEN $6::date ELSE due_date END,
       description = CASE WHEN $7::boolean THEN $8::text ELSE description END,
       archived = COALESCE($9, archived),
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      input.title ?? null,
      input.priority ? normalizePriority(input.priority) : null,
      input.completed === undefined ? null : input.completed,
      touchDueDate,
      touchDueDate ? input.dueDate || null : null,
      touchDescription,
      touchDescription ? input.description || null : null,
      input.archived ?? null,
    ]
  );
}

/**
 * Move a tarefa para `toColumnId` e grava a ordem exata da coluna destino
 * (`orderedTaskIds`). Serve tanto pra trocar de coluna quanto pra reordenar
 * dentro da mesma. Tudo numa transação: ou a coluna inteira fica coerente, ou
 * nada muda.
 */
export async function moveTask(taskId: number, toColumnId: number | null, orderedTaskIds: number[]): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // A coluna de destino precisa ser do mesmo quadro da tarefa. Sem isso, uma
    // chamada de API à mão joga o card numa coluna de outro setor e ele some
    // dos dois quadros (board_id e column_id passam a discordar).
    if (toColumnId !== null) {
      const { rows } = await client.query(
        `SELECT 1 FROM ${SCHEMA}.tasks t
           JOIN ${SCHEMA}.task_columns c ON c.id = $2
          WHERE t.id = $1 AND c.board_id = t.board_id
          LIMIT 1`,
        [taskId, toColumnId]
      );
      if (rows.length === 0) {
        throw new Error("Coluna de destino nao pertence ao quadro da tarefa.");
      }
    }

    await client.query(`UPDATE ${SCHEMA}.tasks SET column_id = $2, updated_at = NOW() WHERE id = $1`, [
      taskId,
      toColumnId,
    ]);

    if (orderedTaskIds.length > 0) {
      // Uma query só, em vez de um UPDATE por card.
      await client.query(
        `UPDATE ${SCHEMA}.tasks t
            SET position = o.ord - 1, updated_at = NOW()
           FROM unnest($1::int[]) WITH ORDINALITY AS o(task_id, ord)
          WHERE t.id = o.task_id`,
        [orderedTaskIds]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setTaskAssignees(taskId: number, memberIds: number[]): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM ${SCHEMA}.task_assignees WHERE task_id = $1`, [taskId]);
  for (const memberId of memberIds) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_assignees (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [taskId, memberId]
    );
  }
}

export async function setTaskLabels(taskId: number, labelIds: number[]): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM ${SCHEMA}.task_label_links WHERE task_id = $1`, [taskId]);
  for (const labelId of labelIds) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.task_label_links (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [taskId, labelId]
    );
  }
}

export async function createLabel(boardId: number, name: string, color: string): Promise<TaskLabel> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_labels (board_id, name, color) VALUES ($1,$2,$3) RETURNING *`,
    [boardId, name.trim(), color]
  );
  const r = rows[0];
  return { id: Number(r.id), boardId, name: String(r.name), color: String(r.color) };
}

export async function updateLabel(id: number, input: { name?: string; color?: string }): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_labels SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1`,
    [id, input.name?.trim() || null, input.color ?? null]
  );
}

/** Apagar a etiqueta tira ela de todos os cards (task_label_links tem CASCADE). */
export async function deleteLabel(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_labels WHERE id = $1`, [id]);
}

async function boardIdOfLabel(labelId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM ${SCHEMA}.task_labels WHERE id = $1`,
    [labelId]
  );
  return rows[0]?.board_id ?? null;
}

export async function userCanAccessLabel(
  user: PermissionUser | null | undefined,
  labelId: number
): Promise<boolean> {
  const boardId = await boardIdOfLabel(labelId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}

/** Descobre o setor de um quadro (para checagem de acesso nas rotas). */
export async function sectorIdOfBoard(boardId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ sector_id: number }>(
    `SELECT sector_id FROM ${SCHEMA}.task_boards WHERE id = $1`,
    [boardId]
  );
  return rows[0]?.sector_id ?? null;
}

async function boardIdOfColumn(columnId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM ${SCHEMA}.task_columns WHERE id = $1`,
    [columnId]
  );
  return rows[0]?.board_id ?? null;
}

async function boardIdOfTask(taskId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM ${SCHEMA}.tasks WHERE id = $1`,
    [taskId]
  );
  return rows[0]?.board_id ?? null;
}

/** Acesso do usuário a um quadro (resolve setor). */
export async function userCanAccessBoard(
  user: PermissionUser | null | undefined,
  boardId: number
): Promise<boolean> {
  const sectorId = await sectorIdOfBoard(boardId);
  return sectorId === null ? false : userCanAccessSector(user, sectorId);
}

export async function userCanAccessColumn(user: PermissionUser | null | undefined, columnId: number): Promise<boolean> {
  const boardId = await boardIdOfColumn(columnId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}

export async function userCanAccessTask(user: PermissionUser | null | undefined, taskId: number): Promise<boolean> {
  const boardId = await boardIdOfTask(taskId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}
