import { getPool } from "@/lib/db";
import { ensureTasksSchema } from "@/lib/tasks";
import type { PermissionUser } from "@/lib/permissions";

/**
 * Tarefas do lead e a agenda do vendedor.
 *
 * Não existe "tarefa de lead" como coisa separada: é a MESMA tarefa do módulo
 * /tarefas (tabela `dashboard.tasks`), só que com `inscricao_id` preenchido e,
 * quase sempre, uma hora marcada. O Kanban do vendedor espelha essas tarefas em
 * forma de lista — as fases continuam sendo as colunas do quadro onde a tarefa
 * mora, então mudar a fase pela lista é a mesma operação de arrastar o card lá.
 *
 * Uma tarefa sem `inscricao_id` (o backlog normal do time) continua aparecendo
 * na agenda do vendedor se estiver atribuída a ele — o que ele precisa ver é o
 * dia dele inteiro, não só a parte que veio de lead.
 */

const SCHEMA = "dashboard";

export interface AgendaTask {
  id: number;
  title: string;
  boardId: number;
  boardName: string;
  columnId: number | null;
  columnName: string | null;
  columnColor: string | null;
  priority: string;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  createdAt: string | null;
  /** Lead vinculado, quando a tarefa nasceu da ficha dele. */
  inscricaoId: number | null;
  leadName: string | null;
  leadPhone: string | null;
  /**
   * `inscricao_id` preenchido mas sem linha correspondente em
   * `inscricoes.inscricoes`. Não deveria acontecer (existe FK), mas a agenda
   * precisa continuar de pé e sinalizar em vez de sumir com a tarefa.
   */
  leadMissing: boolean;
  /**
   * Etapa comercial do lead. Serve para a agenda saber quando cobrar o
   * resultado do compromisso: só tarefa vencida de lead em "Agendado" abre o
   * `ScheduleOutcomeModal`.
   */
  leadStage: string | null;
  /** Quem responde pela tarefa — a agenda de um vendedor pode ter tarefa compartilhada. */
  assignees: string[];
  /** Em que balde da agenda a tarefa cai. */
  bucket: AgendaBucket;
}

export type AgendaBucket = "atrasada" | "hoje" | "proxima" | "sem_data" | "concluida";

export interface AgendaColumnOption {
  id: number;
  name: string;
  color: string | null;
  boardId: number;
  /** Coluna que marca a tarefa como concluída ao receber o card. */
  completes: boolean;
}

export interface MemberAgenda {
  tasks: AgendaTask[];
  /** Colunas dos quadros envolvidos, para o seletor de fase na lista. */
  columns: AgendaColumnOption[];
  counts: { atrasada: number; hoje: number; proxima: number; semData: number };
}

/** Id em `team_members` do usuário logado — é por ele que as tarefas são atribuídas. */
export async function memberIdForEmail(email: string | null | undefined): Promise<number | null> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT id FROM ${SCHEMA}.team_members WHERE LOWER(email) = $1 LIMIT 1`,
    [normalized]
  );
  return rows[0]?.id ?? null;
}

/**
 * Nome e telefone do lead saem do payload JSONB, que tem chave variável por
 * formulário (ver `lib/db.ts`). Ler só `payload->>'nome'` deixava sem nome todo
 * lead vindo de formulário que grava `name`/`dashboard_nome` — e uma tarefa sem
 * o nome do lead não é clicável na agenda.
 */
const LEAD_NAME_KEYS = ["dashboard_nome", "nome", "name", "nome_completo", "full_name"];
const LEAD_PHONE_KEYS = ["dashboard_telefone", "telefone", "phone", "celular", "whatsapp"];

const payloadText = (keys: string[]) =>
  `COALESCE(${keys.map((key) => `NULLIF(TRIM(i.payload->>'${key}'), '')`).join(", ")})`;

/**
 * Tarefa idêntica criada há poucos segundos no mesmo lead.
 *
 * O botão da ficha já fica desabilitado enquanto salva, mas isso não cobre
 * duplo-clique com rede lenta, reenvio do formulário nem um retry do
 * navegador — casos em que duas requisições iguais chegam de fato ao servidor.
 * A janela é curta de propósito: criar duas vezes "Ligar para o cliente" com
 * dias de diferença é uso legítimo; duas no mesmo segundo é acidente.
 */
export async function findRecentDuplicateTask(input: {
  inscricaoId: number;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  windowSeconds?: number;
}): Promise<number | null> {
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT id FROM ${SCHEMA}.tasks
      WHERE inscricao_id = $1
        AND LOWER(TRIM(title)) = LOWER(TRIM($2))
        AND due_date IS NOT DISTINCT FROM $3::date
        AND due_time IS NOT DISTINCT FROM $4::time
        AND NOT archived
        AND created_at >= NOW() - ($5 || ' seconds')::interval
      ORDER BY id DESC
      LIMIT 1`,
    [input.inscricaoId, input.title, input.dueDate, input.dueTime, String(input.windowSeconds ?? 15)]
  );
  return rows[0]?.id ?? null;
}

