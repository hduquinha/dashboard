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

/** `sector` = só quem enxerga o setor; `workspace` = qualquer um com view.tasks. */
export type BoardVisibility = "sector" | "workspace";
export const BOARD_VISIBILITIES: BoardVisibility[] = ["sector", "workspace"];

export interface TaskBoard {
  id: number;
  sectorId: number;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
  visibility: BoardVisibility;
}

export interface TaskColumn {
  id: number;
  boardId: number;
  name: string;
  color: string | null;
  position: number;
  archived: boolean;
  /** Limite de cards em andamento (WIP). null = sem limite. */
  wipLimit: number | null;
  /** Entrar nesta coluna marca a tarefa como concluída (e sair desmarca). */
  completesTask: boolean;
}

export interface TaskLabel {
  id: number;
  boardId: number;
  name: string;
  color: string;
}

export type TaskKind = "pontual" | "recorrente" | "painel_leads";
export const TASK_KINDS: TaskKind[] = ["pontual", "recorrente", "painel_leads"];

/** Kind desconhecido (banco mais novo que o código, ou lixo) cai em pontual. */
export function normalizeTaskKind(value: unknown): TaskKind {
  return value === "recorrente" || value === "painel_leads" ? value : "pontual";
}

export interface TaskCard {
  id: number;
  boardId: number;
  /**
   * "pontual" = tarefa com prazo, que se conclui. "recorrente" = rotina que
   * nunca é concluída e acumula registros de produção (ver lib/taskProduction).
   * A rotina existe UMA vez; o que se repete são os registros, não o card.
   * "painel_leads" = card de leitura: mostra a movimentação de leads de um
   * vendedor (ver lib/leadMovementLog). Não tem prazo nem conclusão porque não
   * é trabalho a fazer, é relatório.
   */
  kind: TaskKind;
  /** Vendedor de quem este card mostra o histórico — só em kind painel_leads. */
  panelMemberId: number | null;
  /** Painel deste vendedor também registra prospecção no Instagram. */
  panelInstagram: boolean;
  /** Último registro de produção — só existe em rotina. Alimenta o card do quadro. */
  lastProduction: { date: string; label: string | null; memberName: string | null } | null;
  /** Data do último registro de quem está vendo o quadro. Base do selo "Pendente hoje". */
  myLastProductionDate: string | null;
  columnId: number | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  /** Data de início — é o que dá largura ao card na Timeline. */
  startDate: string | null;
  dueDate: string | null;
  /** "HH:MM" quando a tarefa tem hora marcada (ligação de retorno, consultoria). */
  dueTime: string | null;
  /** Lead do CRM a que esta tarefa pertence, quando criada pela ficha dele. */
  inscricaoId: number | null;
  position: number;
  completedAt: string | null;
  assigneeIds: number[];
  labelIds: number[];
  createdBy: number | null;
  /** Nome de quem criou o card; null quando o autor não é mais um usuário. */
  createdByName: string | null;
  createdAt: string;
  archivedAt?: string | null;
  /** Capa: cor sólida ou imagem (anexo do próprio card). */
  coverColor: string | null;
  coverAttachmentId: number | null;
  /** Contadores mostrados no card sem precisar abrir (estilo Trello). */
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
  attachmentCount: number;
  /** Valores dos campos personalizados, por id do campo. */
  customValues: Record<number, string>;
}

export interface TaskCustomField {
  id: number;
  boardId: number;
  name: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  options: string[];
  showOnCard: boolean;
  position: number;
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
  await getPool().query(TASKS_SCHEMA_V2);
  schemaReady = true;
}

/**
 * Segunda leva do schema (checklists, comentários, anexos, atividade, campos
 * personalizados, capas, templates, automações, webhooks e tokens de API).
 * Separado do bloco original só por legibilidade — roda na mesma chamada de
 * `ensureTasksSchema` e é todo idempotente (IF NOT EXISTS).
 */
