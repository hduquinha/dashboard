import { getPool } from "@/lib/db";
import { ensureTasksSchema } from "@/lib/tasks";

/**
 * Produção das tarefas recorrentes.
 *
 * A regra que sustenta tudo aqui: UMA TAREFA RECORRENTE = UMA TAREFA + VÁRIOS
 * REGISTROS AO LONGO DO TEMPO. A rotina "Responder o Instagram" existe uma vez
 * só e nunca é concluída; o que acumula são as linhas de
 * `task_production_entries`, uma por pessoa por dia.
 *
 * O que motivou: a equipe vinha lançando um card novo por dia para a mesma
 * rotina (11/08/2026 rendeu 20 cards concluídos de uma vez). Isso enche o
 * quadro e não vira número — não dá para somar quantas pessoas foram
 * respondidas no mês a partir de títulos de card.
 *
 * Nada aqui toca em tarefa pontual: ela continua com prazo, prioridade e
 * conclusão, exatamente como antes.
 */

const SCHEMA = "dashboard";

export type MetricUnit = "inteiro" | "decimal" | "texto" | "duracao" | "moeda" | "checagem";
export const METRIC_UNITS: MetricUnit[] = [
  "inteiro",
  "decimal",
  "texto",
  "duracao",
  "moeda",
  "checagem",
];

/**
 * Só estes entram em soma e média — 'texto' fica fora dos cálculos.
 *
 * 'checagem' entra: ela é gravada como 1/0, então a soma responde "em quantos
 * dias isso foi feito" sem nenhum caso especial no relatório.
 */
export const NUMERIC_UNITS: MetricUnit[] = ["inteiro", "decimal", "duracao", "moeda", "checagem"];

export interface TaskMetric {
  id: number;
  taskId: number;
  name: string;
  unit: MetricUnit;
  position: number;
  /** Meta diária — a estrutura existe, a funcionalidade ainda não é usada. */
  dailyTarget: number | null;
}

export interface ProductionValue {
  metricId: number;
  metricName: string;
  unit: MetricUnit;
  numeric: number | null;
  text: string | null;
}

export interface ProductionEntry {
  id: number;
  taskId: number;
  taskTitle: string;
  memberId: number | null;
  memberName: string | null;
  entryDate: string;
  note: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  values: ProductionValue[];
}

function normalizeUnit(value: unknown): MetricUnit {
  return METRIC_UNITS.includes(value as MetricUnit) ? (value as MetricUnit) : "inteiro";
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export async function listTaskMetrics(taskId: number): Promise<TaskMetric[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT id, task_id, name, unit, position, daily_target
       FROM ${SCHEMA}.task_metrics
      WHERE task_id = $1 AND NOT archived
      ORDER BY position, id`,
    [taskId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    taskId: Number(row.task_id),
    name: String(row.name),
    unit: normalizeUnit(row.unit),
    position: Number(row.position ?? 0),
    dailyTarget: row.daily_target === null ? null : Number(row.daily_target),
  }));
}

export async function createTaskMetric(input: {
  taskId: number;
  name: string;
  unit?: MetricUnit;
  dailyTarget?: number | null;
}): Promise<number> {
  await ensureTasksSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.task_metrics (task_id, name, unit, position, daily_target)
     VALUES ($1, $2, $3,
             COALESCE((SELECT MAX(position) + 1 FROM ${SCHEMA}.task_metrics WHERE task_id = $1), 0),
             $4)
     RETURNING id`,
    [input.taskId, input.name.trim(), normalizeUnit(input.unit), input.dailyTarget ?? null]
  );
  return rows[0].id;
}

/**
 * Arquiva em vez de apagar: DELETE levaria junto, por CASCADE, todos os valores
 * já registrados daquele indicador — meses de produção sumiriam do relatório
 * por causa de um clique. Arquivado some dos formulários novos e continua
 * somando no histórico.
 */
