import { getPool } from "@/lib/db";
import { ensureFinanceSchema } from "@/lib/finance";
import { normalizeBusinessUnit, type FinanceBusinessUnit } from "@/lib/financeBusinessUnits";
import { normalizeEnrollmentInstallments } from "@/lib/enrollmentInstallments";

/**
 * Catálogo comercial de treinamentos — a tabela de preços que o vendedor
 * consulta na hora de fechar.
 *
 * Reaproveita `dashboard.finance_courses`, que já era a lista de cursos usada
 * pelas matrículas do Financeiro. Criar uma segunda tabela de "produtos" faria
 * o mesmo curso existir com dois ids diferentes e quebraria o vínculo entre a
 * venda registrada no CRM e a matrícula que o Financeiro cobra.
 *
 * O preço é **valor padrão + desconto na venda**: `default_price` é a tabela,
 * o vendedor pode fechar por outro valor e a diferença fica registrada como
 * desconto na matrícula (ver `lib/leadSales.ts`). `min_price` é só um alerta
 * de piso — não bloqueia a venda, porque quem decide desconto é a gestão, não
 * o sistema.
 *
 * `business_unit` diz de qual empresa é o curso (Voz UP ou Instituto UP). É a
 * mesma dimensão que o Financeiro já usa em receita e despesa: a matrícula
 * nasce carimbada com a unidade do curso vendido, e é isso que mantém a venda
 * de um treinamento do Instituto fora dos números da Voz UP sem precisar de um
 * segundo catálogo, um segundo contrato ou uma segunda tela de venda.
 */

const SCHEMA = "dashboard";

let schemaReady = false;

export interface TrainingCatalogItem {
  id: number;
  name: string;
  description: string | null;
  durationLabel: string | null;
  /**
   * Quantas aulas o curso tem. É este número que gera o quadro de aulas da
   * turma (uma linha por data) e a carga horária que vai para o contrato —
   * antes disso, "duração" era só um texto livre que ninguém preenchia.
   */
  lessonsCount: number | null;
  /** Horas por aula; com `lessonsCount` vira a carga horária total. */
  lessonHours: number | null;
  /** Aulas por semana. A operação da VozUP é 1, mas o campo existe. */
  lessonsPerWeek: number;
  /** Item 4 do contrato: quanto do valor é matrícula e quanto é material. */
  enrollmentFee: number;
  materialFee: number;
  defaultPrice: number | null;
  minPrice: number | null;
  defaultInstallments: number;
  /** Empresa dona do curso — separa o dinheiro nas duas leituras do Financeiro. */
  businessUnit: FinanceBusinessUnit;
  /**
   * Comissão do vendedor neste curso, em %. `null` = usa o percentual do
   * próprio vendedor (o comportamento de sempre); `0` = a venda não gera
   * comissão. Existe porque produto com custo diferente tem parametrização
   * diferente — a imersão do Instituto UP não paga a comissão da Voz UP.
   */
  commissionPct: number | null;
  active: boolean;
  sort: number;
  /** Vendas registradas a partir do CRM (matrículas com lead vinculado). */
  sales: number;
  /** Valor contratado somado — o que foi fechado, recebido ou não. */
  contracted: number;
  /** Dinheiro que já entrou nessas vendas (parcelas quitadas). */
  received: number;
  /** Ticket médio praticado de fato, para comparar com o valor de tabela. */
  averageTicket: number | null;
  /** Desconto total concedido sobre o valor de tabela. */
  discountTotal: number;
}