const TASKS_SCHEMA_V2 = `
  -- Card: data de início (para timeline/Gantt), capa, arquivamento datado e
  -- marcação de template (template é um card que não aparece no quadro).
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS start_date DATE;
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS cover_color TEXT;
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS cover_attachment_id INTEGER;
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;

  -- Card de painel de leads: de qual vendedor ele mostra o histórico. Fica no
  -- card e não em task_assignees porque "de quem é o relatório" não é a mesma
  -- pergunta que "quem responde por esta tarefa".
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS panel_member_id INTEGER;

  -- O bloco de prospecção do Instagram é opcional por card: nem todo vendedor
  -- trabalha o direct. Quem liga e desliga é o master (ver lib/instagramOutreach
  -- e a rota /api/commercial/movimentacao). Nasce desligado.
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS panel_instagram BOOLEAN NOT NULL DEFAULT false;

  -- A constraint de kind nasceu na migração 024 com dois valores e não estava
  -- no ensure — quem criou a base pelo código não a tinha, e quem rodou a
  -- migração ficou preso a 'pontual'/'recorrente'. Recriar aqui (o mesmo padrão
  -- de team_members_role_check) deixa os dois caminhos com a mesma lista.
  ALTER TABLE ${SCHEMA}.tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
  ALTER TABLE ${SCHEMA}.tasks
    ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('pontual', 'recorrente', 'painel_leads'));

  -- Coluna: arquivamento, limite de WIP e a marca de "esta coluna conclui a
  -- tarefa" (é o que faz arrastar pra Concluído carimbar completed_at).
  ALTER TABLE ${SCHEMA}.task_columns ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE ${SCHEMA}.task_columns ADD COLUMN IF NOT EXISTS wip_limit INTEGER;
  ALTER TABLE ${SCHEMA}.task_columns ADD COLUMN IF NOT EXISTS completes_task BOOLEAN NOT NULL DEFAULT false;

  -- Quadro: visibilidade (só o setor × todos que entram em Tarefas).
  ALTER TABLE ${SCHEMA}.task_boards ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'sector';

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_checklists (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_checklist_items (
    id SERIAL PRIMARY KEY,
    checklist_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_checklists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    done_at TIMESTAMPTZ,
    member_id INTEGER,
    due_date DATE,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
    member_id INTEGER,
    author_name TEXT NOT NULL,
    author_email TEXT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_comment_reactions (
    comment_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_comments(id) ON DELETE CASCADE,
    actor_email TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (comment_id, actor_email, emoji)
  );

  -- Anexo: arquivo guardado no próprio banco (mesmo padrão dos comprovantes do
  -- Financeiro) ou link externo (kind='link', content nulo).
  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_attachments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'file',
    name TEXT NOT NULL,
    url TEXT,
    mime TEXT,
    size_bytes INTEGER,
    content BYTEA,
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_activity (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
    board_id INTEGER REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
    actor_name TEXT,
    actor_email TEXT,
    action TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_custom_fields (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    show_on_card BOOLEAN NOT NULL DEFAULT false,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_custom_values (
    task_id INTEGER NOT NULL REFERENCES ${SCHEMA}.tasks(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_custom_fields(id) ON DELETE CASCADE,
    value TEXT,
    PRIMARY KEY (task_id, field_id)
  );

  -- Template de card: o conteúdo fica em JSON (título, descrição, checklists,
  -- etiquetas…) em vez de um card oculto, pra não poluir contagens do quadro.
  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_card_templates (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Automação (Butler): kind='rule' dispara por evento, 'button' é acionado à
  -- mão dentro do card, 'schedule' roda por horário.
  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_automations (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'rule',
    name TEXT NOT NULL,
    trigger JSONB NOT NULL DEFAULT '{}'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    schedule_kind TEXT,
    schedule_time TEXT,
    schedule_weekday INTEGER,
    schedule_day INTEGER,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_webhooks (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES ${SCHEMA}.task_boards(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_status TEXT,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Token de API: guardamos só o hash. O valor em claro aparece uma única vez,
  -- na criação — igual a um PAT.
  CREATE TABLE IF NOT EXISTS ${SCHEMA}.task_api_tokens (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    user_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked BOOLEAN NOT NULL DEFAULT false
  );

  CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON ${SCHEMA}.task_checklists(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_comments_task ON ${SCHEMA}.task_comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON ${SCHEMA}.task_attachments(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_activity_task ON ${SCHEMA}.task_activity(task_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_activity_board ON ${SCHEMA}.task_activity(board_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_automations_board ON ${SCHEMA}.task_automations(board_id);

  -- Tarefa ligada a um lead do CRM, com hora marcada. É a mesma tarefa que
  -- aparece no quadro em /tarefas — o Kanban do vendedor só a espelha em forma
  -- de lista. Por isso mora aqui e não numa tabela de "compromissos" à parte:
  -- duas tabelas dariam duas versões da mesma tarefa.
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS inscricao_id INTEGER;
  -- Hora separada da data porque due_date já é DATE e é usada por automações,
  -- filtros e Timeline; virar TIMESTAMPTZ mudaria o significado dela em tudo.
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS due_time TIME;
  -- Carimbo do lembrete de horário, para o ciclo de 5 minutos avisar uma vez só.
  ALTER TABLE ${SCHEMA}.tasks ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

  CREATE INDEX IF NOT EXISTS idx_tasks_inscricao
    ON ${SCHEMA}.tasks(inscricao_id) WHERE inscricao_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_agenda
    ON ${SCHEMA}.tasks(due_date) WHERE due_date IS NOT NULL AND NOT archived;

  -- A agenda entra pelo responsável (task_assignees.member_id), mas a chave
  -- primária é (task_id, member_id): com member_id na segunda posição, buscar
  -- "as tarefas do fulano" varre o índice inteiro. Este índice é o caminho de
  -- entrada real da consulta do Kanban.
  CREATE INDEX IF NOT EXISTS idx_task_assignees_member
    ON ${SCHEMA}.task_assignees(member_id);

  -- Integridade do vínculo tarefa → lead. Sem a FK nada impedia um
  -- inscricao_id apontando para lead inexistente; com ON DELETE SET NULL a
  -- tarefa sobrevive à remoção do lead (o histórico continua no quadro) em vez
  -- de sumir junto ou travar a exclusão. Na prática o CRM só faz soft delete
  -- (payload.dashboard_excluido), então isto é rede de segurança.
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tasks_inscricao_id_fkey'
    ) THEN
      ALTER TABLE ${SCHEMA}.tasks
        ADD CONSTRAINT tasks_inscricao_id_fkey
        FOREIGN KEY (inscricao_id) REFERENCES inscricoes.inscricoes(id) ON DELETE SET NULL;
    END IF;
  END $$;
`;

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
  { name: "A fazer", color: "#94a3b8", completes: false },
  { name: "Fazendo", color: "#3b82f6", completes: false },
  // Sem esta coluna, o que depende de outra pessoa fica parado em "Fazendo"
  // fingindo que anda.
  { name: "Travado / Aguardando terceiro", color: "#f59e0b", completes: false },
  { name: "Concluído", color: "#22c55e", completes: true },
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
    visibility: r.visibility === "workspace" ? "workspace" : "sector",
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
      `INSERT INTO ${SCHEMA}.task_columns (board_id, name, color, position, completes_task) VALUES ($1,$2,$3,$4,$5)`,
      [board.id, col.name, col.color, pos++, col.completes]
    );
  }
  return board;
}