export async function archiveTaskMetric(metricId: number): Promise<void> {
  await getPool().query(`UPDATE ${SCHEMA}.task_metrics SET archived = TRUE WHERE id = $1`, [metricId]);
}

// ---------------------------------------------------------------------------
// Registros de produção
// ---------------------------------------------------------------------------

const ENTRY_SELECT = `
  SELECT e.id, e.task_id, e.member_id, e.entry_date::text AS entry_date, e.note,
         e.created_by, e.created_at, e.updated_at,
         t.title AS task_title,
         m.name  AS member_name,
         cb.name AS created_by_name,
         COALESCE(
           (SELECT JSON_AGG(JSON_BUILD_OBJECT(
                     'metricId', v.metric_id,
                     'metricName', mt.name,
                     'unit', mt.unit,
                     'numeric', v.value_numeric,
                     'text', v.value_text
                   ) ORDER BY mt.position, mt.id)
              FROM ${SCHEMA}.task_production_values v
              JOIN ${SCHEMA}.task_metrics mt ON mt.id = v.metric_id
             WHERE v.entry_id = e.id),
           '[]'::json
         ) AS values
    FROM ${SCHEMA}.task_production_entries e
    JOIN ${SCHEMA}.tasks t ON t.id = e.task_id
    LEFT JOIN ${SCHEMA}.team_members m  ON m.id  = e.member_id
    LEFT JOIN ${SCHEMA}.team_members cb ON cb.id = e.created_by
`;

function mapEntry(row: Record<string, unknown>): ProductionEntry {
  const raw = (row.values as Array<Record<string, unknown>>) ?? [];
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    taskTitle: String(row.task_title ?? ""),
    memberId: row.member_id === null ? null : Number(row.member_id),
    memberName: (row.member_name as string | null) ?? null,
    entryDate: String(row.entry_date),
    note: (row.note as string | null) ?? null,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    values: raw.map((value) => ({
      metricId: Number(value.metricId),
      metricName: String(value.metricName ?? ""),
      unit: normalizeUnit(value.unit),
      numeric: value.numeric === null || value.numeric === undefined ? null : Number(value.numeric),
      text: (value.text as string | null) ?? null,
    })),
  };
}

/**
 * Histórico de uma rotina, do mais recente para o mais antigo.
 *
 * Paginado desde o primeiro dia: uma rotina diária rende ~250 registros por
 * pessoa por ano, e a tela do card não pode passar a carregar isso inteiro.
 */