export interface TrainingCatalogInput {
  name: string;
  description?: string | null;
  durationLabel?: string | null;
  lessonsCount?: number | null;
  lessonHours?: number | null;
  lessonsPerWeek?: number | null;
  enrollmentFee?: number | null;
  materialFee?: number | null;
  defaultPrice?: number | null;
  minPrice?: number | null;
  defaultInstallments?: number | null;
  businessUnit?: string | null;
  commissionPct?: number | null;
  active?: boolean;
  sort?: number | null;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export async function ensureTrainingCatalogSchema(): Promise<void> {
  if (schemaReady) return;

  // As tabelas base do Financeiro vêm primeiro: este módulo só ACRESCENTA
  // colunas a elas, e uma leitura do catálogo pode ser a primeira coisa a
  // rodar depois de um deploy, antes de qualquer tela financeira abrir.
  await ensureFinanceSchema();

  await getPool().query(`
    ALTER TABLE ${SCHEMA}.finance_courses
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS duration_label TEXT,
      ADD COLUMN IF NOT EXISTS min_price NUMERIC,
      ADD COLUMN IF NOT EXISTS default_installments INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS sort INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
      -- O curso passa a ser o cadastro que alimenta turma e contrato: quantas
      -- aulas tem, quanto dura cada uma, quantas por semana e como o valor se
      -- divide no item 4 do contrato.
      ADD COLUMN IF NOT EXISTS lessons_count INTEGER,
      ADD COLUMN IF NOT EXISTS lesson_hours NUMERIC,
      ADD COLUMN IF NOT EXISTS lessons_per_week INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS enrollment_fee NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS material_fee NUMERIC NOT NULL DEFAULT 0,
      -- Todo curso que já existia é Voz UP: era a única operação com venda até
      -- o Instituto UP passar a ter contrato.
      ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'vozup',
      -- Nulo de propósito: sem percentual próprio, a comissão continua sendo a
      -- do vendedor. Zero é uma decisão ("este curso não paga comissão"), e
      -- precisa ser distinguível de "não foi preenchido".
      ADD COLUMN IF NOT EXISTS commission_pct NUMERIC;

    -- Vínculo da matrícula com o lead que a originou. É o que permite ao
    -- relatório dizer "esta campanha gerou R$ X" sem depender de casar nomes.
    ALTER TABLE ${SCHEMA}.finance_enrollments
      ADD COLUMN IF NOT EXISTS lead_inscricao_id BIGINT,
      ADD COLUMN IF NOT EXISTS list_price NUMERIC,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_reason TEXT,
      ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT,
      ADD COLUMN IF NOT EXISTS created_by_name TEXT;

    CREATE INDEX IF NOT EXISTS idx_finance_enrollments_lead
      ON ${SCHEMA}.finance_enrollments (lead_inscricao_id)
      WHERE lead_inscricao_id IS NOT NULL;
  `);

  schemaReady = true;
}

/**
 * Catálogo com o desempenho de cada treinamento. As estatísticas olham só as
 * matrículas vindas do CRM (`lead_inscricao_id`), porque são as únicas em que
 * dá para afirmar de onde veio a venda.
 */
export async function listTrainingCatalog(): Promise<TrainingCatalogItem[]> {
  await ensureTrainingCatalogSchema();

  const { rows } = await getPool().query(`
    WITH vendas AS (
      SELECT e.course_id,
             COUNT(*)                                     AS sales,
             COALESCE(SUM(e.total_amount), 0)             AS contracted,
             COALESCE(SUM(GREATEST(COALESCE(e.list_price, e.total_amount) - e.total_amount, 0)), 0) AS discount_total
      FROM ${SCHEMA}.finance_enrollments e
      WHERE e.lead_inscricao_id IS NOT NULL
      GROUP BY e.course_id
    ),
    recebido AS (
      SELECT e.course_id, COALESCE(SUM(p.amount), 0) AS received
      FROM ${SCHEMA}.finance_enrollments e
      JOIN ${SCHEMA}.finance_enrollment_payments p ON p.enrollment_id = e.id
      WHERE e.lead_inscricao_id IS NOT NULL
      GROUP BY e.course_id
    )
    SELECT c.id, c.name, c.description, c.duration_label, c.default_price, c.min_price,
           c.default_installments, c.business_unit, c.commission_pct, c.active, c.sort,
           c.lessons_count, c.lesson_hours, c.lessons_per_week, c.enrollment_fee, c.material_fee,
           COALESCE(v.sales, 0)          AS sales,
           COALESCE(v.contracted, 0)     AS contracted,
           COALESCE(v.discount_total, 0) AS discount_total,
           COALESCE(r.received, 0)       AS received
    FROM ${SCHEMA}.finance_courses c
    LEFT JOIN vendas v   ON v.course_id = c.id
    LEFT JOIN recebido r ON r.course_id = c.id
    ORDER BY c.active DESC, c.sort, c.name
  `);

  return rows.map((row) => {
    const sales = Number(row.sales);
    const contracted = num(row.contracted);
    return {
      id: Number(row.id),
      name: row.name,
      description: row.description ?? null,
      durationLabel: row.duration_label ?? null,
      lessonsCount: row.lessons_count === null ? null : Number(row.lessons_count),
      lessonHours: row.lesson_hours === null ? null : num(row.lesson_hours),
      lessonsPerWeek: Number(row.lessons_per_week) || 1,
      enrollmentFee: num(row.enrollment_fee),
      materialFee: num(row.material_fee),
      defaultPrice: row.default_price === null ? null : num(row.default_price),
      minPrice: row.min_price === null ? null : num(row.min_price),
      defaultInstallments: Number(row.default_installments) || 1,
      businessUnit: normalizeBusinessUnit(row.business_unit),
      commissionPct: row.commission_pct === null ? null : num(row.commission_pct),
      active: Boolean(row.active),
      sort: Number(row.sort) || 0,
      sales,
      contracted,
      received: num(row.received),
      averageTicket: sales > 0 ? Math.round((contracted / sales) * 100) / 100 : null,
      discountTotal: num(row.discount_total),
    };
  });
}

/** Inteiro positivo ou null — "12 aulas" nunca é 12,5 nem -3. */
function optionalCount(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(max, Math.trunc(parsed));
}

/** Percentual entre 0 e 100, ou null quando não foi preenchido. */
function optionalPercent(value: unknown): number | null {
  const parsed = optionalNumber(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, parsed));
}