// ── Campos personalizados ────────────────────────────────────────────────────
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "checkbox"] as const;

export async function listCustomFields(boardId: number): Promise<TaskCustomField[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM ${SCHEMA}.task_custom_fields WHERE board_id=$1 ORDER BY position, id`,
    [boardId]
  );
  return rows.map(mapCustomField);
}

export async function createCustomField(input: {
  boardId: number;
  name: string;
  type: TaskCustomField["type"];
  options?: string[];
  showOnCard?: boolean;
}): Promise<TaskCustomField> {
  const type = CUSTOM_FIELD_TYPES.includes(input.type) ? input.type : "text";
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_custom_fields (board_id, name, type, options, show_on_card, position)
     VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,false),
       COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_custom_fields WHERE board_id=$1),0))
     RETURNING *`,
    [input.boardId, input.name.trim(), type, JSON.stringify(input.options ?? []), input.showOnCard ?? null]
  );
  return mapCustomField(rows[0]);
}

export async function updateCustomField(
  id: number,
  input: { name?: string; options?: string[]; showOnCard?: boolean }
): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_custom_fields SET
       name = COALESCE($2,name),
       options = COALESCE($3::jsonb, options),
       show_on_card = COALESCE($4, show_on_card)
     WHERE id=$1`,
    [id, input.name?.trim() || null, input.options ? JSON.stringify(input.options) : null, input.showOnCard ?? null]
  );
}

export async function deleteCustomField(id: number): Promise<void> {
  await getPool().query(`DELETE FROM ${SCHEMA}.task_custom_fields WHERE id=$1`, [id]);
}

/** Grava (ou apaga, com valor vazio) o valor de um campo personalizado num card. */
export async function setCustomValue(taskId: number, fieldId: number, value: string | null): Promise<void> {
  const pool = getPool();
  if (value === null || value === "") {
    await pool.query(`DELETE FROM ${SCHEMA}.task_custom_values WHERE task_id=$1 AND field_id=$2`, [taskId, fieldId]);
    return;
  }
  await pool.query(
    `INSERT INTO ${SCHEMA}.task_custom_values (task_id, field_id, value) VALUES ($1,$2,$3)
     ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
    [taskId, fieldId, value]
  );
}

async function boardIdOfCustomField(fieldId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ board_id: number }>(
    `SELECT board_id FROM ${SCHEMA}.task_custom_fields WHERE id=$1`,
    [fieldId]
  );
  return rows[0]?.board_id ?? null;
}