export async function listTaskProduction(
  taskId: number,
  options: { limit?: number; offset?: number } = {}
): Promise<{ entries: ProductionEntry[]; total: number }> {
  await ensureTasksSchema();
  const limit = Math.max(1, Math.min(200, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);

  const [list, count] = await Promise.all([
    getPool().query(
      `${ENTRY_SELECT} WHERE e.task_id = $1
       ORDER BY e.entry_date DESC, e.id DESC
       LIMIT $2 OFFSET $3`,
      [taskId, limit, offset]
    ),
    getPool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${SCHEMA}.task_production_entries WHERE task_id = $1`,
      [taskId]
    ),
  ]);

  return { entries: list.rows.map(mapEntry), total: Number(count.rows[0]?.total ?? 0) };
}

export async function getProductionEntry(entryId: number): Promise<ProductionEntry | null> {
  const { rows } = await getPool().query(`${ENTRY_SELECT} WHERE e.id = $1`, [entryId]);
  return rows[0] ? mapEntry(rows[0]) : null;
}

export interface ProductionInput {
  taskId: number;
  memberId: number | null;
  entryDate: string;
  note?: string | null;
  createdBy?: number | null;
  /** metricId → valor. Número ou texto, conforme a unidade do indicador. */
  values: Record<number, number | string | boolean | null>;
}

/**
 * Grava a produção de um dia. Registrar de novo no mesmo dia ATUALIZA o
 * registro existente em vez de criar outro — é o índice único
 * (task_id, member_id, entry_date) que garante isso no banco, não uma
 * checagem no aplicativo que perderia a corrida entre dois cliques.
 *
 * Devolve `created: false` quando atualizou, para a tela poder avisar que o
 * lançamento do dia foi substituído.
 */
export async function saveProduction(
  input: ProductionInput
): Promise<{ entryId: number; created: boolean }> {
  await ensureTasksSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: number; inserted: boolean }>(
      `INSERT INTO ${SCHEMA}.task_production_entries (task_id, member_id, entry_date, note, created_by)
       VALUES ($1, $2, $3::date, $4, $5)
       ON CONFLICT (task_id, member_id, entry_date)
       DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [input.taskId, input.memberId, input.entryDate, input.note ?? null, input.createdBy ?? null]
    );
    const entryId = rows[0].id;
    const created = Boolean(rows[0].inserted);

    // Só os indicadores da própria tarefa: sem isto uma chamada à mão gravaria
    // valor de indicador de outra rotina dentro deste registro.
    const { rows: metrics } = await client.query<{ id: number; unit: string }>(
      `SELECT id, unit FROM ${SCHEMA}.task_metrics WHERE task_id = $1 AND NOT archived`,
      [input.taskId]
    );

    for (const metric of metrics) {
      const raw = input.values[metric.id];
      if (raw === undefined) continue;

      const unit = normalizeUnit(metric.unit);
      const isText = unit === "texto";
      // Checagem chega como boolean da tela e vira 1/0 — é o que permite somar
      // "dias feitos" junto com os indicadores numéricos.
      const numeric =
        unit === "checagem"
          ? raw === null || raw === "" || raw === false || raw === 0 || raw === "0" || raw === "false"
            ? null
            : 1
          : isText || raw === null || raw === ""
            ? null
            : Number(raw);
      if (numeric !== null && !Number.isFinite(numeric)) {
        throw new Error("Valor invalido para um indicador numerico.");
      }
      const text = isText ? (raw === null ? null : String(raw)) : null;

      if (numeric === null && text === null) {
        await client.query(
          `DELETE FROM ${SCHEMA}.task_production_values WHERE entry_id = $1 AND metric_id = $2`,
          [entryId, metric.id]
        );
        continue;
      }

      await client.query(
        `INSERT INTO ${SCHEMA}.task_production_values (entry_id, metric_id, value_numeric, value_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (entry_id, metric_id)
         DO UPDATE SET value_numeric = EXCLUDED.value_numeric, value_text = EXCLUDED.value_text`,
        [entryId, metric.id, numeric, text]
      );
    }

    await client.query("COMMIT");
    return { entryId, created };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteProductionEntry(entryId: number): Promise<void> {
  // Os valores saem por CASCADE — não existe valor sem registro.
  await getPool().query(`DELETE FROM ${SCHEMA}.task_production_entries WHERE id = $1`, [entryId]);
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface ProductionFilters {
  from?: string | null;
  to?: string | null;
  memberId?: number | null;
  taskId?: number | null;
  boardId?: number | null;
}

export interface ProductionSummaryRow {
  memberId: number | null;
  memberName: string;
  taskId: number;
  taskTitle: string;
  metricId: number;
  metricName: string;
  unit: MetricUnit;
  total: number;
  days: number;
  average: number;
  max: number;
  min: number;
}

/**
 * Agregação do relatório, feita NO BANCO.
 *
 * Trazer os registros crus para somar no Node significaria baixar milhares de
 * linhas por consulta só para jogar quase todas fora — e a tabela cresce ~250
 * linhas por pessoa por rotina por ano. Aqui o Postgres devolve o resultado
 * pronto, já filtrado.
 *
 * Indicador de texto fica de fora: soma e média não fazem sentido nele.
 */
export async function getProductionSummary(
  filters: ProductionFilters
): Promise<ProductionSummaryRow[]> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT e.member_id,
            COALESCE(m.name, 'Sem responsavel') AS member_name,
            e.task_id, t.title AS task_title,
            mt.id AS metric_id, mt.name AS metric_name, mt.unit,
            SUM(v.value_numeric)                     AS total,
            COUNT(DISTINCT e.entry_date)             AS days,
            AVG(v.value_numeric)                     AS average,
            MAX(v.value_numeric)                     AS max,
            MIN(v.value_numeric)                     AS min
       FROM ${SCHEMA}.task_production_entries e
       JOIN ${SCHEMA}.task_production_values v ON v.entry_id = e.id
       JOIN ${SCHEMA}.task_metrics mt ON mt.id = v.metric_id
       JOIN ${SCHEMA}.tasks t ON t.id = e.task_id
       LEFT JOIN ${SCHEMA}.team_members m ON m.id = e.member_id
      WHERE v.value_numeric IS NOT NULL
        AND ($1::date IS NULL OR e.entry_date >= $1::date)
        AND ($2::date IS NULL OR e.entry_date <= $2::date)
        AND ($3::int  IS NULL OR e.member_id = $3::int)
        AND ($4::int  IS NULL OR e.task_id   = $4::int)
        AND ($5::int  IS NULL OR t.board_id  = $5::int)
      GROUP BY e.member_id, m.name, e.task_id, t.title, mt.id, mt.name, mt.unit
      ORDER BY m.name NULLS LAST, t.title, mt.position, mt.id`,
    [
      filters.from ?? null,
      filters.to ?? null,
      filters.memberId ?? null,
      filters.taskId ?? null,
      filters.boardId ?? null,
    ]
  );

  return rows.map((row) => ({
    memberId: row.member_id === null ? null : Number(row.member_id),
    memberName: String(row.member_name),
    taskId: Number(row.task_id),
    taskTitle: String(row.task_title),
    metricId: Number(row.metric_id),
    metricName: String(row.metric_name),
    unit: normalizeUnit(row.unit),
    total: Number(row.total ?? 0),
    days: Number(row.days ?? 0),
    average: Number(row.average ?? 0),
    max: Number(row.max ?? 0),
    min: Number(row.min ?? 0),
  }));
}

/** Registros detalhados do relatório (aba "Registros" da exportação). */
export async function listProductionEntries(
  filters: ProductionFilters,
  options: { limit?: number; offset?: number } = {}
): Promise<ProductionEntry[]> {
  await ensureTasksSchema();
  const limit = Math.max(1, Math.min(5000, options.limit ?? 500));
  const { rows } = await getPool().query(
    `${ENTRY_SELECT}
      WHERE ($1::date IS NULL OR e.entry_date >= $1::date)
        AND ($2::date IS NULL OR e.entry_date <= $2::date)
        AND ($3::int  IS NULL OR e.member_id = $3::int)
        AND ($4::int  IS NULL OR e.task_id   = $4::int)
        AND ($5::int  IS NULL OR t.board_id  = $5::int)
      ORDER BY e.entry_date DESC, m.name NULLS LAST, t.title
      LIMIT $6 OFFSET $7`,
    [
      filters.from ?? null,
      filters.to ?? null,
      filters.memberId ?? null,
      filters.taskId ?? null,
      filters.boardId ?? null,
      limit,
      Math.max(0, options.offset ?? 0),
    ]
  );
  return rows.map(mapEntry);
}

/** Rotinas disponíveis para o seletor do relatório. */
export async function listRecurringTasks(
  boardId?: number | null
): Promise<Array<{ id: number; title: string; boardId: number; boardName: string }>> {
  await ensureTasksSchema();
  const { rows } = await getPool().query(
    `SELECT t.id, t.title, t.board_id, b.name AS board_name
       FROM ${SCHEMA}.tasks t
       JOIN ${SCHEMA}.task_boards b ON b.id = t.board_id
      WHERE t.kind = 'recorrente' AND NOT t.archived
        AND ($1::int IS NULL OR t.board_id = $1::int)
      ORDER BY b.name, t.title`,
    [boardId ?? null]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    boardId: Number(row.board_id),
    boardName: String(row.board_name),
  }));
}