/** A tarefa é responsabilidade deste membro? Usado como gate no servidor. */
export async function isTaskAssignee(taskId: number, memberId: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM ${SCHEMA}.task_assignees WHERE task_id = $1 AND member_id = $2 LIMIT 1`,
    [taskId, memberId]
  );
  return (rowCount ?? 0) > 0;
}

const AGENDA_SELECT = `
  SELECT t.id, t.title, t.board_id, t.column_id, t.priority, t.due_date::text AS due_date,
         TO_CHAR(t.due_time, 'HH24:MI') AS due_time, t.completed_at, t.created_at, t.inscricao_id,
         b.name AS board_name,
         c.name AS column_name,
         c.color AS column_color,
         ${payloadText(LEAD_NAME_KEYS)}  AS lead_name,
         ${payloadText(LEAD_PHONE_KEYS)} AS lead_phone,
         (t.inscricao_id IS NOT NULL AND i.id IS NULL) AS lead_missing,
         cl.commercial_stage AS lead_stage,
         COALESCE(
           (SELECT ARRAY_AGG(m.name ORDER BY m.name)
              FROM ${SCHEMA}.task_assignees ta2
              JOIN ${SCHEMA}.team_members m ON m.id = ta2.member_id
             WHERE ta2.task_id = t.id),
           '{}'::text[]
         ) AS assignee_names
  FROM ${SCHEMA}.tasks t
  JOIN ${SCHEMA}.task_boards b ON b.id = t.board_id
  LEFT JOIN ${SCHEMA}.task_columns c ON c.id = t.column_id
  LEFT JOIN inscricoes.inscricoes i ON i.id = t.inscricao_id
  LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = t.inscricao_id
`;

/**
 * Atraso é condição calculada, nunca status gravado — gravar significaria uma
 * rotina para virar o estado de madrugada e um banco que mente entre uma
 * execução e outra.
 *
 * A comparação leva a HORA junto: uma tarefa marcada para hoje às 10:00 está
 * atrasada às 15:00, e comparar só a data a deixava em "Hoje" o dia inteiro.
 * Tarefa só com data (sem hora) vence no fim do dia, então só atrasa a partir
 * do dia seguinte.
 */
export function agendaBucket(
  task: { completedAt?: unknown; dueDate: string | null; dueTime: string | null },
  now: SaoPauloNow
): AgendaBucket {
  if (task.completedAt) return "concluida";
  if (!task.dueDate) return "sem_data";
  if (task.dueDate < now.date) return "atrasada";
  if (task.dueDate > now.date) return "proxima";
  return task.dueTime && task.dueTime < now.time ? "atrasada" : "hoje";
}

function bucketOf(row: Record<string, unknown>, now: SaoPauloNow): AgendaBucket {
  return agendaBucket(
    {
      completedAt: row.completed_at,
      dueDate: (row.due_date as string | null) ?? null,
      dueTime: (row.due_time as string | null) ?? null,
    },
    now
  );
}

function mapAgendaTask(row: Record<string, unknown>, now: SaoPauloNow): AgendaTask {
  return {
    id: Number(row.id),
    title: String(row.title ?? ""),
    boardId: Number(row.board_id),
    boardName: String(row.board_name ?? ""),
    columnId: row.column_id === null || row.column_id === undefined ? null : Number(row.column_id),
    columnName: (row.column_name as string | null) ?? null,
    columnColor: (row.column_color as string | null) ?? null,
    priority: String(row.priority ?? "media"),
    dueDate: (row.due_date as string | null) ?? null,
    dueTime: (row.due_time as string | null) ?? null,
    completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    inscricaoId: row.inscricao_id === null || row.inscricao_id === undefined ? null : Number(row.inscricao_id),
    leadName: (row.lead_name as string | null) ?? null,
    leadPhone: (row.lead_phone as string | null) ?? null,
    leadMissing: Boolean(row.lead_missing),
    leadStage: (row.lead_stage as string | null) ?? null,
    assignees: Array.isArray(row.assignee_names) ? (row.assignee_names as string[]) : [],
    bucket: bucketOf(row, now),
  };
}

export interface SaoPauloNow {
  /** "AAAA-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
}

/**
 * Agora no fuso de São Paulo. A agenda é lida por gente no Brasil e
 * `due_date`/`due_time` são gravados como data e hora locais, sem fuso — o que
 * o usuário digitou é o que fica no banco e o que ele lê depois. Comparar com
 * UTC viraria o dia às 21h e mostraria a tarefa de amanhã como "hoje".
 */
function nowInSaoPaulo(): SaoPauloNow {
  const agora = new Date();
  return {
    date: agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
    time: agora.toLocaleTimeString("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

/**
 * Ordem de urgência da agenda, resolvida no banco (não no Node): atrasada
 * primeiro, depois prioridade, data, hora e — para desempatar — a mais antiga.
 *
 * Fica em SQL de propósito. Ordenar no frontend obrigaria a trazer todas as
 * tarefas do usuário para depois jogar fora a maioria; aqui o banco já devolve
 * pronto, e a paginação/limite continua possível sem quebrar a ordem.
 *
 * `$N` recebe a data e `$N+1` a hora de São Paulo — o "agora" tem que vir da
 * aplicação para a comparação usar o mesmo fuso que o resto da tela.
 */
function urgencyOrder(nowDate: string, nowTime: string): string {
  return `
    ORDER BY
      t.completed_at IS NOT NULL,
      -- 1º: atrasada (venceu e não foi concluída) vem antes de tudo.
      CASE
        WHEN t.completed_at IS NOT NULL THEN 1
        WHEN t.due_date IS NULL THEN 1
        WHEN t.due_date < ${nowDate}::date THEN 0
        WHEN t.due_date = ${nowDate}::date
             AND t.due_time IS NOT NULL
             AND t.due_time < ${nowTime}::time THEN 0
        ELSE 1
      END,
      -- 2º: prioridade. 'urgente' existe no módulo /tarefas e entra na frente
      -- de 'alta'; a ficha do lead só oferece alta/média/baixa.
      CASE t.priority
        WHEN 'urgente' THEN 0
        WHEN 'alta'    THEN 1
        WHEN 'media'   THEN 2
        WHEN 'baixa'   THEN 3
        ELSE 4
      END,
      -- 3º e 4º: data e hora mais próximas. Sem data vai para o fim.
      t.due_date ASC NULLS LAST,
      t.due_time ASC NULLS LAST,
      -- 5º: desempate pela mais antiga.
      t.created_at ASC NULLS LAST,
      t.id ASC`;
}

/** Todas as tarefas de um lead, abertas e concluídas, na mesma ordem de urgência da agenda. */
export async function listLeadTasks(inscricaoId: number): Promise<AgendaTask[]> {
  await ensureTasksSchema();
  const now = nowInSaoPaulo();
  const { rows } = await getPool().query(
    `${AGENDA_SELECT}
     WHERE t.inscricao_id = $1 AND NOT t.archived AND NOT t.is_template
     ${urgencyOrder("$2", "$3")}`,
    [inscricaoId, now.date, now.time]
  );
  return rows.map((row) => mapAgendaTask(row, now));
}

/**
 * Agenda do vendedor: o que está atrasado, o que é de hoje e o que vem a
 * seguir. Concluídas só entram as de hoje — a lista serve para trabalhar o dia,
 * não para consultar histórico (isso é o quadro em /tarefas).
 */
export async function getMemberAgenda(
  memberId: number,
  options: { daysAhead?: number } = {}
): Promise<MemberAgenda> {
  await ensureTasksSchema();
  const now = nowInSaoPaulo();
  const daysAhead = Math.max(1, Math.min(60, options.daysAhead ?? 14));

  const { rows } = await getPool().query(
    `${AGENDA_SELECT}
     JOIN ${SCHEMA}.task_assignees ta ON ta.task_id = t.id AND ta.member_id = $1
     WHERE NOT t.archived AND NOT t.is_template
       AND (
         t.completed_at IS NULL
         OR t.completed_at >= ($2::date)::timestamptz
       )
       AND (
         t.due_date IS NULL
         OR t.due_date <= ($2::date + $3::int)
       )
     ${urgencyOrder("$2", "$4")}`,
    [memberId, now.date, daysAhead, now.time]
  );

  const tasks = rows.map((row) => mapAgendaTask(row, now));
  const boardIds = Array.from(new Set(tasks.map((task) => task.boardId)));
  const columns = boardIds.length > 0 ? await listColumnsForBoards(boardIds) : [];

  return {
    tasks,
    columns,
    counts: {
      atrasada: tasks.filter((task) => task.bucket === "atrasada").length,
      hoje: tasks.filter((task) => task.bucket === "hoje").length,
      proxima: tasks.filter((task) => task.bucket === "proxima").length,
      semData: tasks.filter((task) => task.bucket === "sem_data").length,
    },
  };
}

export async function listColumnsForBoards(boardIds: number[]): Promise<AgendaColumnOption[]> {
  if (boardIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, name, color, board_id, COALESCE(completes_task, false) AS completes
       FROM ${SCHEMA}.task_columns
      WHERE board_id = ANY($1::int[]) AND NOT archived
      ORDER BY board_id, position, id`,
    [boardIds]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    color: (row.color as string | null) ?? null,
    boardId: Number(row.board_id),
    completes: Boolean(row.completes),
  }));
}

export interface LeadTaskBoardOption {
  id: number;
  name: string;
  sectorName: string;
  columns: AgendaColumnOption[];
}

/**
 * Quadros em que o usuário pode criar tarefa de lead. Reaproveita a regra de
 * acesso a setores do módulo de tarefas — quem não enxerga o setor não pode
 * jogar tarefa dentro dele pela ficha do lead.
 */
export async function listBoardsForLeadTasks(
  user: PermissionUser | null | undefined
): Promise<LeadTaskBoardOption[]> {
  await ensureTasksSchema();
  const { listSectorsForUser, listBoards } = await import("@/lib/tasks");
  const sectors = await listSectorsForUser(user);
  if (sectors.length === 0) return [];

  const boards: LeadTaskBoardOption[] = [];
  for (const sector of sectors) {
    for (const board of await listBoards(sector.id)) {
      if (board.archived) continue;
      boards.push({ id: board.id, name: board.name, sectorName: sector.name, columns: [] });
    }
  }

  const columns = await listColumnsForBoards(boards.map((board) => board.id));
  return boards.map((board) => ({
    ...board,
    columns: columns.filter((column) => column.boardId === board.id),
  }));
}