export async function userCanAccessCustomField(
  user: PermissionUser | null | undefined,
  fieldId: number
): Promise<boolean> {
  const boardId = await boardIdOfCustomField(fieldId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}

export async function updateBoard(
  id: number,
  input: { name?: string; description?: string | null; archived?: boolean; visibility?: BoardVisibility }
): Promise<void> {
  await getPool().query(
    `UPDATE ${SCHEMA}.task_boards SET name=COALESCE($2,name), description=COALESCE($3,description),
       archived=COALESCE($4,archived), visibility=COALESCE($5,visibility) WHERE id=$1`,
    [
      id,
      input.name ?? null,
      input.description ?? null,
      input.archived ?? null,
      input.visibility && BOARD_VISIBILITIES.includes(input.visibility) ? input.visibility : null,
    ]
  );
}

/**
 * Todos os quadros que o usuário enxerga, de todos os setores — é o que
 * alimenta a visão de Workspace (vários quadros lado a lado) com os
 * contadores de card aberto/atrasado por quadro.
 */
export interface WorkspaceBoard extends TaskBoard {
  sectorName: string;
  sectorColor: string;
  openCount: number;
  overdueCount: number;
  doneCount: number;
}

export async function listWorkspaceBoards(user: PermissionUser | null | undefined): Promise<WorkspaceBoard[]> {
  const sectors = await listSectorsForUser(user);
  const ids = sectors.map((s) => s.id);
  const { rows } = await getPool().query(
    `SELECT b.*, s.name AS sector_name, s.color AS sector_color,
       (SELECT COUNT(*) FROM ${SCHEMA}.tasks t WHERE t.board_id=b.id AND NOT t.archived AND NOT t.is_template
          AND t.completed_at IS NULL) AS open_count,
       (SELECT COUNT(*) FROM ${SCHEMA}.tasks t WHERE t.board_id=b.id AND NOT t.archived AND NOT t.is_template
          AND t.completed_at IS NULL AND t.due_date < CURRENT_DATE) AS overdue_count,
       (SELECT COUNT(*) FROM ${SCHEMA}.tasks t WHERE t.board_id=b.id AND NOT t.archived AND NOT t.is_template
          AND t.completed_at IS NOT NULL) AS done_count
     FROM ${SCHEMA}.task_boards b
     JOIN ${SCHEMA}.task_sectors s ON s.id = b.sector_id
     WHERE (b.sector_id = ANY($1::int[]) OR b.visibility = 'workspace') AND NOT b.archived
     ORDER BY s.position, s.id, b.position, b.id`,
    [ids]
  );
  return rows.map((r) => ({
    ...mapBoard(r),
    sectorName: String(r.sector_name),
    sectorColor: String(r.sector_color),
    openCount: Number(r.open_count),
    overdueCount: Number(r.overdue_count),
    doneCount: Number(r.done_count),
  }));
}

export async function createColumn(
  boardId: number,
  name: string,
  color?: string,
  options?: { wipLimit?: number | null; completesTask?: boolean }
): Promise<TaskColumn> {
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.task_columns (board_id, name, color, wip_limit, completes_task, position)
     VALUES ($1,$2,$3,$4,COALESCE($5,false),
       COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.task_columns WHERE board_id=$1),0))
     RETURNING *`,
    [boardId, name.trim(), color ?? null, options?.wipLimit ?? null, options?.completesTask ?? null]
  );
  return mapColumn(rows[0]);
}

export async function updateColumn(
  id: number,
  input: { name?: string; color?: string; wipLimit?: number | null; completesTask?: boolean; archived?: boolean }
): Promise<void> {
  const touchWip = input.wipLimit !== undefined;
  await getPool().query(
    `UPDATE ${SCHEMA}.task_columns SET
       name = COALESCE($2,name),
       color = COALESCE($3,color),
       wip_limit = CASE WHEN $4::boolean THEN $5::int ELSE wip_limit END,
       completes_task = COALESCE($6, completes_task),
       archived = COALESCE($7, archived)
     WHERE id=$1`,
    [
      id,
      input.name ?? null,
      input.color ?? null,
      touchWip,
      touchWip ? input.wipLimit : null,
      input.completesTask ?? null,
      input.archived ?? null,
    ]
  );
}

/** Reordena as colunas do quadro (arrastar cabeçalho de lista). */
export async function reorderColumns(boardId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await getPool().query(
    `UPDATE ${SCHEMA}.task_columns c
        SET position = o.ord - 1
       FROM unnest($2::int[]) WITH ORDINALITY AS o(col_id, ord)
      WHERE c.id = o.col_id AND c.board_id = $1`,
    [boardId, orderedIds]
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
  customFields: TaskCustomField[];
}

/**
 * Subconsulta usada em toda listagem de card: agrega responsáveis, etiquetas,
 * contadores (checklist/comentário/anexo) e os valores dos campos
 * personalizados. Fica numa constante porque a listagem do quadro, o arquivo e
 * a busca precisam do MESMO formato — card com contadores faltando some da tela.
 */
const TASK_SELECT = `
  SELECT t.*,
    -- Quem criou o card. Resolvido aqui, e não pela lista de membros da tela,
    -- porque aquela lista só traz gente ATIVA: card criado por quem saiu da
    -- escola perderia o autor justamente quando ele é mais útil de saber.
    (SELECT mc.name FROM ${SCHEMA}.team_members mc WHERE mc.id = t.created_by) AS created_by_name,
    COALESCE(array_agg(DISTINCT a.member_id) FILTER (WHERE a.member_id IS NOT NULL),'{}') AS assignee_ids,
    COALESCE(array_agg(DISTINCT ll.label_id) FILTER (WHERE ll.label_id IS NOT NULL),'{}') AS label_ids,
    (SELECT COUNT(*) FROM ${SCHEMA}.task_checklist_items ci
       JOIN ${SCHEMA}.task_checklists c ON c.id = ci.checklist_id WHERE c.task_id = t.id) AS checklist_total,
    (SELECT COUNT(*) FROM ${SCHEMA}.task_checklist_items ci
       JOIN ${SCHEMA}.task_checklists c ON c.id = ci.checklist_id WHERE c.task_id = t.id AND ci.done) AS checklist_done,
    (SELECT COUNT(*) FROM ${SCHEMA}.task_comments cm WHERE cm.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM ${SCHEMA}.task_attachments at WHERE at.task_id = t.id) AS attachment_count,
    (SELECT COALESCE(jsonb_object_agg(cv.field_id, cv.value) FILTER (WHERE cv.value IS NOT NULL), '{}'::jsonb)
       FROM ${SCHEMA}.task_custom_values cv WHERE cv.task_id = t.id) AS custom_values,
    -- Último registro de produção, só para rotina. O guarda kind='recorrente'
    -- evita pagar a subconsulta nas 260+ tarefas pontuais, e o índice
    -- (task_id, entry_date DESC) resolve cada uma em uma leitura.
    (SELECT JSON_BUILD_OBJECT(
              'date', e.entry_date::text,
              'label', (
                SELECT STRING_AGG(
                         CASE
                           WHEN mt.unit = 'checagem' THEN mt.name
                           WHEN mt.unit = 'texto' THEN mt.name || ': ' || COALESCE(v.value_text, '-')
                           ELSE TRIM(TO_CHAR(v.value_numeric, 'FM999999990.##')) || ' ' || LOWER(mt.name)
                         END, ' - ' ORDER BY mt.position, mt.id)
                  FROM ${SCHEMA}.task_production_values v
                  JOIN ${SCHEMA}.task_metrics mt ON mt.id = v.metric_id
                 WHERE v.entry_id = e.id
              ),
              'memberName', (SELECT m2.name FROM ${SCHEMA}.team_members m2 WHERE m2.id = e.member_id)
            )
       FROM ${SCHEMA}.task_production_entries e
      WHERE e.task_id = t.id AND t.kind = 'recorrente'
      ORDER BY e.entry_date DESC, e.id DESC
      LIMIT 1) AS last_production,
    -- Último registro DA PESSOA que está olhando o quadro. Num card
    -- compartilhado pela equipe, "já registrei hoje?" é pergunta individual:
    -- olhar o último registro de qualquer um faria o Albert ver "registrado"
    -- só porque a Mayara lançou. $2 é o member_id do visitante (NULL quando
    -- ele não está na equipe).
    (SELECT e.entry_date::text
       FROM ${SCHEMA}.task_production_entries e
      WHERE e.task_id = t.id AND t.kind = 'recorrente'
        AND $2::int IS NOT NULL AND e.member_id = $2::int
      ORDER BY e.entry_date DESC
      LIMIT 1) AS my_last_production_date
  FROM ${SCHEMA}.tasks t
  LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
  LEFT JOIN ${SCHEMA}.task_label_links ll ON ll.task_id = t.id