export async function createTraining(input: TrainingCatalogInput): Promise<number> {
  await ensureTrainingCatalogSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Informe o nome do treinamento.");

  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_courses
       (name, description, duration_label, default_price, min_price, default_installments, active, sort,
        lessons_count, lesson_hours, lessons_per_week, enrollment_fee, material_fee, business_unit,
        commission_pct, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
     RETURNING id`,
    [
      name,
      input.description?.trim() || null,
      input.durationLabel?.trim() || null,
      optionalNumber(input.defaultPrice),
      optionalNumber(input.minPrice),
      normalizeEnrollmentInstallments(input.defaultInstallments ?? 1),
      input.active === undefined ? true : Boolean(input.active),
      Math.trunc(num(input.sort)),
      optionalCount(input.lessonsCount, 400),
      optionalNumber(input.lessonHours),
      optionalCount(input.lessonsPerWeek, 7) ?? 1,
      optionalNumber(input.enrollmentFee) ?? 0,
      optionalNumber(input.materialFee) ?? 0,
      normalizeBusinessUnit(input.businessUnit),
      optionalPercent(input.commissionPct),
    ]
  );
  return Number(rows[0].id);
}

export async function updateTraining(id: number, input: TrainingCatalogInput): Promise<void> {
  await ensureTrainingCatalogSchema();
  const name = input.name?.trim();
  if (!name) throw new Error("Informe o nome do treinamento.");

  await getPool().query(
    `UPDATE ${SCHEMA}.finance_courses
     SET name = $2,
         description = $3,
         duration_label = $4,
         default_price = $5,
         min_price = $6,
         default_installments = $7,
         active = $8,
         sort = $9,
         lessons_count = $10,
         lesson_hours = $11,
         lessons_per_week = $12,
         enrollment_fee = $13,
         material_fee = $14,
         business_unit = $15,
         commission_pct = $16,
         updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      name,
      input.description?.trim() || null,
      input.durationLabel?.trim() || null,
      optionalNumber(input.defaultPrice),
      optionalNumber(input.minPrice),
      normalizeEnrollmentInstallments(input.defaultInstallments ?? 1),
      input.active === undefined ? true : Boolean(input.active),
      Math.trunc(num(input.sort)),
      optionalCount(input.lessonsCount, 400),
      optionalNumber(input.lessonHours),
      optionalCount(input.lessonsPerWeek, 7) ?? 1,
      optionalNumber(input.enrollmentFee) ?? 0,
      optionalNumber(input.materialFee) ?? 0,
      normalizeBusinessUnit(input.businessUnit),
      optionalPercent(input.commissionPct),
    ]
  );
}

/**
 * Treinamento com venda registrada nunca é apagado — vira inativo. Apagar
 * levaria junto o `course_id` das matrículas e o histórico de faturamento
 * perderia de qual treinamento veio o dinheiro.
 */
export async function deleteTraining(id: number): Promise<{ deactivated: boolean }> {
  await ensureTrainingCatalogSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM ${SCHEMA}.finance_enrollments WHERE course_id = $1) AS enrollments,
       (SELECT COUNT(*) FROM ${SCHEMA}.finance_revenues WHERE course_id = $1)    AS revenues`,
    [id]
  );
  const inUse = Number(rows[0]?.enrollments ?? 0) > 0 || Number(rows[0]?.revenues ?? 0) > 0;

  if (inUse) {
    await pool.query(
      `UPDATE ${SCHEMA}.finance_courses SET active = FALSE, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    return { deactivated: true };
  }

  await pool.query(`DELETE FROM ${SCHEMA}.finance_courses WHERE id = $1`, [id]);
  return { deactivated: false };
}