`;

export async function getBoardData(
  boardId: number,
  /** Quem está olhando — define o selo "já registrei hoje?" de cada rotina. */
  viewerMemberId?: number | null
): Promise<BoardData | null> {
  await ensureTasksSchema();
  const pool = getPool();
  const boardRes = await pool.query(`SELECT * FROM ${SCHEMA}.task_boards WHERE id = $1`, [boardId]);
  if (!boardRes.rows[0]) return null;
  const [colsRes, tasksRes, labelsRes, fieldsRes] = await Promise.all([
    pool.query(
      `SELECT * FROM ${SCHEMA}.task_columns WHERE board_id=$1 AND NOT archived ORDER BY position, id`,
      [boardId]
    ),
    pool.query(
      `${TASK_SELECT}
       WHERE t.board_id=$1 AND NOT t.archived AND NOT t.is_template
       GROUP BY t.id ORDER BY t.position, t.id`,
      [boardId, viewerMemberId ?? null]
    ),
    pool.query(`SELECT * FROM ${SCHEMA}.task_labels WHERE board_id=$1 ORDER BY id`, [boardId]),
    pool.query(`SELECT * FROM ${SCHEMA}.task_custom_fields WHERE board_id=$1 ORDER BY position, id`, [boardId]),
  ]);
  return {
    board: mapBoard(boardRes.rows[0]),
    columns: colsRes.rows.map(mapColumn),
    tasks: tasksRes.rows.map(mapTask),
    labels: labelsRes.rows.map((r) => ({
      id: Number(r.id),
      boardId,
      name: String(r.name),
      color: String(r.color),
    })),
    customFields: fieldsRes.rows.map(mapCustomField),
  };
}

function mapColumn(r: Record<string, unknown>): TaskColumn {
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    name: String(r.name),
    color: (r.color as string) ?? null,
    position: Number(r.position),
    archived: Boolean(r.archived),
    wipLimit: r.wip_limit === null || r.wip_limit === undefined ? null : Number(r.wip_limit),
    completesTask: Boolean(r.completes_task),
  };
}

export function mapCustomField(r: Record<string, unknown>): TaskCustomField {
  const raw = r.options;
  const options = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? JSON.parse(raw || "[]") : [];
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    name: String(r.name),
    type: String(r.type) as TaskCustomField["type"],
    options,
    showOnCard: Boolean(r.show_on_card),
    position: Number(r.position),
  };
}

/** Cards arquivados de um quadro — a tela de Arquivo lê daqui pra restaurar. */
export async function listArchivedTasks(boardId: number): Promise<TaskCard[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `${TASK_SELECT}
     WHERE t.board_id=$1 AND t.archived AND NOT t.is_template
     GROUP BY t.id ORDER BY COALESCE(t.archived_at, t.updated_at) DESC NULLS LAST, t.id DESC
     LIMIT 300`,
    [boardId, null]
  );
  return rows.map(mapTask);
}

/** Colunas arquivadas (restauráveis) de um quadro. */
export async function listArchivedColumns(boardId: number): Promise<TaskColumn[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM ${SCHEMA}.task_columns WHERE board_id=$1 AND archived ORDER BY position, id`,
    [boardId]
  );
  return rows.map(mapColumn);
}

function isoDay(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function mapTask(r: Record<string, unknown>): TaskCard {
  const rawCustom = r.custom_values;
  const parsedCustom =
    typeof rawCustom === "string" ? JSON.parse(rawCustom || "{}") : ((rawCustom as object) ?? {});
  const customValues: Record<number, string> = {};
  for (const [key, value] of Object.entries(parsedCustom as Record<string, unknown>)) {
    if (value !== null && value !== undefined) customValues[Number(key)] = String(value);
  }
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    kind: normalizeTaskKind(r.kind),
    panelMemberId: r.panel_member_id === null || r.panel_member_id === undefined ? null : Number(r.panel_member_id),
    panelInstagram: Boolean(r.panel_instagram),
    lastProduction: (r.last_production as TaskCard["lastProduction"]) ?? null,
    myLastProductionDate: (r.my_last_production_date as string | null) ?? null,
    columnId: r.column_id === null ? null : Number(r.column_id),
    title: String(r.title),
    description: (r.description as string) ?? null,
    priority: normalizePriority(r.priority),
    startDate: isoDay(r.start_date),
    dueDate: isoDay(r.due_date),
    dueTime: typeof r.due_time === "string" ? r.due_time.slice(0, 5) : null,
    inscricaoId: r.inscricao_id === null || r.inscricao_id === undefined ? null : Number(r.inscricao_id),
    position: Number(r.position),
    completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
    assigneeIds: ((r.assignee_ids as number[]) ?? []).map(Number),
    labelIds: ((r.label_ids as number[]) ?? []).map(Number),
    createdBy: r.created_by === null ? null : Number(r.created_by),
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    archivedAt: r.archived_at ? new Date(r.archived_at as string).toISOString() : null,
    coverColor: (r.cover_color as string) ?? null,
    coverAttachmentId: r.cover_attachment_id === null || r.cover_attachment_id === undefined ? null : Number(r.cover_attachment_id),
    checklistTotal: Number(r.checklist_total ?? 0),
    checklistDone: Number(r.checklist_done ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    attachmentCount: Number(r.attachment_count ?? 0),
    customValues,
  };
}

/** Um card só, já no formato da listagem (usado pelo detalhe e pelas automações). */
export async function getTask(taskId: number): Promise<TaskCard | null> {
  const { rows } = await getPool().query(`${TASK_SELECT} WHERE t.id = $1 GROUP BY t.id`, [taskId, null]);
  return rows[0] ? mapTask(rows[0]) : null;
}

/** Card enxuto para a visão Geral, sem carregar o detalhe completo de cada tarefa. */
export interface TaskOverviewTask {
  id: number;
  boardId: number;
  boardName: string;
  sectorId: number;
  sectorName: string;
  sectorColor: string;
  columnName: string | null;
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  assigneeIds: number[];
}

export interface TaskOverview {
  boards: WorkspaceBoard[];
  tasks: TaskOverviewTask[];
}

/** Consolida os cards de todos os quadros que o usuário pode abrir. */
export async function getTaskOverview(user: PermissionUser | null | undefined): Promise<TaskOverview> {
  const boards = await listWorkspaceBoards(user);
  const boardIds = boards.map((board) => board.id);
  if (boardIds.length === 0) return { boards, tasks: [] };

  const { rows } = await getPool().query(
    `SELECT t.id, t.board_id, t.title, t.priority, t.due_date, t.completed_at,
       b.name AS board_name, b.sector_id,
       s.name AS sector_name, s.color AS sector_color,
       c.name AS column_name,
       COALESCE(array_agg(DISTINCT a.member_id) FILTER (WHERE a.member_id IS NOT NULL), '{}') AS assignee_ids
     FROM ${SCHEMA}.tasks t
     JOIN ${SCHEMA}.task_boards b ON b.id = t.board_id
     JOIN ${SCHEMA}.task_sectors s ON s.id = b.sector_id
     LEFT JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
     LEFT JOIN ${SCHEMA}.task_assignees a ON a.task_id = t.id
     WHERE t.board_id = ANY($1::int[]) AND NOT t.archived AND NOT t.is_template
     GROUP BY t.id, b.id, s.id, c.id
     ORDER BY (t.completed_at IS NULL) DESC, t.due_date ASC NULLS LAST, t.created_at DESC`,
    [boardIds]
  );

  return {
    boards,
    tasks: rows.map((row) => ({
      id: Number(row.id),
      boardId: Number(row.board_id),
      boardName: String(row.board_name),
      sectorId: Number(row.sector_id),
      sectorName: String(row.sector_name),
      sectorColor: String(row.sector_color),
      columnName: (row.column_name as string) ?? null,
      title: String(row.title),
      priority: normalizePriority(row.priority),
      dueDate: isoDay(row.due_date),
      completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
      assigneeIds: ((row.assignee_ids as number[]) ?? []).map(Number),
    })),
  };
}

// ── Tarefas ──────────────────────────────────────────────────────────────────
export async function createTask(input: {
  boardId: number;
  columnId: number | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  startDate?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  inscricaoId?: number | null;
  coverColor?: string | null;
  assigneeIds?: number[];
  labelIds?: number[];
  createdBy?: number | null;
  /** Padrão "pontual": toda tarefa criada hoje continua se comportando igual. */
  kind?: TaskKind;
  /** Só faz sentido com kind painel_leads. */
  panelMemberId?: number | null;
}): Promise<TaskCard> {
  await ensureTasksSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.tasks (board_id, column_id, title, description, priority, start_date, due_date,
       due_time, inscricao_id, cover_color, created_by, kind, panel_member_id, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       COALESCE((SELECT MAX(position)+1 FROM ${SCHEMA}.tasks WHERE board_id=$1 AND column_id IS NOT DISTINCT FROM $2),0))
     RETURNING *`,
    [
      input.boardId,
      input.columnId,
      input.title.trim(),
      input.description ?? null,
      normalizePriority(input.priority),
      input.startDate || null,
      input.dueDate || null,
      input.dueTime || null,
      input.inscricaoId ?? null,
      input.coverColor || null,
      input.createdBy ?? null,
      normalizeTaskKind(input.kind),
      input.panelMemberId ?? null,
    ]
  );
  // `RETURNING *` não traz o nome do criador (ele vem de subconsulta no
  // TASK_SELECT). Sem isto o card recém-criado ficaria sem autor até o quadro
  // recarregar — logo no momento em que a pessoa olha para ele.
  const task = mapTask({ ...rows[0], assignee_ids: [], label_ids: [] });
  const autor = await pool.query<{ name: string | null }>(
    `SELECT name FROM ${SCHEMA}.team_members WHERE id = $1`,
    [input.createdBy ?? null]
  );
  task.createdByName = autor.rows[0]?.name ?? null;
  if (input.assigneeIds?.length) await setTaskAssignees(task.id, input.assigneeIds);
  if (input.labelIds?.length) await setTaskLabels(task.id, input.labelIds);
  return { ...task, assigneeIds: input.assigneeIds ?? [], labelIds: input.labelIds ?? [] };
}

/**
 * A data de conclusão chega da UI como "AAAA-MM-DD" (input type=date), mas a
 * coluna é TIMESTAMPTZ. Carimbar meia-noite faria o dia "voltar" um dia pra
 * quem lê em UTC-3, então o dia escolhido vira meio-dia UTC: qualquer fuso do
 * Brasil (ou até UTC+11) continua mostrando a mesma data.
 * Também aceita um ISO completo (ex.: vindo de outra API) sem mexer nele.
 */
export function normalizeCompletedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00.000Z` : trimmed;
}

export async function updateTask(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    startDate?: string | null;
    dueDate?: string | null;
    completed?: boolean;
    /** "AAAA-MM-DD" ou ISO: data em que a tarefa foi concluída. null limpa. */
    completedAt?: string | null;
    archived?: boolean;
    coverColor?: string | null;
    coverAttachmentId?: number | null;
    /** "HH:MM" ou null para tirar a hora marcada. */
    dueTime?: string | null;
    kind?: TaskKind;
    panelMemberId?: number | null;
  }
): Promise<void> {
  // due_date e description não podem usar COALESCE: o usuário precisa conseguir
  // APAGAR um prazo/descrição, e COALESCE(null, valor) devolveria o valor antigo.
  // Por isso a flag "mexeu neste campo?" ($5/$7) separada do valor novo ($6/$8).
  // Mesma coisa vale pra data de início e pra capa.
  const touchDueDate = input.dueDate !== undefined;
  const touchDescription = input.description !== undefined;
  const touchStart = input.startDate !== undefined;
  const touchCover = input.coverColor !== undefined;
  const touchCoverAttachment = input.coverAttachmentId !== undefined;
  const touchCompletedAt = input.completedAt !== undefined;
  const touchDueTime = input.dueTime !== undefined;
  await getPool().query(
    `UPDATE ${SCHEMA}.tasks SET
       title = COALESCE($2, title),
       priority = COALESCE($3, priority),
       -- Ordem importa: uma data explícita ($16) manda em tudo. Sem ela, o
       -- checkbox "concluída" ($4) só carimba se ainda não houver data —
       -- COALESCE evita que salvar o card de novo reescreva a conclusão
       -- original com a data de hoje.
       completed_at = CASE
         WHEN $16::boolean THEN $17::timestamptz
         WHEN $4::boolean IS NULL THEN completed_at
         WHEN $4 THEN COALESCE(completed_at, NOW())
         ELSE NULL
       END,
       due_date = CASE WHEN $5::boolean THEN $6::date ELSE due_date END,
       description = CASE WHEN $7::boolean THEN $8::text ELSE description END,
       archived = COALESCE($9, archived),
       archived_at = CASE WHEN $9::boolean IS NULL THEN archived_at WHEN $9 THEN NOW() ELSE NULL END,
       start_date = CASE WHEN $10::boolean THEN $11::date ELSE start_date END,
       cover_color = CASE WHEN $12::boolean THEN $13::text ELSE cover_color END,
       cover_attachment_id = CASE WHEN $14::boolean THEN $15::int ELSE cover_attachment_id END,
       due_time = CASE WHEN $18::boolean THEN $19::time ELSE due_time END,
       kind = COALESCE($20, kind),
       panel_member_id = CASE WHEN $21::boolean THEN $22::int ELSE panel_member_id END,
       -- Remarcou hora ou prazo? O lembrete tem que tocar de novo.
       reminder_sent_at = CASE WHEN $18::boolean OR $5::boolean THEN NULL ELSE reminder_sent_at END,
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
      touchStart,
      touchStart ? input.startDate || null : null,
      touchCover,
      touchCover ? input.coverColor || null : null,
      touchCoverAttachment,
      touchCoverAttachment ? input.coverAttachmentId ?? null : null,
      touchCompletedAt,
      touchCompletedAt ? normalizeCompletedAt(input.completedAt) : null,
      touchDueTime,
      touchDueTime ? input.dueTime || null : null,
      input.kind ? normalizeTaskKind(input.kind) : null,
      input.panelMemberId !== undefined,
      input.panelMemberId ?? null,
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

    // Coluna marcada como "conclui a tarefa" carimba completed_at ao receber o
    // card, e SAIR dessa coluna desmarca. Sem isto o kanban e o campo
    // "concluída" contam histórias diferentes: o card está em Concluído e os
    // relatórios continuam achando que está aberto.
    //
    // Só a origem "que concluía" pode limpar a data. Antes, qualquer movimento
    // pra coluna comum zerava completed_at — arrastar um card entre duas
    // colunas normais apagava a data de conclusão preenchida na mão.
    const completesRes = toColumnId === null
      ? null
      : await client.query<{ completes_task: boolean }>(
          `SELECT completes_task FROM ${SCHEMA}.task_columns WHERE id = $1`,
          [toColumnId]
        );
    const completes = Boolean(completesRes?.rows[0]?.completes_task);

    const fromRes = await client.query<{ completes_task: boolean }>(
      `SELECT c.completes_task
         FROM ${SCHEMA}.tasks t
         JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
        WHERE t.id = $1`,
      [taskId]
    );
    const leftCompletingColumn = Boolean(fromRes.rows[0]?.completes_task) && !completes;

    await client.query(
      `UPDATE ${SCHEMA}.tasks SET
         column_id = $2,
         completed_at = CASE
           WHEN $3::boolean THEN COALESCE(completed_at, NOW())
           WHEN $4::boolean THEN NULL
           ELSE completed_at
         END,
         updated_at = NOW()
       WHERE id = $1`,
      [taskId, toColumnId, completes, leftCompletingColumn]
    );

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

export interface CompletionColumnSync {
  fromColumnId: number | null;
  toColumnId: number;
}

/**
 * Mantém a coluna do card de acordo com a marca de concluído.
 *
 * O `moveTask` já cuidava de um lado: arrastar para a coluna de conclusão
 * carimba `completed_at`. Faltava o outro — marcar "Concluída" dentro do card
 * deixava o card marcado no meio do fluxo, e aí o quadro e a ficha contavam
 * histórias diferentes (o relatório dizia concluído, a coluna dizia "em
 * produção").
 *
 * As duas direções:
 *  - marcou concluída fora da coluna de conclusão → card vai para ela;
 *  - desmarcou estando na coluna de conclusão → card volta para a primeira
 *    coluna do quadro, porque ficar em "Concluído" sem data de conclusão é
 *    exatamente a incoerência que esta função existe para evitar.
 *
 * Devolve o movimento feito (ou null) para quem chamou registrar no histórico.
 */
export async function syncTaskCompletionColumn(taskId: number): Promise<CompletionColumnSync | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    board_id: number;
    column_id: number | null;
    completed: boolean;
    completes_task: boolean | null;
  }>(
    `SELECT t.board_id,
            t.column_id,
            (t.completed_at IS NOT NULL) AS completed,
            c.completes_task
       FROM ${SCHEMA}.tasks t
       LEFT JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
      WHERE t.id = $1`,
    [taskId]
  );

  const task = rows[0];
  // Card fora de coluna (backlog solto) não tem para onde ir.
  if (!task || task.column_id === null) return null;

  const inCompletingColumn = Boolean(task.completes_task);
  if (task.completed === inCompletingColumn) return null;

  const destino = await pool.query<{ id: number }>(
    `SELECT id FROM ${SCHEMA}.task_columns
      WHERE board_id = $1 AND archived = false AND completes_task = $2
      ORDER BY position, id
      LIMIT 1`,
    [task.board_id, task.completed]
  );

  const toColumnId = destino.rows[0]?.id;
  // Quadro sem coluna de conclusão (ou sem coluna comum, no caso do retorno):
  // não há para onde mover, e o card simplesmente fica onde está.
  if (!toColumnId || toColumnId === task.column_id) return null;

  await pool.query(
    `UPDATE ${SCHEMA}.tasks
        SET column_id = $2,
            position = COALESCE(
              (SELECT MAX(position) + 1 FROM ${SCHEMA}.tasks WHERE column_id = $2 AND archived = false),
              0
            ),
            updated_at = NOW()
      WHERE id = $1`,
    [taskId, toColumnId]
  );

  return { fromColumnId: task.column_id, toColumnId };
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

/**
 * Acesso do usuário a um quadro. Quadro com visibilidade `workspace` vale para
 * qualquer um que já tenha view.tasks (a rota checa isso antes); os demais
 * herdam o acesso do setor.
 */
export async function userCanAccessBoard(
  user: PermissionUser | null | undefined,
  boardId: number
): Promise<boolean> {
  const { rows } = await getPool().query<{ sector_id: number; visibility: string }>(
    `SELECT sector_id, visibility FROM ${SCHEMA}.task_boards WHERE id = $1`,
    [boardId]
  );
  const row = rows[0];
  if (!row) return false;
  if (row.visibility === "workspace") return true;
  return userCanAccessSector(user, row.sector_id);
}

export async function userCanAccessColumn(user: PermissionUser | null | undefined, columnId: number): Promise<boolean> {
  const boardId = await boardIdOfColumn(columnId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}

export async function userCanAccessTask(user: PermissionUser | null | undefined, taskId: number): Promise<boolean> {
  const boardId = await boardIdOfTask(taskId);
  return boardId === null ? false : userCanAccessBoard(user, boardId);
}

/**
 * Liga ou desliga o bloco de prospecção do Instagram de um card de painel.
 *
 * Desligar NÃO apaga os lançamentos: some da tela e do PDF, e volta inteiro se
 * o card for religado. Quem trabalhou no direct em agosto trabalhou — tirar a
 * pessoa do Instagram hoje não desfaz o mês passado.
 *
 * O gate de master fica na rota, não aqui: esta função é o "como", a permissão
 * é o "quem".
 */
export async function setPanelInstagram(taskId: number, enabled: boolean): Promise<void> {
  await ensureTasksSchema();
  await getPool().query(
    `UPDATE ${SCHEMA}.tasks SET panel_instagram = $2, updated_at = NOW() WHERE id = $1 AND kind = 'painel_leads'`,
    [taskId, enabled]
  );
}

/** Ids dos vendedores cujo card de painel tem o Instagram ligado. */
export async function listInstagramPanelMemberIds(): Promise<Set<number>> {
  await ensureTasksSchema();
  const { rows } = await getPool().query<{ panel_member_id: number }>(
    `SELECT panel_member_id FROM ${SCHEMA}.tasks
      WHERE kind = 'painel_leads' AND panel_instagram AND NOT archived AND panel_member_id IS NOT NULL`
  );
  return new Set(rows.map((row) => Number(row.panel_member_id)));
}
