import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool, listInscricoes, listTrainingsWithStats } from "@/lib/db";
import { normalizeBusinessUnit, type FinanceBusinessUnit } from "@/lib/financeBusinessUnits";
import { classifyPaymentHealth } from "@/lib/receivables";
import { installmentCap, normalizeEnrollmentInstallments } from "@/lib/enrollmentInstallments";
import type {
  BranchItemCostKind,
  BranchItemPhase,
  CommissionsOverview,
  CommissionStatus,
  EnrollmentInvoiceStatus,
  ExpenseStatus,
  FinanceAlertGroup,
  FinanceAgendaClass,
  FinanceAgendaParticipant,
  FinanceAlertsSummary,
  FinanceBranchItem,
  FinanceAllTimeSpend,
  FinanceCashOverview,
  FinanceCatalog,
  FinanceCategoryKind,
  FinanceCommission,
  FinanceCommissionInstallment,
  FinanceCommissionPanel,
  FinanceDashboardSummary,
  FinanceDistributionSlice,
  FinanceEnrollment,
  EnrollmentPayment,
  FinanceFilters,
  FinanceFixedExpense,
  FinanceKpi,
  FinanceMonthTotals,
  FinanceQuarterTotals,
  FinanceRevenue,
  FinanceVariableExpense,
  InstallmentStatus,
  PendingInvoiceEnrollment,
  EnrollmentPaymentHealth,
  EnrollmentPaymentHealthStatus,
  ProjectedCommissionRow,
  RealCommissionRow,
  RevenuePayment,
  RevenuePaymentMethod,
  RevenueStatus,
} from "@/types/finance";

const SCHEMA = "dashboard";
/** Despesas fixas só passaram a existir na operação em junho de 2026. */
const FIXED_EXPENSES_START_DATE = "2026-06-01";
const FIXED_EXPENSES_START_MONTH = "2026-06";

let schemaReady = false;
let schemaReadyPromise: Promise<void> | null = null;

// ── Helpers ──────────────────────────────────────────────────────

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

/** "YYYY-MM" → "YYYY-MM-01" (lança em formato inválido). */
export function monthToDate(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Mês inválido (use YYYY-MM).");
  return `${month}-01`;
}

function dateToMonth(value: unknown): string {
  return (toIsoDate(value) ?? "").slice(0, 7);
}

function normalizeMonthDate(value: unknown): string {
  const month = dateToMonth(value);
  return month ? `${month}-01` : "";
}

function normalizeDueDay(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(31, Math.max(1, Math.trunc(parsed)));
}

function dueDayFromDate(value: unknown): number | null {
  const iso = toIsoDate(value);
  if (!iso) return null;
  return normalizeDueDay(iso.slice(8, 10));
}

export function dateInMonth(monthDate: string, day: number | null): string | null {
  if (!day) return null;
  const month = monthDate.slice(0, 7);
  const [year, monthNumber] = month.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !monthNumber) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map((v) => Number.parseInt(v, 10));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

// ── Regra de período do módulo financeiro ────────────────────────────────────
// Duas fronteiras valem para TODO cálculo (KPI, card, gráfico, lucro, fluxo):
//
// TETO — o mês corrente. Despesa fixa recorrente já nasce provisionada até
// dezembro e há parcela de receita com data lá na frente; nada disso aconteceu,
// então não pode entrar em total, lucro nem gráfico. Só o passado e o mês atual.
//
// PISO — 06/2026, e somente para despesa FIXA e VARIÁVEL: antes disso o banco
// tem meses semeados automaticamente por `ensureFixedExpensesForMonth`, em
// período sem operação. Implantação e pré-operacional NÃO usam esse piso — são
// a montagem da unidade, gasto real desde abril/2026 (confirmado em 2026-07-31).
//
// Listas continuam mostrando tudo: o usuário precisa ver e editar o salário de
// dezembro. O que muda é só o que entra em conta.

/** Último mês que pode entrar em qualquer cálculo. */
export function financeCeilingMonth(): string {
  return currentMonth();
}

/** Primeiro dia do mês seguinte ao corrente — teto exclusivo para colunas DATE. */
function financeCeilingExclusiveDate(): string {
  return monthToDate(addMonths(currentMonth(), 1));
}

/** Recorta um mês no teto: nunca devolve mês posterior ao corrente. */
export function capMonth(month: string | undefined | null): string {
  const ceiling = financeCeilingMonth();
  return !month || month > ceiling ? ceiling : month;
}

/**
 * Recorta um intervalo de meses no teto. `empty` diz que o recorte inteiro está
 * no futuro (ex.: o usuário selecionou dezembro) — nesse caso não há o que somar.
 */
export function clampMonthRange(from: string, to: string): { from: string; to: string; empty: boolean } {
  const clampedTo = capMonth(to);
  return { from, to: clampedTo, empty: from > clampedTo };
}

const REVENUE_STATUSES: RevenueStatus[] = ["previsto", "recebido", "atrasado", "cancelado", "parcial"];
const EXPENSE_STATUSES: ExpenseStatus[] = ["pendente", "pago", "atrasado"];
const MAX_INVOICE_BYTES = 8 * 1024 * 1024;

export function normalizeRevenueStatus(value: unknown): RevenueStatus {
  return REVENUE_STATUSES.includes(value as RevenueStatus) ? (value as RevenueStatus) : "previsto";
}

export function normalizeExpenseStatus(value: unknown): ExpenseStatus {
  return EXPENSE_STATUSES.includes(value as ExpenseStatus) ? (value as ExpenseStatus) : "pendente";
}

type InvoiceTableName =
  | "finance_fixed_expenses"
  | "finance_variable_expenses"
  | "finance_branch_items"
  | "finance_revenues"
  | "finance_revenue_payments"
  | "finance_enrollment_payments"
  | "finance_enrollments";

async function saveFinanceInvoice(
  table: InvoiceTableName,
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await ensureFinanceSchema();
  if (file.buffer.length > MAX_INVOICE_BYTES) throw new Error("Arquivo acima de 8MB.");
  await getPool().query(
    `UPDATE ${SCHEMA}.${table} SET invoice_file = $2, invoice_filename = $3, invoice_mime = $4 WHERE id = $1`,
    [id, file.buffer, file.filename, file.mime]
  );
}

async function getFinanceInvoice(
  table: InvoiceTableName,
  id: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT invoice_file, invoice_filename, invoice_mime FROM ${SCHEMA}.${table} WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row?.invoice_file) return null;
  return {
    buffer: row.invoice_file as Buffer,
    filename: (row.invoice_filename as string) || "nota-fiscal",
    mime: (row.invoice_mime as string) || "application/octet-stream",
  };
}

// ── Schema ───────────────────────────────────────────────────────

export async function ensureFinanceSchema(): Promise<void> {
  if (schemaReady) return;
  if (schemaReadyPromise) {
    await schemaReadyPromise;
    return;
  }

  schemaReadyPromise = (async () => {
    await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_categories (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('receita', 'gasto_fixo', 'gasto_variavel')),
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort INTEGER NOT NULL DEFAULT 0,
      UNIQUE (kind, name)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_payment_methods (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'avista' CHECK (kind IN ('avista', 'parcelado')),
      fee_pct NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_courses (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      default_price NUMERIC,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_branches (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      city TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_employees (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT,
      salary NUMERIC NOT NULL DEFAULT 0,
      benefits NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_sellers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      default_pct NUMERIC NOT NULL DEFAULT 10,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_card_brands (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_installment_rates (
      installments INTEGER NOT NULL CHECK (installments BETWEEN 1 AND 24),
      brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id) ON DELETE CASCADE,
      rate_pct NUMERIC NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_enrollments (
      id BIGSERIAL PRIMARY KEY,
      student TEXT NOT NULL,
      course_id BIGINT REFERENCES ${SCHEMA}.finance_courses(id),
      total_amount NUMERIC NOT NULL,
      down_payment_amount NUMERIC NOT NULL DEFAULT 0,
      regular_installments INTEGER NOT NULL DEFAULT 1,
      installments INTEGER NOT NULL DEFAULT 1,
      payment_method_id BIGINT REFERENCES ${SCHEMA}.finance_payment_methods(id),
      card_brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id),
      first_month DATE NOT NULL,
      sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
      seller_id BIGINT REFERENCES ${SCHEMA}.finance_sellers(id),
      branch_id BIGINT REFERENCES ${SCHEMA}.finance_branches(id),
      rate_pct NUMERIC NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_revenues (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL,
      description TEXT NOT NULL,
      category_id BIGINT REFERENCES ${SCHEMA}.finance_categories(id),
      origin TEXT,
      student TEXT,
      course_id BIGINT REFERENCES ${SCHEMA}.finance_courses(id),
      branch_id BIGINT REFERENCES ${SCHEMA}.finance_branches(id),
      payment_method_id BIGINT REFERENCES ${SCHEMA}.finance_payment_methods(id),
      seller_id BIGINT REFERENCES ${SCHEMA}.finance_sellers(id),
      amount NUMERIC NOT NULL DEFAULT 0,
      fee_amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'recebido', 'atrasado', 'cancelado')),
      enrollment_id BIGINT REFERENCES ${SCHEMA}.finance_enrollments(id) ON DELETE CASCADE,
      installment_number INTEGER,
      notes TEXT,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_revenue_payments (
      id BIGSERIAL PRIMARY KEY,
      revenue_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_revenues(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      payment_date DATE NOT NULL,
      payment_method TEXT NOT NULL
        CHECK (payment_method IN ('pix', 'dinheiro', 'transferencia', 'debito', 'credito', 'boleto', 'outros')),
      installments INTEGER CHECK (installments IS NULL OR installments BETWEEN 1 AND 24),
      card_brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id),
      fee_pct NUMERIC,
      fee_amount NUMERIC NOT NULL DEFAULT 0,
      net_amount NUMERIC NOT NULL DEFAULT 0,
      commission_pct NUMERIC NOT NULL DEFAULT 0,
      commission_amount NUMERIC NOT NULL DEFAULT 0,
      commission_status TEXT NOT NULL DEFAULT 'disponivel' CHECK (commission_status IN ('disponivel', 'paga')),
      commission_paid_at TIMESTAMPTZ,
      notes TEXT,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      created_by_user_id BIGINT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Os pagamentos reais de uma matrícula são independentes das parcelas
    -- previstas no contrato: uma pessoa pode pagar parte em dinheiro, outra
    -- parte no cartão, em datas e quantidades diferentes.
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_enrollment_payments (
      id BIGSERIAL PRIMARY KEY,
      enrollment_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_enrollments(id) ON DELETE CASCADE,
      revenue_id BIGINT REFERENCES ${SCHEMA}.finance_revenues(id) ON DELETE SET NULL,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      payment_date DATE NOT NULL,
      payment_method TEXT NOT NULL
        CHECK (payment_method IN ('pix', 'dinheiro', 'transferencia', 'debito', 'credito', 'boleto', 'outros')),
      installments INTEGER CHECK (installments IS NULL OR installments BETWEEN 1 AND 24),
      card_brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id),
      fee_pct NUMERIC,
      fee_amount NUMERIC NOT NULL DEFAULT 0,
      net_amount NUMERIC NOT NULL DEFAULT 0,
      notes TEXT,
      asaas_payment_url TEXT,
      -- Remanejamento de cronograma que ESTE recebimento provocou, no formato
      -- [{revenueId, before, after}]. É o que permite desfazer o remanejamento
      -- quando o pagamento é editado ou excluído.
      schedule_shift JSONB,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      created_by_user_id BIGINT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Um recebimento pode quitar uma ou várias parcelas. Isto separa a data
    -- em que o dinheiro entrou da competência de cada parcela quitada.
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_enrollment_payment_allocations (
      payment_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_enrollment_payments(id) ON DELETE CASCADE,
      revenue_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_revenues(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      PRIMARY KEY (payment_id, revenue_id)
    );

    -- Capacidade configurável para as turmas que já existem no calendário
    -- operacional. O identificador é texto porque as turmas históricas vêm
    -- das inscrições, nem sempre de uma tabela numérica única.
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_training_capacities (
      id BIGSERIAL PRIMARY KEY,
      training_id TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Configura os encontros de uma turma já existente. Ex.: toda quarta por
    -- 3 meses. As inscrições continuam na tabela operacional de origem.
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_training_schedules (
      id BIGSERIAL PRIMARY KEY,
      training_id TEXT NOT NULL UNIQUE,
      label TEXT,
      product TEXT CHECK (product IN ('online', 'up-day-plus', 'curso-oratoria')),
      days_per_meeting INTEGER NOT NULL DEFAULT 1 CHECK (days_per_meeting BETWEEN 1 AND 7),
      starts_at DATE NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'weekly')),
      duration_months INTEGER NOT NULL DEFAULT 1 CHECK (duration_months BETWEEN 1 AND 24),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_fixed_expenses (
      id BIGSERIAL PRIMARY KEY,
      month DATE NOT NULL,
      description TEXT NOT NULL,
      category_id BIGINT REFERENCES ${SCHEMA}.finance_categories(id),
      due_date DATE,
      amount NUMERIC NOT NULL DEFAULT 0,
      benefits_amount NUMERIC,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'atrasado')),
      paid_at DATE,
      notes TEXT,
      invoice_url TEXT,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      employee_id BIGINT REFERENCES ${SCHEMA}.finance_employees(id),
      kind TEXT NOT NULL DEFAULT 'geral' CHECK (kind IN ('geral', 'folha')),
      recurring_locked BOOLEAN NOT NULL DEFAULT FALSE,
      recurring_key TEXT,
      recurring_due_day INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_variable_expenses (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL,
      description TEXT NOT NULL,
      category_id BIGINT REFERENCES ${SCHEMA}.finance_categories(id),
      branch_id BIGINT REFERENCES ${SCHEMA}.finance_branches(id),
      amount NUMERIC NOT NULL DEFAULT 0,
      notes TEXT,
      invoice_url TEXT,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_commissions (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL,
      seller_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_sellers(id),
      student TEXT NOT NULL,
      course_id BIGINT REFERENCES ${SCHEMA}.finance_courses(id),
      sale_amount NUMERIC NOT NULL,
      percent NUMERIC NOT NULL,
      payment_method_id BIGINT REFERENCES ${SCHEMA}.finance_payment_methods(id),
      installments INTEGER NOT NULL DEFAULT 1,
      total_commission NUMERIC NOT NULL,
      enrollment_id BIGINT REFERENCES ${SCHEMA}.finance_enrollments(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_commission_installments (
      id BIGSERIAL PRIMARY KEY,
      commission_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_commissions(id) ON DELETE CASCADE,
      month DATE NOT NULL,
      amount NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago')),
      paid_at DATE
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_branch_items (
      id BIGSERIAL PRIMARY KEY,
      branch_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_branches(id),
      item TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Outros',
      supplier TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      date DATE,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'atrasado')),
      cost_kind TEXT NOT NULL DEFAULT 'fixo' CHECK (cost_kind IN ('fixo', 'variavel')),
      phase TEXT NOT NULL DEFAULT 'implementacao' CHECK (phase IN ('implementacao', 'pre_operacional')),
      invoice_url TEXT,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_finance_revenues_date ON ${SCHEMA}.finance_revenues(date);
    CREATE INDEX IF NOT EXISTS idx_finance_revenues_enrollment ON ${SCHEMA}.finance_revenues(enrollment_id);
    CREATE INDEX IF NOT EXISTS idx_finance_revenue_payments_revenue ON ${SCHEMA}.finance_revenue_payments(revenue_id);
    CREATE INDEX IF NOT EXISTS idx_finance_revenue_payments_date ON ${SCHEMA}.finance_revenue_payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_finance_revenue_payments_commission_status ON ${SCHEMA}.finance_revenue_payments(commission_status);
    CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payments_enrollment ON ${SCHEMA}.finance_enrollment_payments(enrollment_id);
    CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payments_date ON ${SCHEMA}.finance_enrollment_payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payment_allocations_revenue ON ${SCHEMA}.finance_enrollment_payment_allocations(revenue_id);
    CREATE INDEX IF NOT EXISTS idx_finance_training_capacities_training ON ${SCHEMA}.finance_training_capacities(training_id);
    CREATE INDEX IF NOT EXISTS idx_finance_training_schedules_training ON ${SCHEMA}.finance_training_schedules(training_id);
    CREATE INDEX IF NOT EXISTS idx_finance_fixed_month ON ${SCHEMA}.finance_fixed_expenses(month);
    CREATE INDEX IF NOT EXISTS idx_finance_variable_date ON ${SCHEMA}.finance_variable_expenses(date);
    CREATE INDEX IF NOT EXISTS idx_finance_comm_inst_month ON ${SCHEMA}.finance_commission_installments(month);
    CREATE INDEX IF NOT EXISTS idx_finance_branch_items_branch ON ${SCHEMA}.finance_branch_items(branch_id);
  `);

    await getPool().query(`
      ALTER TABLE ${SCHEMA}.finance_fixed_expenses
        ADD COLUMN IF NOT EXISTS invoice_url TEXT,
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT,
        ADD COLUMN IF NOT EXISTS recurring_locked BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS recurring_key TEXT,
        ADD COLUMN IF NOT EXISTS recurring_due_day INTEGER;
      ALTER TABLE ${SCHEMA}.finance_variable_expenses
        ADD COLUMN IF NOT EXISTS invoice_url TEXT,
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
      ALTER TABLE ${SCHEMA}.finance_branch_items
        ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'implementacao' CHECK (phase IN ('implementacao', 'pre_operacional'));
      ALTER TABLE ${SCHEMA}.finance_enrollments
        ADD COLUMN IF NOT EXISTS card_brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id),
        ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS regular_installments INTEGER,
        ADD COLUMN IF NOT EXISTS invoice_status TEXT NOT NULL DEFAULT 'pendente',
        ADD COLUMN IF NOT EXISTS invoice_number TEXT,
        ADD COLUMN IF NOT EXISTS invoice_issued_at DATE,
        ADD COLUMN IF NOT EXISTS invoice_notes TEXT,
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
      -- Unidade de negócio do lançamento (ver lib/financeBusinessUnits.ts).
      -- Receita e despesa das duas empresas entram na mesma base; a coluna
      -- existe para a leitura conseguir separar. Nasce 'vozup' porque toda a
      -- base anterior à separação é da VozUP.
      ALTER TABLE ${SCHEMA}.finance_revenues
        ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'vozup';
      ALTER TABLE ${SCHEMA}.finance_fixed_expenses
        ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'vozup';
      ALTER TABLE ${SCHEMA}.finance_variable_expenses
        ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'vozup';
      ALTER TABLE ${SCHEMA}.finance_enrollments
        ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'vozup';
      -- Itens de implantação da unidade entram no mesmo recorte de despesa que
      -- as variáveis (compartilham o filtro em getFinanceMonthlyTotals e na
      -- visão de caixa). Sem a coluna aqui, filtrar por unidade de negócio
      -- quebrava a consulta inteira — foi o que derrubou a tela em 19/08/2026.
      ALTER TABLE ${SCHEMA}.finance_branch_items
        ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'vozup';
      CREATE INDEX IF NOT EXISTS idx_finance_branch_items_business_unit
        ON ${SCHEMA}.finance_branch_items(business_unit);
      CREATE INDEX IF NOT EXISTS idx_finance_revenues_business_unit
        ON ${SCHEMA}.finance_revenues(business_unit);
      CREATE INDEX IF NOT EXISTS idx_finance_fixed_business_unit
        ON ${SCHEMA}.finance_fixed_expenses(business_unit);
      CREATE INDEX IF NOT EXISTS idx_finance_variable_business_unit
        ON ${SCHEMA}.finance_variable_expenses(business_unit);

      ALTER TABLE ${SCHEMA}.finance_enrollments
        DROP CONSTRAINT IF EXISTS finance_enrollments_invoice_status_check;
      ALTER TABLE ${SCHEMA}.finance_enrollments
        ADD CONSTRAINT finance_enrollments_invoice_status_check
        CHECK (invoice_status IN ('pendente', 'emitida', 'dispensada'));
      CREATE INDEX IF NOT EXISTS idx_finance_enrollments_invoice_status
        ON ${SCHEMA}.finance_enrollments(invoice_status);
      ALTER TABLE ${SCHEMA}.finance_installment_rates
        ADD COLUMN IF NOT EXISTS brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id) ON DELETE CASCADE;
      -- Teto de parcelas por forma de pagamento (carnê em 48x, cartão em 12x…).
      -- NULL = sem teto próprio: vale o teto do sistema, que é como as formas
      -- antigas se comportavam antes desta coluna existir.
      ALTER TABLE ${SCHEMA}.finance_payment_methods
        ADD COLUMN IF NOT EXISTS max_installments INTEGER,
        ADD COLUMN IF NOT EXISTS fee_pct NUMERIC NOT NULL DEFAULT 0;
      ALTER TABLE ${SCHEMA}.finance_revenues
        ADD COLUMN IF NOT EXISTS due_date DATE,
        ADD COLUMN IF NOT EXISTS card_brand_id BIGINT REFERENCES ${SCHEMA}.finance_card_brands(id),
        ADD COLUMN IF NOT EXISTS lead_inscricao_id BIGINT,
        ADD COLUMN IF NOT EXISTS lead_name TEXT,
        ADD COLUMN IF NOT EXISTS lead_phone TEXT,
        ADD COLUMN IF NOT EXISTS commission_pct NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS revenue_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (revenue_mode IN ('legacy', 'avulso')),
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
      ALTER TABLE ${SCHEMA}.finance_revenue_payments
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
      ALTER TABLE ${SCHEMA}.finance_enrollment_payments
        ADD COLUMN IF NOT EXISTS revenue_id BIGINT REFERENCES ${SCHEMA}.finance_revenues(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS asaas_payment_url TEXT,
        ADD COLUMN IF NOT EXISTS schedule_shift JSONB,
        ADD COLUMN IF NOT EXISTS commission_pct NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS commission_amount NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS commission_status TEXT NOT NULL DEFAULT 'disponivel',
        ADD COLUMN IF NOT EXISTS commission_paid_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
      ALTER TABLE ${SCHEMA}.finance_enrollment_payments
        DROP CONSTRAINT IF EXISTS finance_enrollment_payments_commission_status_check;
      ALTER TABLE ${SCHEMA}.finance_enrollment_payments
        ADD CONSTRAINT finance_enrollment_payments_commission_status_check
        CHECK (commission_status IN ('disponivel', 'paga'));
      ALTER TABLE ${SCHEMA}.finance_training_schedules
        ADD COLUMN IF NOT EXISTS label TEXT,
        ADD COLUMN IF NOT EXISTS product TEXT,
        ADD COLUMN IF NOT EXISTS days_per_meeting INTEGER NOT NULL DEFAULT 1 CHECK (days_per_meeting BETWEEN 1 AND 7);
      ALTER TABLE ${SCHEMA}.finance_training_schedules
        DROP CONSTRAINT IF EXISTS finance_training_schedules_product_check;
      ALTER TABLE ${SCHEMA}.finance_training_schedules
        ADD CONSTRAINT finance_training_schedules_product_check
        CHECK (product IN ('online', 'up-day-plus', 'curso-oratoria'));
      CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payments_revenue
        ON ${SCHEMA}.finance_enrollment_payments(revenue_id);
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_enrollment_payment_allocations (
        payment_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_enrollment_payments(id) ON DELETE CASCADE,
        revenue_id BIGINT NOT NULL REFERENCES ${SCHEMA}.finance_revenues(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL CHECK (amount > 0),
        PRIMARY KEY (payment_id, revenue_id)
      );
      CREATE INDEX IF NOT EXISTS idx_finance_enrollment_payment_allocations_revenue
        ON ${SCHEMA}.finance_enrollment_payment_allocations(revenue_id);
    `);
    // Contratos antigos não tinham entrada registrada. Eles preservam o número
    // de parcelas já existente como quantidade de parcelas mensais.
    await getPool().query(`
      UPDATE ${SCHEMA}.finance_enrollments
         SET regular_installments = CASE
           WHEN COALESCE(down_payment_amount, 0) > 0 THEN GREATEST(1, installments - 1)
           ELSE GREATEST(1, installments)
         END
       WHERE regular_installments IS NULL;
      ALTER TABLE ${SCHEMA}.finance_enrollments
        ALTER COLUMN regular_installments SET DEFAULT 1,
        ALTER COLUMN regular_installments SET NOT NULL;

      -- Compatibilidade: cada pagamento antigo que apontava para uma parcela
      -- ganha seu rateio equivalente, sem alterar valores nem datas.
      INSERT INTO ${SCHEMA}.finance_enrollment_payment_allocations (payment_id, revenue_id, amount)
      SELECT ep.id, ep.revenue_id, ep.amount
        FROM ${SCHEMA}.finance_enrollment_payments ep
       WHERE ep.revenue_id IS NOT NULL
      ON CONFLICT (payment_id, revenue_id) DO NOTHING;
    `);
    // Taxas já existiam com PK em (installments) sozinho; agora a combinação
    // (installments, brand_id) é que precisa ser única — brand_id NULL segue
    // representando a taxa padrão (sem bandeira específica).
    await getPool().query(`
      ALTER TABLE ${SCHEMA}.finance_installment_rates DROP CONSTRAINT IF EXISTS finance_installment_rates_pkey;
    `);
    // "Receitas avulsas" (novo fluxo de pagamentos parciais) precisam do status
    // intermediário "parcial" — reaproveita os valores já existentes para não
    // afetar receitas legadas (enrollment ou lançamento manual antigo).
    await getPool().query(`
      ALTER TABLE ${SCHEMA}.finance_revenues DROP CONSTRAINT IF EXISTS finance_revenues_status_check;
      ALTER TABLE ${SCHEMA}.finance_revenues
        ADD CONSTRAINT finance_revenues_status_check
        CHECK (status IN ('previsto', 'recebido', 'atrasado', 'cancelado', 'parcial'));
    `);

    await dedupeFixedExpenseDuplicates();
    await getPool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fixed_unique_general
        ON ${SCHEMA}.finance_fixed_expenses (month, LOWER(description), COALESCE(category_id, 0::bigint))
        WHERE kind = 'geral';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fixed_unique_payroll
        ON ${SCHEMA}.finance_fixed_expenses (month, employee_id)
        WHERE kind = 'folha' AND employee_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_finance_fixed_recurring_key
        ON ${SCHEMA}.finance_fixed_expenses (recurring_key)
        WHERE recurring_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_installment_rates_brand
        ON ${SCHEMA}.finance_installment_rates (installments, brand_id)
        WHERE brand_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_installment_rates_default
        ON ${SCHEMA}.finance_installment_rates (installments)
        WHERE brand_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_finance_revenues_lead
        ON ${SCHEMA}.finance_revenues (lead_inscricao_id)
        WHERE lead_inscricao_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_finance_revenues_mode
        ON ${SCHEMA}.finance_revenues (revenue_mode);
    `);

    await seedFinanceDefaults();
    schemaReady = true;
  })();

  try {
    await schemaReadyPromise;
  } finally {
    if (!schemaReady) {
      schemaReadyPromise = null;
    }
  }
}

async function dedupeFixedExpenseDuplicates(): Promise<void> {
  await getPool().query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY month, kind, LOWER(description), COALESCE(category_id, 0::bigint), COALESCE(employee_id, 0::bigint)
          ORDER BY
            CASE WHEN amount <> 0 OR COALESCE(benefits_amount, 0) <> 0 THEN 0 ELSE 1 END,
            CASE WHEN status = 'pago' THEN 0 ELSE 1 END,
            CASE WHEN paid_at IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN NULLIF(TRIM(COALESCE(notes, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
            updated_at DESC NULLS LAST,
            id ASC
        ) AS rn
      FROM ${SCHEMA}.finance_fixed_expenses
    )
    DELETE FROM ${SCHEMA}.finance_fixed_expenses f
    USING ranked r
    WHERE f.id = r.id AND r.rn > 1
  `);
}

/** Nome fixo da categoria de gasto calculada a partir das comissões. */
export const COMMISSION_EXPENSE_LABEL = "Comissão dos Vendedores";
export const PAYROLL_EXPENSE_LABEL = "Folha de Pagamento";

const DEFAULT_REVENUE_CATEGORIES = ["Matrícula", "Renovação", "Material", "Mensalidade", "Outros"];
const DEFAULT_FIXED_CATEGORIES = [
  "Aluguel/IPTU",
  "Água",
  "Luz",
  "Internet",
  "Seguro",
  "Impressoras",
  "Agência de Marketing",
  PAYROLL_EXPENSE_LABEL,
  COMMISSION_EXPENSE_LABEL,
  "Outros",
];
const DEFAULT_VARIABLE_CATEGORIES = ["Manutenção", "Eventos", "Materiais", "Outros"];
const DEFAULT_PAYMENT_METHODS: Array<{
  name: string;
  kind: "avista" | "parcelado";
  /** null = sem teto próprio (vale o teto do sistema). */
  maxInstallments: number | null;
}> = [
  { name: "PIX", kind: "avista", maxInstallments: null },
  { name: "Débito", kind: "avista", maxInstallments: null },
  { name: "Dinheiro", kind: "avista", maxInstallments: null },
  { name: "Transferência", kind: "avista", maxInstallments: null },
  { name: "Crédito à Vista", kind: "avista", maxInstallments: null },
  { name: "Cartão Parcelado", kind: "parcelado", maxInstallments: null },
  { name: "Boleto Parcelado", kind: "parcelado", maxInstallments: null },
  { name: "Carnê", kind: "parcelado", maxInstallments: 48 },
];
const DEFAULT_EMPLOYEES = [
  "Henrique",
  "Leonardo",
  "Vanessa",
  "Andreya",
  "Tiago Beltran",
  "Lucas",
  "Rafael",
  "Messia",
];
const DEFAULT_SELLERS = ["Rafael", "Lucas", "Maiara"];
const DEFAULT_CARD_BRANDS = ["Visa", "Mastercard", "Elo", "American Express"];
/** Itens fixos pré-cadastrados no primeiro mês (sem valor — todos editáveis). */
const DEFAULT_FIXED_ITEMS = [
  "Aluguel/IPTU",
  "Água",
  "Luz",
  "Internet",
  "Seguro",
  "Impressoras",
  "Agência de Marketing",
];

async function seedFinanceDefaults(): Promise<void> {
  const pool = getPool();

  for (const [kind, names] of [
    ["receita", DEFAULT_REVENUE_CATEGORIES],
    ["gasto_fixo", DEFAULT_FIXED_CATEGORIES],
    ["gasto_variavel", DEFAULT_VARIABLE_CATEGORIES],
  ] as Array<[FinanceCategoryKind, string[]]>) {
    for (let i = 0; i < names.length; i += 1) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.finance_categories (kind, name, sort) VALUES ($1, $2, $3)
         ON CONFLICT (kind, name) DO NOTHING`,
        [kind, names[i], i]
      );
    }
  }

  for (const method of DEFAULT_PAYMENT_METHODS) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.finance_payment_methods (name, kind, max_installments) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [method.name, method.kind, method.maxInstallments]
    );
  }

  for (const name of DEFAULT_EMPLOYEES) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.finance_employees (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }

  for (const name of DEFAULT_SELLERS) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.finance_sellers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }

  for (const name of DEFAULT_CARD_BRANDS) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.finance_card_brands (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }

  for (let n = 1; n <= 12; n += 1) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.finance_installment_rates (installments, brand_id, rate_pct) VALUES ($1, NULL, 0)
       ON CONFLICT (installments) WHERE brand_id IS NULL DO NOTHING`,
      [n]
    );
  }

  await pool.query(
    `INSERT INTO ${SCHEMA}.finance_settings (key, value) VALUES ('saldo_inicial', '0'::jsonb)
     ON CONFLICT (key) DO NOTHING`
  );

  await pool.query(
    `INSERT INTO ${SCHEMA}.finance_settings (key, value) VALUES ('boleto_fee', '2.3'::jsonb)
     ON CONFLICT (key) DO NOTHING`
  );

  await pool.query(
    `INSERT INTO ${SCHEMA}.finance_branches (name, city) VALUES ('Matriz', NULL)
     ON CONFLICT (name) DO NOTHING`
  );
}

// ── Catálogos ────────────────────────────────────────────────────

export async function getFinanceCatalog(): Promise<FinanceCatalog> {
  await ensureFinanceSchema();
  const pool = getPool();
  const [categories, methods, courses, branches, employees, sellers, cardBrands, rates, settings, boletoFeeRow] =
    await Promise.all([
      pool.query(`SELECT * FROM ${SCHEMA}.finance_categories ORDER BY kind, sort, name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_payment_methods ORDER BY id`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_courses ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_branches ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_employees ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_sellers ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_card_brands ORDER BY name`),
      pool.query(
        `SELECT r.installments, r.brand_id, r.rate_pct, b.name AS brand_name
         FROM ${SCHEMA}.finance_installment_rates r
         LEFT JOIN ${SCHEMA}.finance_card_brands b ON b.id = r.brand_id
         ORDER BY r.brand_id NULLS FIRST, r.installments`
      ),
      pool.query(`SELECT value FROM ${SCHEMA}.finance_settings WHERE key = 'saldo_inicial'`),
      pool.query(`SELECT value FROM ${SCHEMA}.finance_settings WHERE key = 'boleto_fee'`),
    ]);

  return {
    categories: categories.rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind as FinanceCategoryKind,
      name: r.name,
      active: Boolean(r.active),
    })),
    paymentMethods: methods.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      kind: r.kind === "parcelado" ? "parcelado" : "avista",
      feePct: num(r.fee_pct),
      maxInstallments: r.max_installments === null ? null : Number(r.max_installments),
      active: Boolean(r.active),
    })),
    courses: courses.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      defaultPrice: r.default_price === null ? null : num(r.default_price),
      active: Boolean(r.active),
    })),
    branches: branches.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      city: r.city ?? null,
      active: Boolean(r.active),
    })),
    employees: employees.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      role: r.role ?? null,
      salary: num(r.salary),
      benefits: num(r.benefits),
      active: Boolean(r.active),
    })),
    sellers: sellers.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      defaultPct: num(r.default_pct),
      active: Boolean(r.active),
    })),
    cardBrands: cardBrands.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      active: Boolean(r.active),
    })),
    installmentRates: rates.rows.map((r) => ({
      installments: Number(r.installments),
      brandId: r.brand_id === null ? null : Number(r.brand_id),
      brandName: (r.brand_name as string) ?? null,
      ratePct: num(r.rate_pct),
    })),
    initialBalance: num(settings.rows[0]?.value),
    boletoFee: num(boletoFeeRow.rows[0]?.value),
  };
}

interface CatalogEntityDef {
  table: string;
  columns: Record<string, string>; // apiField -> column
  /** Campos numéricos: string vazia é tratada como "não informado" e o valor é normalizado com num(). */
  numericFields?: string[];
}

/** Entidades de catálogo com CRUD genérico em /api/finance/catalog/:entity. */
export const CATALOG_ENTITIES: Record<string, CatalogEntityDef> = {
  categories: {
    table: "finance_categories",
    columns: { kind: "kind", name: "name", active: "active" },
  },
  "payment-methods": {
    table: "finance_payment_methods",
    columns: { name: "name", kind: "kind", feePct: "fee_pct", maxInstallments: "max_installments", active: "active" },
    numericFields: ["feePct", "maxInstallments"],
  },
  courses: {
    table: "finance_courses",
    columns: { name: "name", defaultPrice: "default_price", active: "active" },
    numericFields: ["defaultPrice"],
  },
  branches: {
    table: "finance_branches",
    columns: { name: "name", city: "city", active: "active" },
  },
  employees: {
    table: "finance_employees",
    columns: { name: "name", role: "role", salary: "salary", benefits: "benefits", active: "active" },
    numericFields: ["salary", "benefits"],
  },
  sellers: {
    table: "finance_sellers",
    columns: { name: "name", defaultPct: "default_pct", active: "active" },
    numericFields: ["defaultPct"],
  },
  "card-brands": {
    table: "finance_card_brands",
    columns: { name: "name", active: "active" },
  },
};

/** Filtra campos ausentes e normaliza os numéricos (string vazia vira "não informado", resto vira number). */
function prepareCatalogFields(
  def: CatalogEntityDef,
  payload: Record<string, unknown>
): Array<[string, unknown]> {
  const numericFields = new Set(def.numericFields ?? []);
  return Object.entries(def.columns)
    .filter(([api]) => {
      const value = payload[api];
      if (value === undefined || value === null) return false;
      if (numericFields.has(api) && typeof value === "string" && value.trim() === "") return false;
      return true;
    })
    .map(([api, col]) => {
      if (!numericFields.has(api)) return [col, payload[api]];
      const value = num(payload[api]);
      // Percentuais de taxa não podem gerar valores negativos ou maiores que
      // 100%, mesmo quando a alteração vem de uma chamada direta à API.
      return [col, api === "feePct" ? Math.min(100, Math.max(0, round2(value))) : value];
    });
}

export async function createCatalogEntity(
  entity: string,
  payload: Record<string, unknown>
): Promise<number> {
  await ensureFinanceSchema();
  const def = CATALOG_ENTITIES[entity];
  if (!def) throw new Error("Entidade inválida.");
  const fields = prepareCatalogFields(def, payload);
  if (fields.length === 0) throw new Error("Nada para salvar.");
  const cols = fields.map(([col]) => col);
  const values = fields.map(([, value]) => value);
  const placeholders = values.map((_, i) => `$${i + 1}`);
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.${def.table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    values
  );
  return Number(rows[0].id);
}

export async function updateCatalogEntity(
  entity: string,
  id: number,
  payload: Record<string, unknown>
): Promise<void> {
  await ensureFinanceSchema();
  const def = CATALOG_ENTITIES[entity];
  if (!def) throw new Error("Entidade inválida.");
  const fields = prepareCatalogFields(def, payload);
  if (fields.length === 0) return;
  const sets = fields.map(([col], i) => `${col} = $${i + 2}`);
  await getPool().query(
    `UPDATE ${SCHEMA}.${def.table} SET ${sets.join(", ")} WHERE id = $1`,
    [id, ...fields.map(([, value]) => value)]
  );
}

export async function deleteCatalogEntity(entity: string, id: number): Promise<void> {
  await ensureFinanceSchema();
  const def = CATALOG_ENTITIES[entity];
  if (!def) throw new Error("Entidade inválida.");
  try {
    await getPool().query(`DELETE FROM ${SCHEMA}.${def.table} WHERE id = $1`, [id]);
  } catch {
    // Registro referenciado por lançamentos: desativa em vez de excluir.
    await getPool().query(`UPDATE ${SCHEMA}.${def.table} SET active = FALSE WHERE id = $1`, [id]);
  }
}

export async function updateInstallmentRates(
  rates: Array<{ installments: number; ratePct: number; brandId?: number | null }>
): Promise<void> {
  await ensureFinanceSchema();
  for (const rate of rates) {
    const n = Math.trunc(rate.installments);
    if (!Number.isFinite(n) || n < 1 || n > 24) continue;
    const brandId = rate.brandId ?? null;
    if (brandId === null) {
      await getPool().query(
        `INSERT INTO ${SCHEMA}.finance_installment_rates (installments, brand_id, rate_pct) VALUES ($1, NULL, $2)
         ON CONFLICT (installments) WHERE brand_id IS NULL DO UPDATE SET rate_pct = EXCLUDED.rate_pct`,
        [n, num(rate.ratePct)]
      );
    } else {
      await getPool().query(
        `INSERT INTO ${SCHEMA}.finance_installment_rates (installments, brand_id, rate_pct) VALUES ($1, $2, $3)
         ON CONFLICT (installments, brand_id) WHERE brand_id IS NOT NULL DO UPDATE SET rate_pct = EXCLUDED.rate_pct`,
        [n, brandId, num(rate.ratePct)]
      );
    }
  }
}

export async function updateInitialBalance(value: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_settings (key, value, updated_at) VALUES ('saldo_inicial', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(num(value))]
  );
}

export async function updateBoletoFee(value: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_settings (key, value, updated_at) VALUES ('boleto_fee', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(round2(num(value)))]
  );
}

// ── Receitas ─────────────────────────────────────────────────────

/**
 * Uma parcela continua sendo uma previsão, mas seu status é definido somente
 * pelos rateios que a quitam. Um recebimento pode ratear agosto e setembro ao
 * mesmo tempo, sem jogar o caixa de setembro para agosto (a entrada no caixa
 * continua usando a data do pagamento).
 */
const ENROLLMENT_ALLOCATION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(epa.amount), 0) AS linked_paid
    FROM ${SCHEMA}.finance_enrollment_payment_allocations epa
    WHERE epa.revenue_id = r.id
  ) alloc ON TRUE
`;

/** Quanto esta parcela recebeu diretamente. Exige ENROLLMENT_ALLOCATION_JOIN. */
const ALLOCATED_PAID_SQL = `COALESCE(alloc.linked_paid, 0)`;

const REVENUE_SELECT = `
  SELECT r.*, (r.invoice_file IS NOT NULL) AS has_invoice,
         c.name AS category_name, co.name AS course_name, b.name AS branch_name,
         pm.name AS payment_method_name, s.name AS seller_name,
         COALESCE(pay.paid, 0) AS paid_amount,
         COALESCE(pay.fee_total, 0) AS payments_fee_total,
         COALESCE(pay.commission_total, 0) AS payments_commission_total,
         COALESCE(pay.net_received, 0) AS net_received,
         enrollment.total_amount AS enrollment_total_amount,
         CASE WHEN r.enrollment_id IS NULL THEN NULL ELSE COALESCE(enrollment_pay.paid_amount, 0) END AS enrollment_paid_amount,
         CASE WHEN r.enrollment_id IS NULL THEN NULL ELSE COALESCE(enrollment_pay.fee_total, 0) END AS enrollment_payments_fee_total,
         CASE WHEN r.enrollment_id IS NULL THEN NULL ELSE COALESCE(enrollment_pay.net_received, 0) END AS enrollment_net_received,
         COALESCE(enrollment_pay.payment_count, 0) AS enrollment_payment_count,
         COALESCE(linked_enrollment_pay.paid_amount, 0) AS linked_enrollment_paid_amount,
         COALESCE(linked_enrollment_pay.fee_total, 0) AS linked_enrollment_payments_fee_total,
         COALESCE(linked_enrollment_pay.net_received, 0) AS linked_enrollment_net_received,
         COALESCE(linked_enrollment_pay.payment_count, 0) AS linked_enrollment_payment_count,
         CASE WHEN r.enrollment_id IS NULL THEN 0 ELSE ${ALLOCATED_PAID_SQL} END AS allocated_paid
  FROM ${SCHEMA}.finance_revenues r
  LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = r.category_id
  LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = r.course_id
  LEFT JOIN ${SCHEMA}.finance_branches b ON b.id = r.branch_id
  LEFT JOIN ${SCHEMA}.finance_payment_methods pm ON pm.id = r.payment_method_id
  LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = r.seller_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS paid,
           COALESCE(SUM(fee_amount), 0) AS fee_total,
           COALESCE(SUM(commission_amount), 0) AS commission_total,
           COALESCE(SUM(net_amount), 0) AS net_received
    FROM ${SCHEMA}.finance_revenue_payments WHERE revenue_id = r.id
  ) pay ON TRUE
  LEFT JOIN ${SCHEMA}.finance_enrollments enrollment ON enrollment.id = r.enrollment_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(ep.amount), 0) AS paid_amount,
           COALESCE(SUM(ep.fee_amount), 0) AS fee_total,
           COALESCE(SUM(ep.net_amount), 0) AS net_received,
           COUNT(*)::int AS payment_count
    FROM ${SCHEMA}.finance_enrollment_payments ep
    WHERE ep.enrollment_id = enrollment.id
  ) enrollment_pay ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(epa.amount), 0) AS paid_amount,
           COALESCE(SUM(ep.fee_amount * epa.amount / NULLIF(ep.amount, 0)), 0) AS fee_total,
           COALESCE(SUM(ep.net_amount * epa.amount / NULLIF(ep.amount, 0)), 0) AS net_received,
           COUNT(*)::int AS payment_count
    FROM ${SCHEMA}.finance_enrollment_payment_allocations epa
    JOIN ${SCHEMA}.finance_enrollment_payments ep ON ep.id = epa.payment_id
    WHERE epa.revenue_id = r.id
  ) linked_enrollment_pay ON TRUE
  ${ENROLLMENT_ALLOCATION_JOIN}
`;

function mapRevenue(r: Record<string, unknown>): FinanceRevenue {
  const amount = num(r.amount);
  const directPaidAmount = num(r.paid_amount);
  const directPaymentsFeeTotal = num(r.payments_fee_total);
  const enrollmentId = r.enrollment_id === null ? null : Number(r.enrollment_id);
  const enrollmentPaidAmount = enrollmentId === null ? null : num(r.enrollment_paid_amount);
  const linkedEnrollmentPaymentCount = Number(r.linked_enrollment_payment_count ?? 0);
  // Cada parcela usa somente seus próprios pagamentos vinculados.
  const allocatedPaid = enrollmentId === null ? 0 : num(r.allocated_paid);
  const allocatedFee = num(r.linked_enrollment_payments_fee_total);
  const paidAmount = r.revenue_mode === "avulso" ? directPaidAmount : allocatedPaid;
  const paymentsFeeTotal = r.revenue_mode === "avulso" ? directPaymentsFeeTotal : allocatedFee;
  const netReceived = r.revenue_mode === "avulso"
    ? num(r.net_received)
    : round2(allocatedPaid - allocatedFee);
  return {
    id: Number(r.id),
    date: toIsoDate(r.date) ?? "",
    businessUnit: normalizeBusinessUnit(r.business_unit),
    description: String(r.description ?? ""),
    categoryId: r.category_id === null ? null : Number(r.category_id),
    categoryName: (r.category_name as string) ?? null,
    origin: (r.origin as string) ?? null,
    student: (r.student as string) ?? null,
    courseId: r.course_id === null ? null : Number(r.course_id),
    courseName: (r.course_name as string) ?? null,
    branchId: r.branch_id === null ? null : Number(r.branch_id),
    branchName: (r.branch_name as string) ?? null,
    paymentMethodId: r.payment_method_id === null ? null : Number(r.payment_method_id),
    paymentMethodName: (r.payment_method_name as string) ?? null,
    sellerId: r.seller_id === null ? null : Number(r.seller_id),
    sellerName: (r.seller_name as string) ?? null,
    commissionPct: num(r.commission_pct),
    amount,
    feeAmount: num(r.fee_amount),
    status: normalizeRevenueStatus(r.status),
    enrollmentId,
    installmentNumber: r.installment_number === null ? null : Number(r.installment_number),
    notes: (r.notes as string) ?? null,
    revenueMode: r.revenue_mode === "avulso" ? "avulso" : "legacy",
    dueDate: toIsoDate(r.due_date),
    leadInscricaoId: r.lead_inscricao_id === null || r.lead_inscricao_id === undefined ? null : Number(r.lead_inscricao_id),
    leadName: (r.lead_name as string) ?? null,
    leadPhone: (r.lead_phone as string) ?? null,
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
    paidAmount,
    balanceRemaining: Math.max(0, round2(amount - paidAmount)),
    paymentsFeeTotal,
    paymentsCommissionTotal: num(r.payments_commission_total),
    netReceived,
    netExpected: round2(amount - paymentsFeeTotal),
    enrollmentPaidAmount,
    enrollmentBalanceRemaining: enrollmentId === null ? null : Math.max(0, round2(num(r.enrollment_total_amount) - (enrollmentPaidAmount ?? 0))),
    enrollmentPaymentsFeeTotal: enrollmentId === null ? null : num(r.enrollment_payments_fee_total),
    enrollmentNetReceived: enrollmentId === null ? null : num(r.enrollment_net_received),
    enrollmentPaymentCount: Number(r.enrollment_payment_count ?? 0),
    linkedEnrollmentPaymentCount,
  };
}

export async function getRevenueById(id: number): Promise<FinanceRevenue | null> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(`${REVENUE_SELECT} WHERE r.id = $1`, [id]);
  return rows[0] ? mapRevenue(rows[0]) : null;
}

export async function listRevenues(filters: FinanceFilters = {}): Promise<FinanceRevenue[]> {
  await ensureFinanceSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.from) {
    values.push(monthToDate(filters.from));
    conditions.push(`r.date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(monthToDate(addMonths(filters.to, 1)));
    conditions.push(`r.date < $${values.length}`);
  }
  for (const [key, column] of [
    ["branchId", "r.branch_id"],
    ["courseId", "r.course_id"],
    ["categoryId", "r.category_id"],
    ["sellerId", "r.seller_id"],
    ["paymentMethodId", "r.payment_method_id"],
  ] as const) {
    const value = filters[key];
    if (value) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }
  if (filters.businessUnit) {
    values.push(filters.businessUnit);
    conditions.push(`r.business_unit = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `${REVENUE_SELECT} ${where} ORDER BY r.date DESC, r.id DESC LIMIT 2000`,
    values
  );
  return rows.map(mapRevenue);
}

export interface RevenueInput {
  date: string;
  businessUnit?: FinanceBusinessUnit;
  description: string;
  categoryId?: number | null;
  origin?: string | null;
  student?: string | null;
  courseId?: number | null;
  branchId?: number | null;
  paymentMethodId?: number | null;
  sellerId?: number | null;
  amount: number;
  feeAmount?: number;
  status?: RevenueStatus;
  notes?: string | null;
  dueDate?: string | null;
  leadInscricaoId?: number | null;
  leadName?: string | null;
  leadPhone?: string | null;
  commissionPct?: number;
}

/**
 * Toda receita criada por aqui é "avulsa" (novo fluxo de pagamentos parciais,
 * status automático) — linhas "legacy" só existem por migração de dados
 * antigos (lançamento manual anterior a esta feature) ou geradas por
 * createEnrollment() (Matrículas Parceladas), nunca por este endpoint.
 */
export async function createRevenue(input: RevenueInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.description?.trim()) throw new Error("Descrição é obrigatória.");
  if (!Number.isFinite(input.amount)) throw new Error("Valor inválido.");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_revenues
       (date, description, category_id, origin, student, course_id, branch_id, payment_method_id, seller_id, amount, fee_amount, status, notes,
        due_date, lead_inscricao_id, lead_name, lead_phone, commission_pct, revenue_mode, business_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'previsto', $12, $13, $14, $15, $16, $17, 'avulso', $18)
     RETURNING id`,
    [
      input.date,
      input.description.trim(),
      input.categoryId ?? null,
      input.origin?.trim() || null,
      input.student?.trim() || null,
      input.courseId ?? null,
      input.branchId ?? null,
      input.paymentMethodId ?? null,
      input.sellerId ?? null,
      round2(input.amount),
      round2(input.feeAmount ?? 0),
      input.notes?.trim() || null,
      input.dueDate || null,
      input.leadInscricaoId ?? null,
      input.leadName?.trim() || null,
      input.leadPhone?.trim() || null,
      round2(input.commissionPct ?? 0),
      normalizeBusinessUnit(input.businessUnit),
    ]
  );
  return Number(rows[0].id);
}

export async function updateRevenue(id: number, input: Partial<RevenueInput>): Promise<void> {
  await ensureFinanceSchema();
  const pool = getPool();

  // Parcela de matrícula é gerada a partir do contrato: alterar valor ou mês
  // aqui quebra a identidade "soma das parcelas = valor do curso" em silêncio
  // (foi assim que uma parcela passou a exibir o contrato inteiro no mês).
  // A alteração legítima é editar a matrícula, que regera o cronograma inteiro.
  const { rows: ownerRows } = await pool.query(
    `SELECT enrollment_id FROM ${SCHEMA}.finance_revenues WHERE id = $1`,
    [id]
  );
  const belongsToEnrollment = ownerRows[0]?.enrollment_id !== null && ownerRows[0]?.enrollment_id !== undefined;
  if (belongsToEnrollment && (input.amount !== undefined || input.date !== undefined)) {
    throw new Error(
      "Esta receita é uma parcela de matrícula: valor e mês vêm do contrato. Edite a matrícula para regerar as parcelas."
    );
  }

  let statusOverride: RevenueStatus | undefined;
  if (input.status !== undefined) {
    const { rows } = await pool.query(`SELECT revenue_mode FROM ${SCHEMA}.finance_revenues WHERE id = $1`, [id]);
    const mode = rows[0]?.revenue_mode === "avulso" ? "avulso" : "legacy";
    const requested = normalizeRevenueStatus(input.status);
    // Receitas "avulso" têm status automático — só aceita cancelamento manual
    // vindo do cliente; qualquer outro valor é ignorado (recomputeRevenueStatus
    // é quem decide Pendente/Parcial/Pago). Linhas "legacy" seguem 100% manuais.
    if (mode === "legacy" || requested === "cancelado") {
      statusOverride = requested;
    }
  }

  const map: Record<string, unknown> = {
    date: input.date,
    description: input.description?.trim(),
    category_id: input.categoryId,
    origin: input.origin,
    student: input.student,
    course_id: input.courseId,
    branch_id: input.branchId,
    payment_method_id: input.paymentMethodId,
    seller_id: input.sellerId,
    amount: input.amount !== undefined ? round2(input.amount) : undefined,
    fee_amount: input.feeAmount !== undefined ? round2(input.feeAmount) : undefined,
    status: statusOverride,
    notes: input.notes,
    due_date: input.dueDate,
    lead_inscricao_id: input.leadInscricaoId,
    lead_name: input.leadName,
    lead_phone: input.leadPhone,
    commission_pct: input.commissionPct !== undefined ? round2(input.commissionPct) : undefined,
  };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
    await pool.query(
      `UPDATE ${SCHEMA}.finance_revenues SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
      [id, ...entries.map(([, v]) => v)]
    );
  }

  if (input.amount !== undefined) {
    await recomputeRevenueStatus(pool, id);
  }
}

export async function deleteRevenue(id: number): Promise<void> {
  await ensureFinanceSchema();
  // Apagar uma parcela isolada deixa a matrícula sem previsão para aquele mês:
  // o contrato continua contando em "Matrículas" e gerando comissão, sem a
  // receita correspondente. Quem quer remover a venda exclui a matrícula.
  const { rows } = await getPool().query(
    `SELECT enrollment_id FROM ${SCHEMA}.finance_revenues WHERE id = $1`,
    [id]
  );
  if (rows[0]?.enrollment_id !== null && rows[0]?.enrollment_id !== undefined) {
    throw new Error(
      "Esta receita é uma parcela de matrícula e não pode ser excluída sozinha. Exclua a matrícula para remover o contrato inteiro."
    );
  }
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_revenues WHERE id = $1`, [id]);
}

export async function saveRevenueInvoice(
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await saveFinanceInvoice("finance_revenues", id, file);
}

export async function getRevenueInvoice(
  id: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  return getFinanceInvoice("finance_revenues", id);
}

// ── Pagamentos avulsos (Receitas) ──────────────────────────────────

/**
 * Recalcula o status de uma receita "avulso" a partir da soma dos pagamentos
 * registrados e do vencimento. Não faz nada para receitas "legacy" (status
 * manual) nem para receitas já canceladas manualmente.
 */
async function recomputeRevenueStatus(client: Pool | PoolClient, revenueId: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT r.amount, r.status, r.revenue_mode, r.due_date,
            COALESCE((SELECT SUM(p.amount) FROM ${SCHEMA}.finance_revenue_payments p WHERE p.revenue_id = r.id), 0) AS paid
     FROM ${SCHEMA}.finance_revenues r WHERE r.id = $1`,
    [revenueId]
  );
  const row = rows[0];
  if (!row || row.revenue_mode !== "avulso") return;
  if (row.status === "cancelado") return;

  const amount = num(row.amount);
  const paid = num(row.paid);
  const overdue = row.due_date !== null && row.due_date !== undefined && new Date(row.due_date as string) < new Date(new Date().toISOString().slice(0, 10));
  const next: RevenueStatus = paid >= amount ? "recebido" : overdue ? "atrasado" : paid > 0 ? "parcial" : "previsto";
  if (next !== row.status) {
    await client.query(`UPDATE ${SCHEMA}.finance_revenues SET status = $2, updated_at = NOW() WHERE id = $1`, [
      revenueId,
      next,
    ]);
  }
}

async function getBoletoFee(pool: Pool | PoolClient): Promise<number> {
  const { rows } = await pool.query(`SELECT value FROM ${SCHEMA}.finance_settings WHERE key = 'boleto_fee'`);
  return num(rows[0]?.value);
}

interface PaymentFeeResult {
  feePct: number | null;
  feeAmount: number;
  netAmount: number;
}

/** Calcula a taxa de UM pagamento (nunca sobre o valor total da venda). */
async function calculatePaymentFee(
  pool: Pool | PoolClient,
  params: {
    method: RevenuePaymentMethod;
    amount: number;
    installments?: number | null;
    cardBrandId?: number | null;
  }
): Promise<PaymentFeeResult> {
  if (params.method === "credito") {
    const installments = Math.max(1, Math.min(24, Math.trunc(params.installments || 1)));
    const feePct = await lookupInstallmentRatePct(pool, installments, params.cardBrandId ?? null);
    const feeAmount = round2((params.amount * feePct) / 100);
    return { feePct, feeAmount, netAmount: round2(params.amount - feeAmount) };
  }
  if (params.method === "boleto") {
    const feeAmount = round2(await getBoletoFee(pool));
    return { feePct: null, feeAmount, netAmount: round2(params.amount - feeAmount) };
  }
  return { feePct: null, feeAmount: 0, netAmount: round2(params.amount) };
}

function mapRevenuePayment(r: Record<string, unknown>): RevenuePayment {
  return {
    id: Number(r.id),
    revenueId: Number(r.revenue_id),
    amount: num(r.amount),
    paymentDate: toIsoDate(r.payment_date) ?? "",
    paymentMethod: r.payment_method as RevenuePaymentMethod,
    installments: r.installments === null || r.installments === undefined ? null : Number(r.installments),
    cardBrandId: r.card_brand_id === null || r.card_brand_id === undefined ? null : Number(r.card_brand_id),
    cardBrandName: (r.card_brand_name as string) ?? null,
    feePct: r.fee_pct === null || r.fee_pct === undefined ? null : num(r.fee_pct),
    feeAmount: num(r.fee_amount),
    netAmount: num(r.net_amount),
    commissionPct: num(r.commission_pct),
    commissionAmount: num(r.commission_amount),
    commissionStatus: r.commission_status === "paga" ? "paga" : "disponivel",
    commissionPaidAt: toIsoDate(r.commission_paid_at),
    notes: (r.notes as string) ?? null,
    createdByUserId: r.created_by_user_id === null || r.created_by_user_id === undefined ? null : Number(r.created_by_user_id),
    createdByName: (r.created_by_name as string) ?? null,
    createdAt: toIsoDate(r.created_at) ?? "",
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
  };
}

const REVENUE_PAYMENT_SELECT = `
  SELECT p.*, (p.invoice_file IS NOT NULL) AS has_invoice, cb.name AS card_brand_name
  FROM ${SCHEMA}.finance_revenue_payments p
  LEFT JOIN ${SCHEMA}.finance_card_brands cb ON cb.id = p.card_brand_id
`;

export async function listRevenuePayments(revenueId: number): Promise<RevenuePayment[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `${REVENUE_PAYMENT_SELECT} WHERE p.revenue_id = $1 ORDER BY p.payment_date DESC, p.id DESC`,
    [revenueId]
  );
  return rows.map(mapRevenuePayment);
}

export interface RevenuePaymentInput {
  amount: number;
  paymentDate: string;
  paymentMethod: RevenuePaymentMethod;
  installments?: number | null;
  cardBrandId?: number | null;
  notes?: string | null;
  createdByUserId?: number | null;
  createdByName?: string | null;
}

const REVENUE_PAYMENT_METHODS: RevenuePaymentMethod[] = [
  "pix",
  "dinheiro",
  "transferencia",
  "debito",
  "credito",
  "boleto",
  "outros",
];

function normalizePaymentMethod(value: unknown): RevenuePaymentMethod {
  return REVENUE_PAYMENT_METHODS.includes(value as RevenuePaymentMethod)
    ? (value as RevenuePaymentMethod)
    : "outros";
}

export async function createRevenuePayment(
  revenueId: number,
  input: RevenuePaymentInput
): Promise<{ id: number; revenue: FinanceRevenue }> {
  await ensureFinanceSchema();
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Valor do pagamento inválido.");
  const method = normalizePaymentMethod(input.paymentMethod);
  const amount = round2(input.amount);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: revenueRows } = await client.query(
      `SELECT commission_pct FROM ${SCHEMA}.finance_revenues WHERE id = $1 FOR UPDATE`,
      [revenueId]
    );
    if (!revenueRows[0]) throw new Error("Receita não encontrada.");
    const commissionPct = num(revenueRows[0].commission_pct);

    const { feePct, feeAmount, netAmount } = await calculatePaymentFee(client, {
      method,
      amount,
      installments: input.installments,
      cardBrandId: input.cardBrandId,
    });
    const commissionAmount = round2((amount * commissionPct) / 100);

    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_revenue_payments
         (revenue_id, amount, payment_date, payment_method, installments, card_brand_id, fee_pct, fee_amount, net_amount,
          commission_pct, commission_amount, notes, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        revenueId,
        amount,
        input.paymentDate,
        method,
        method === "credito" ? Math.max(1, Math.min(24, Math.trunc(input.installments || 1))) : null,
        method === "credito" ? input.cardBrandId ?? null : null,
        feePct,
        feeAmount,
        netAmount,
        commissionPct,
        commissionAmount,
        input.notes?.trim() || null,
        input.createdByUserId ?? null,
        input.createdByName?.trim() || null,
      ]
    );

    await recomputeRevenueStatus(client, revenueId);
    await client.query("COMMIT");

    const paymentId = Number(rows[0].id);
    const revenue = await getRevenueById(revenueId);
    if (!revenue) throw new Error("Receita não encontrada após lançamento.");
    return { id: paymentId, revenue };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateRevenuePayment(
  paymentId: number,
  input: Partial<RevenuePaymentInput>
): Promise<void> {
  await ensureFinanceSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: currentRows } = await client.query(
      `SELECT * FROM ${SCHEMA}.finance_revenue_payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );
    const current = currentRows[0];
    if (!current) throw new Error("Pagamento não encontrado.");

    const amount = input.amount !== undefined ? round2(input.amount) : num(current.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Valor do pagamento inválido.");
    const method = input.paymentMethod !== undefined ? normalizePaymentMethod(input.paymentMethod) : normalizePaymentMethod(current.payment_method);
    const installments = input.installments !== undefined ? input.installments : current.installments;
    const cardBrandId = input.cardBrandId !== undefined ? input.cardBrandId : current.card_brand_id;

    const { feePct, feeAmount, netAmount } = await calculatePaymentFee(client, {
      method,
      amount,
      installments,
      cardBrandId,
    });
    const commissionPct = num(current.commission_pct);
    const commissionAmount = round2((amount * commissionPct) / 100);

    await client.query(
      `UPDATE ${SCHEMA}.finance_revenue_payments
       SET amount = $2, payment_date = $3, payment_method = $4, installments = $5, card_brand_id = $6,
           fee_pct = $7, fee_amount = $8, net_amount = $9, commission_amount = $10, notes = $11
       WHERE id = $1`,
      [
        paymentId,
        amount,
        input.paymentDate ?? toIsoDate(current.payment_date),
        method,
        method === "credito" ? Math.max(1, Math.min(24, Math.trunc(installments || 1))) : null,
        method === "credito" ? cardBrandId ?? null : null,
        feePct,
        feeAmount,
        netAmount,
        commissionAmount,
        input.notes !== undefined ? input.notes?.trim() || null : current.notes,
      ]
    );

    await recomputeRevenueStatus(client, Number(current.revenue_id));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteRevenuePayment(paymentId: number): Promise<void> {
  await ensureFinanceSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `DELETE FROM ${SCHEMA}.finance_revenue_payments WHERE id = $1 RETURNING revenue_id`,
      [paymentId]
    );
    const revenueId = rows[0]?.revenue_id;
    if (revenueId) await recomputeRevenueStatus(client, Number(revenueId));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveRevenuePaymentInvoice(
  paymentId: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await saveFinanceInvoice("finance_revenue_payments", paymentId, file);
}

export async function getRevenuePaymentInvoice(
  paymentId: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  return getFinanceInvoice("finance_revenue_payments", paymentId);
}

export async function setPaymentCommissionStatus(paymentId: number, status: CommissionStatus): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_revenue_payments
     SET commission_status = $2, commission_paid_at = CASE WHEN $2 = 'paga' THEN NOW() ELSE NULL END
     WHERE id = $1`,
    [paymentId, status]
  );
}

export async function setEnrollmentPaymentCommissionStatus(
  paymentId: number,
  status: CommissionStatus
): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_enrollment_payments
     SET commission_status = $2, commission_paid_at = CASE WHEN $2 = 'paga' THEN NOW() ELSE NULL END
     WHERE id = $1`,
    [paymentId, status]
  );
}

// ── Comissões (visão geral: legado + pagamentos avulsos) ───────────

export async function getCommissionsOverview(filters: FinanceFilters = {}): Promise<CommissionsOverview> {
  await ensureFinanceSchema();
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.from) {
    values.push(monthToDate(filters.from));
    conditions.push(`p.payment_date >= $${values.length}`);
  }
  // Teto obrigatório: no modo "todos" não vem filtro de período, e existe
  // recebimento de matrícula agendado pra frente — comissão de dinheiro que
  // ainda não entrou não pode aparecer como realizada.
  values.push(monthToDate(addMonths(capMonth(filters.to), 1)));
  conditions.push(`p.payment_date < $${values.length}`);
  if (filters.sellerId) {
    values.push(filters.sellerId);
    conditions.push(`r.seller_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows: realRows } = await pool.query(
    `SELECT p.id AS payment_id, p.revenue_id, r.seller_id, s.name AS seller_name,
            r.description AS revenue_description, r.lead_name, r.amount AS sale_amount,
            p.amount AS payment_amount, p.commission_pct, p.commission_amount,
            p.payment_date, p.commission_status
     FROM ${SCHEMA}.finance_revenue_payments p
     JOIN ${SCHEMA}.finance_revenues r ON r.id = p.revenue_id
     JOIN ${SCHEMA}.finance_sellers s ON s.id = r.seller_id
     ${where ? `${where} AND r.seller_id IS NOT NULL AND p.commission_amount <> 0` : "WHERE r.seller_id IS NOT NULL AND p.commission_amount <> 0"}
     ORDER BY p.payment_date DESC, p.id DESC`,
    values
  );

  // Recebimentos de matrícula geram comissão pelo mesmo critério (dinheiro que
  // entrou × % acordado). Sem isso a aba ficava vazia: hoje toda venda é
  // cadastrada como matrícula, e o fluxo de receita avulsa não é mais usado.
  const enrollmentConditions: string[] = ["e.seller_id IS NOT NULL", "ep.commission_amount <> 0"];
  const enrollmentValues: unknown[] = [];
  if (filters.from) {
    enrollmentValues.push(monthToDate(filters.from));
    enrollmentConditions.push(`ep.payment_date >= $${enrollmentValues.length}`);
  }
  enrollmentValues.push(monthToDate(addMonths(capMonth(filters.to), 1)));
  enrollmentConditions.push(`ep.payment_date < $${enrollmentValues.length}`);
  if (filters.sellerId) {
    enrollmentValues.push(filters.sellerId);
    enrollmentConditions.push(`e.seller_id = $${enrollmentValues.length}`);
  }
  const { rows: enrollmentRealRows } = await pool.query(
    `SELECT ep.id AS payment_id, e.id AS enrollment_id, e.seller_id, s.name AS seller_name,
            e.student, co.name AS course_name, e.total_amount AS sale_amount,
            ep.amount AS payment_amount, ep.commission_pct, ep.commission_amount,
            ep.payment_date, ep.commission_status
     FROM ${SCHEMA}.finance_enrollment_payments ep
     JOIN ${SCHEMA}.finance_enrollments e ON e.id = ep.enrollment_id
     JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
     LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = e.course_id
     WHERE ${enrollmentConditions.join(" AND ")}
     ORDER BY ep.payment_date DESC, ep.id DESC`,
    enrollmentValues
  );

  const real: RealCommissionRow[] = [
    ...realRows.map((r) => ({
      source: "avulso" as const,
      paymentId: Number(r.payment_id),
      revenueId: Number(r.revenue_id),
      sellerId: Number(r.seller_id),
      sellerName: String(r.seller_name ?? ""),
      revenueDescription: String(r.revenue_description ?? ""),
      leadName: (r.lead_name as string) ?? null,
      saleAmount: num(r.sale_amount),
      paymentAmount: num(r.payment_amount),
      commissionPct: num(r.commission_pct),
      commissionAmount: num(r.commission_amount),
      date: toIsoDate(r.payment_date) ?? "",
      status: (r.commission_status === "paga" ? "paga" : "disponivel") as CommissionStatus,
    })),
    ...enrollmentRealRows.map((r) => ({
      source: "matricula" as const,
      paymentId: Number(r.payment_id),
      revenueId: Number(r.enrollment_id),
      sellerId: Number(r.seller_id),
      sellerName: String(r.seller_name ?? ""),
      revenueDescription: `Matrícula — ${String(r.student ?? "")}${r.course_name ? ` (${String(r.course_name)})` : ""}`,
      leadName: (r.student as string) ?? null,
      saleAmount: num(r.sale_amount),
      paymentAmount: num(r.payment_amount),
      commissionPct: num(r.commission_pct),
      commissionAmount: num(r.commission_amount),
      date: toIsoDate(r.payment_date) ?? "",
      status: (r.commission_status === "paga" ? "paga" : "disponivel") as CommissionStatus,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const projectedValues: unknown[] = [];
  const projectedConditions: string[] = ["r.revenue_mode = 'avulso'", "r.status IN ('previsto', 'parcial')", "r.commission_pct > 0", "r.seller_id IS NOT NULL"];
  if (filters.sellerId) {
    projectedValues.push(filters.sellerId);
    projectedConditions.push(`r.seller_id = $${projectedValues.length}`);
  }
  const { rows: projectedRows } = await pool.query(
    `SELECT r.id AS revenue_id, r.seller_id, s.name AS seller_name, r.description AS revenue_description,
            r.lead_name, r.amount AS sale_amount, r.commission_pct,
            r.amount - COALESCE(paid.total, 0) AS balance_remaining
     FROM ${SCHEMA}.finance_revenues r
     JOIN ${SCHEMA}.finance_sellers s ON s.id = r.seller_id
     LEFT JOIN LATERAL (
       SELECT SUM(amount) AS total FROM ${SCHEMA}.finance_revenue_payments p WHERE p.revenue_id = r.id
     ) paid ON TRUE
     WHERE ${projectedConditions.join(" AND ")}`,
    projectedValues
  );

  // Projeção equivalente para matrículas: saldo ainda não pago do contrato.
  const projectedEnrollmentValues: unknown[] = [];
  const projectedEnrollmentConditions: string[] = ["e.seller_id IS NOT NULL", "cm.percent > 0"];
  if (filters.sellerId) {
    projectedEnrollmentValues.push(filters.sellerId);
    projectedEnrollmentConditions.push(`e.seller_id = $${projectedEnrollmentValues.length}`);
  }
  const { rows: projectedEnrollmentRows } = await pool.query(
    `SELECT e.id AS enrollment_id, e.seller_id, s.name AS seller_name, e.student,
            co.name AS course_name, e.total_amount AS sale_amount, cm.percent AS commission_pct,
            e.total_amount - COALESCE(paid.total, 0) AS balance_remaining
     FROM ${SCHEMA}.finance_enrollments e
     JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
     JOIN ${SCHEMA}.finance_commissions cm ON cm.enrollment_id = e.id
     LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = e.course_id
     LEFT JOIN LATERAL (
       SELECT SUM(amount) AS total FROM ${SCHEMA}.finance_enrollment_payments ep WHERE ep.enrollment_id = e.id
     ) paid ON TRUE
     WHERE ${projectedEnrollmentConditions.join(" AND ")}`,
    projectedEnrollmentValues
  );

  const projected: ProjectedCommissionRow[] = [
    ...projectedRows.map((r) => ({
      source: "avulso" as const,
      revenueId: Number(r.revenue_id),
      sellerId: Number(r.seller_id),
      sellerName: String(r.seller_name ?? ""),
      revenueDescription: String(r.revenue_description ?? ""),
      leadName: (r.lead_name as string) ?? null,
      saleAmount: num(r.sale_amount),
      balanceRemaining: round2(num(r.balance_remaining)),
      commissionPct: num(r.commission_pct),
    })),
    ...projectedEnrollmentRows.map((r) => ({
      source: "matricula" as const,
      revenueId: Number(r.enrollment_id),
      sellerId: Number(r.seller_id),
      sellerName: String(r.seller_name ?? ""),
      revenueDescription: `Matrícula — ${String(r.student ?? "")}${r.course_name ? ` (${String(r.course_name)})` : ""}`,
      leadName: (r.student as string) ?? null,
      saleAmount: num(r.sale_amount),
      balanceRemaining: round2(num(r.balance_remaining)),
      commissionPct: num(r.commission_pct),
    })),
  ]
    .map((row) => ({
      ...row,
      projectedCommissionAmount: round2((row.balanceRemaining * row.commissionPct) / 100),
      status: "aguardando_pagamento" as const,
    }))
    .filter((row) => row.balanceRemaining > 0);

  const totals = {
    realGenerated: round2(real.reduce((sum, row) => sum + row.commissionAmount, 0)),
    realPaid: round2(real.filter((row) => row.status === "paga").reduce((sum, row) => sum + row.commissionAmount, 0)),
    projected: round2(projected.reduce((sum, row) => sum + row.projectedCommissionAmount, 0)),
  };

  return { real, projected, totals };
}

// ── Gastos fixos ─────────────────────────────────────────────────

const FIXED_SELECT = `
  SELECT f.*, (f.invoice_file IS NOT NULL) AS has_invoice, c.name AS category_name, e.name AS employee_name
  FROM ${SCHEMA}.finance_fixed_expenses f
  LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = f.category_id
  LEFT JOIN ${SCHEMA}.finance_employees e ON e.id = f.employee_id
`;

function mapFixed(r: Record<string, unknown>): FinanceFixedExpense {
  return {
    id: Number(r.id),
    month: dateToMonth(r.month),
    businessUnit: normalizeBusinessUnit(r.business_unit),
    description: String(r.description ?? ""),
    categoryId: r.category_id === null ? null : Number(r.category_id),
    categoryName: (r.category_name as string) ?? null,
    dueDate: toIsoDate(r.due_date),
    amount: num(r.amount),
    benefitsAmount: r.benefits_amount === null ? null : num(r.benefits_amount),
    status: normalizeExpenseStatus(r.status),
    paidAt: toIsoDate(r.paid_at),
    notes: (r.notes as string) ?? null,
    invoiceUrl: (r.invoice_url as string) ?? null,
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
    employeeId: r.employee_id === null ? null : Number(r.employee_id),
    employeeName: (r.employee_name as string) ?? null,
    kind: r.kind === "folha" ? "folha" : "geral",
    recurringLocked: Boolean(r.recurring_locked),
    recurringDueDay: normalizeDueDay(r.recurring_due_day),
  };
}

async function findCategoryId(kind: FinanceCategoryKind, name: string): Promise<number | null> {
  const { rows } = await getPool().query(
    `SELECT id FROM ${SCHEMA}.finance_categories WHERE kind = $1 AND name = $2 LIMIT 1`,
    [kind, name]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function syncLockedFixedExpensesForMonth(client: PoolClient, monthDate: string): Promise<void> {
  const { rows: sources } = await client.query(
    `
      WITH keyed_candidates AS (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY f.recurring_key
                 ORDER BY f.month DESC, f.updated_at DESC NULLS LAST, f.id DESC
               ) AS rn
        FROM ${SCHEMA}.finance_fixed_expenses f
        WHERE f.kind IN ('geral', 'folha')
          AND f.recurring_key IS NOT NULL
          AND f.month < $1::date
      ),
      legacy_candidates AS (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY LOWER(f.description), COALESCE(f.category_id, 0::bigint)
                 ORDER BY f.month DESC, f.updated_at DESC NULLS LAST, f.id DESC
               ) AS rn
        FROM ${SCHEMA}.finance_fixed_expenses f
        WHERE f.kind IN ('geral', 'folha')
          AND f.recurring_key IS NULL
          AND f.recurring_locked = TRUE
          AND f.month < $1::date
      )
      SELECT * FROM keyed_candidates WHERE rn = 1 AND recurring_locked = TRUE
      UNION ALL
      SELECT * FROM legacy_candidates WHERE rn = 1
    `,
    [monthDate]
  );

  for (const source of sources) {
    const description = String(source.description ?? "").trim();
    if (!description) continue;

    const kind = source.kind === "folha" ? "folha" : "geral";
    const employeeId = source.employee_id === null || source.employee_id === undefined ? null : Number(source.employee_id);
    const recurringKey = String(source.recurring_key ?? `fixed-${source.id}`);
    const categoryId = source.category_id === null || source.category_id === undefined ? null : Number(source.category_id);
    const dueDay = normalizeDueDay(source.recurring_due_day) ?? dueDayFromDate(source.due_date);
    const dueDate = dateInMonth(monthDate, dueDay);
    const amount = round2(num(source.amount));

    const updateResult = await client.query(
      `UPDATE ${SCHEMA}.finance_fixed_expenses f
       SET description = $3,
           category_id = $4::bigint,
           due_date = $5::date,
           amount = $6,
           recurring_locked = TRUE,
           recurring_key = $7,
           recurring_due_day = $8,
           updated_at = NOW()
       WHERE f.month = $1::date
         AND f.kind = $9
         AND (
           f.recurring_key = $7
           OR (
             f.recurring_key IS NULL
             AND (
               ($10::bigint IS NOT NULL AND f.employee_id = $10::bigint)
               OR (
                 $10::bigint IS NULL
                 AND f.employee_id IS NULL
                 AND LOWER(f.description) = LOWER($2)
                 AND COALESCE(f.category_id, 0::bigint) = COALESCE($4::bigint, 0::bigint)
               )
             )
           )
         )`,
      [monthDate, description, description, categoryId, dueDate, amount, recurringKey, dueDay, kind, employeeId]
    );

    if ((updateResult.rowCount ?? 0) > 0) continue;
    // Linhas de folha só são criadas pelo gerador mensal a partir de finance_employees.
    if (kind === "folha") continue;

    await client.query(
      `INSERT INTO ${SCHEMA}.finance_fixed_expenses
         (month, description, category_id, due_date, amount, notes, kind, recurring_locked, recurring_key, recurring_due_day)
       SELECT $1::date, $2, $3::bigint, $4::date, $5, $6, 'geral', TRUE, $7, $8
       WHERE NOT EXISTS (
         SELECT 1 FROM ${SCHEMA}.finance_fixed_expenses f
         WHERE f.month = $1::date
           AND f.kind = 'geral'
           AND LOWER(f.description) = LOWER($2)
           AND COALESCE(f.category_id, 0::bigint) = COALESCE($3::bigint, 0::bigint)
       )`,
      [monthDate, description, categoryId, dueDate, amount, source.notes ?? null, recurringKey, dueDay]
    );
  }
}

async function syncExistingFutureLockedExpenses(id: number): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT month, kind, recurring_locked FROM ${SCHEMA}.finance_fixed_expenses WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const source = rows[0];
    if (!source || (source.kind !== "geral" && source.kind !== "folha") || !source.recurring_locked) {
      await client.query("COMMIT");
      return;
    }

    const sourceMonth = normalizeMonthDate(source.month);
    const { rows: futureMonths } = await client.query(
      `SELECT DISTINCT month FROM ${SCHEMA}.finance_fixed_expenses WHERE month > $1::date ORDER BY month`,
      [sourceMonth]
    );

    for (const row of futureMonths) {
      const targetMonth = normalizeMonthDate(row.month);
      if (targetMonth) await syncLockedFixedExpensesForMonth(client, targetMonth);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deactivateFutureLockedExpenses(recurringKey: string | null, fromMonth: string): Promise<void> {
  if (!recurringKey) return;
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_fixed_expenses
     SET recurring_locked = FALSE,
         updated_at = NOW()
     WHERE recurring_key = $1
       AND month > $2::date`,
    [recurringKey, fromMonth]
  );
}

/**
 * Garante os lançamentos fixos do mês: no primeiro acesso copia os itens do mês
 * anterior (valores e vencimentos, status zerado) — ou o modelo padrão quando
 * ainda não há histórico — e cria uma linha de folha por funcionário ativo.
 */
export async function ensureFixedExpensesForMonth(month: string): Promise<void> {
  if (month < FIXED_EXPENSES_START_MONTH) return;
  await ensureFinanceSchema();
  const pool = getPool();
  const monthDate = monthToDate(month);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`finance-fixed:${monthDate}`]);

    const { rows: existing } = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.finance_fixed_expenses WHERE month = $1`,
      [monthDate]
    );
    if (existing[0]?.count > 0) {
      // Não resincroniza um mês que já tem lançamentos: isso reaplicaria os
      // valores do mês travado mais recente por cima de qualquer edição feita
      // diretamente neste mês (categoria, trava, valor), inclusive revertendo
      // um "destravar" logo na próxima leitura. A propagação para a frente já
      // acontece no momento da edição, via syncExistingFutureLockedExpenses.
      await client.query("COMMIT");
      return;
    }

    // Nunca inventar histórico: consultar um mês anterior ao primeiro
    // lançamento existente não pode criar folha de pagamento e itens fixos
    // num período em que a operação nem existia. (Já criou: abrir um recorte
    // longo semeava meses para trás com os salários atuais.) Tabela vazia é a
    // única exceção — é a primeira carga do módulo.
    const { rows: firstRows } = await client.query(
      `SELECT MIN(month)::date AS month FROM ${SCHEMA}.finance_fixed_expenses`
    );
    const firstExistingMonth = firstRows[0]?.month ? toIsoDate(firstRows[0].month) : null;
    if (firstExistingMonth && monthDate < firstExistingMonth) {
      await client.query("COMMIT");
      return;
    }

    const { rows: prev } = await client.query(
      `SELECT MAX(month) AS month FROM ${SCHEMA}.finance_fixed_expenses WHERE month < $1`,
      [monthDate]
    );
    const prevMonth = prev[0]?.month ? toIsoDate(prev[0].month) : null;

    if (prevMonth) {
      // Copia itens "geral" do mês anterior; folha é recriada dos funcionários ativos.
      await client.query(
        `INSERT INTO ${SCHEMA}.finance_fixed_expenses
           (month, description, category_id, due_date, amount, notes, kind, recurring_locked, recurring_key, recurring_due_day)
         SELECT $1::date, description, category_id,
                CASE WHEN due_date IS NULL THEN NULL
                     ELSE (
                       $1::date
                       + (
                         LEAST(
                           COALESCE(recurring_due_day, EXTRACT(DAY FROM due_date)::int),
                           EXTRACT(DAY FROM (date_trunc('month', $1::date) + INTERVAL '1 month - 1 day'))::int
                         ) - 1
                       ) * INTERVAL '1 day'
                     )::date END,
                amount, notes, kind, recurring_locked, recurring_key,
                CASE WHEN recurring_locked THEN COALESCE(recurring_due_day, EXTRACT(DAY FROM due_date)::int) ELSE recurring_due_day END
         FROM (
           SELECT DISTINCT ON (LOWER(description), COALESCE(category_id, 0::bigint))
                  description, category_id, due_date, amount, notes, kind, recurring_locked, recurring_key, recurring_due_day, id
           FROM ${SCHEMA}.finance_fixed_expenses
           WHERE month = $2::date AND kind = 'geral'
           ORDER BY LOWER(description), COALESCE(category_id, 0::bigint), id
         ) previous_fixed
         WHERE NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.finance_fixed_expenses f
           WHERE f.month = $1::date
             AND f.kind = 'geral'
             AND LOWER(f.description) = LOWER(previous_fixed.description)
             AND COALESCE(f.category_id, 0::bigint) = COALESCE(previous_fixed.category_id, 0::bigint)
         )`,
        [monthDate, prevMonth]
      );
    } else {
      const fixedCategoryIds = new Map<string, number | null>();
      for (const item of DEFAULT_FIXED_ITEMS) {
        const { rows } = await client.query(
          `SELECT id FROM ${SCHEMA}.finance_categories WHERE kind = 'gasto_fixo' AND name = $1 LIMIT 1`,
          [item]
        );
        fixedCategoryIds.set(item, rows[0] ? Number(rows[0].id) : null);
      }
      for (const item of DEFAULT_FIXED_ITEMS) {
        await client.query(
          `INSERT INTO ${SCHEMA}.finance_fixed_expenses (month, description, category_id, amount, kind)
           SELECT $1::date, $2, $3::bigint, 0, 'geral'
           WHERE NOT EXISTS (
             SELECT 1 FROM ${SCHEMA}.finance_fixed_expenses f
             WHERE f.month = $1::date
               AND f.kind = 'geral'
               AND LOWER(f.description) = LOWER($2)
               AND COALESCE(f.category_id, 0::bigint) = COALESCE($3::bigint, 0::bigint)
           )`,
          [monthDate, item, fixedCategoryIds.get(item) ?? null]
        );
      }
    }

    const { rows: payrollCategories } = await client.query(
      `SELECT id FROM ${SCHEMA}.finance_categories WHERE kind = 'gasto_fixo' AND name = $1 LIMIT 1`,
      [PAYROLL_EXPENSE_LABEL]
    );
    const payrollCategoryId = payrollCategories[0] ? Number(payrollCategories[0].id) : null;
    await client.query(
      `INSERT INTO ${SCHEMA}.finance_fixed_expenses
         (month, description, category_id, due_date, amount, benefits_amount, employee_id, kind, recurring_locked, recurring_key, recurring_due_day)
       SELECT $1::date, e.name, $2::bigint,
              CASE WHEN prev.recurring_locked THEN
                ($1::date + (
                  LEAST(
                    COALESCE(prev.recurring_due_day, EXTRACT(DAY FROM prev.due_date)::int),
                    EXTRACT(DAY FROM (date_trunc('month', $1::date) + INTERVAL '1 month - 1 day'))::int
                  ) - 1
                ) * INTERVAL '1 day')::date
              ELSE NULL END,
              e.salary, e.benefits, e.id, 'folha',
              COALESCE(prev.recurring_locked, FALSE),
              prev.recurring_key,
              CASE WHEN prev.recurring_locked THEN COALESCE(prev.recurring_due_day, EXTRACT(DAY FROM prev.due_date)::int) ELSE NULL END
       FROM ${SCHEMA}.finance_employees e
       LEFT JOIN LATERAL (
         SELECT f2.due_date, f2.recurring_locked, f2.recurring_key, f2.recurring_due_day
         FROM ${SCHEMA}.finance_fixed_expenses f2
         WHERE f2.kind = 'folha' AND f2.employee_id = e.id AND f2.month < $1::date
         ORDER BY f2.month DESC
         LIMIT 1
       ) prev ON TRUE
       WHERE e.active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.finance_fixed_expenses f
           WHERE f.month = $1::date AND f.kind = 'folha' AND f.employee_id = e.id
         )`,
      [monthDate, payrollCategoryId]
    );
    await syncLockedFixedExpensesForMonth(client, monthDate);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Totais agregados de todos os meses (receita, despesas fixas/variáveis,
 * comissões, lucro, margem) — usado pelos KPIs da aba Despesas quando o
 * addon "ver todos os meses" está ativo, pra ficar coerente com as listas.
 */
export async function getAllTimeExpenseTotals(): Promise<FinanceMonthTotals> {
  await ensureFinanceSchema();
  const pool = getPool();
  // "Todos os meses" = do primeiro lançamento até o MÊS CORRENTE. Sem o teto,
  // este bloco somava parcela de receita até 2027 e folha até dezembro.
  const ceiling = financeCeilingExclusiveDate();
  const [revenues, fixed, variable, commissions, branchSetup, enrollments] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(r.amount) FILTER (WHERE r.status <> 'cancelado'), 0) AS revenue,
              COALESCE(SUM(
                CASE WHEN r.status = 'cancelado' THEN 0
                     WHEN r.enrollment_id IS NOT NULL THEN GREATEST(r.amount - ${ALLOCATED_PAID_SQL}, 0)
                     WHEN r.status <> 'recebido' THEN r.amount
                     ELSE 0 END
              ), 0) AS forecast,
              COALESCE(SUM(r.fee_amount) FILTER (WHERE r.status <> 'cancelado'), 0) AS fees
       FROM ${SCHEMA}.finance_revenues r
       ${ENROLLMENT_ALLOCATION_JOIN}
       WHERE r.date < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount + COALESCE(benefits_amount, 0)), 0) AS total
       FROM ${SCHEMA}.finance_fixed_expenses WHERE month >= $1::date AND month < $2`,
      [FIXED_EXPENSES_START_DATE, ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_variable_expenses
        WHERE date < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_commission_installments WHERE month < $1`,
      [ceiling]
    ),
    // Implantação/pré-operacional não têm piso (são reais desde abril/2026).
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_branch_items
        WHERE date IS NULL OR date < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(total_amount), 0) AS amount
         FROM ${SCHEMA}.finance_enrollments WHERE sale_date < $1`,
      [ceiling]
    ),
  ]);

  const revenue = num(revenues.rows[0]?.revenue);
  const fixedExpenses = num(fixed.rows[0]?.total);
  const variableExpenses = num(variable.rows[0]?.total);
  const commissionsTotal = num(commissions.rows[0]?.total);
  const totalExpenses = round2(fixedExpenses + commissionsTotal + variableExpenses);
  const profit = round2(revenue - totalExpenses);

  return {
    month: "todos",
    revenue,
    revenueForecast: num(revenues.rows[0]?.forecast),
    fixedExpenses,
    variableExpenses,
    commissions: commissionsTotal,
    branchSetup: num(branchSetup.rows[0]?.total),
    totalExpenses,
    profit,
    margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    enrollmentsCount: Number(enrollments.rows[0]?.total ?? 0),
    enrollmentsAmount: num(enrollments.rows[0]?.amount),
    cardFees: num(revenues.rows[0]?.fees),
  };
}

/**
 * Gasto acumulado de todos os meses: implantação + pré-operacional + despesas
 * fixas + variáveis. Não desconta receita — é a visão de "quanto já saiu".
 *
 * Três decisões que mudam o número e valem explicar:
 * 1. **Ignora o filtro de período/unidade do topo.** A pergunta é o total da
 *    empresa; um card que muda com o mês selecionado responderia outra coisa.
 * 2. **Corta somente despesa fixa anterior a FIXED_EXPENSES_START_DATE**.
 *    `ensureFixedExpensesForMonth` já semeou meses de 2025 sem operação real;
 *    somá-los inflaria o total em centenas de milhares. Despesas variáveis são
 *    lançamentos reais e entram desde a sua data, inclusive em maio de 2026.
 *    Implantação e pré-operacional também ficam fora desse piso.
 * 3. **Não soma mês futuro.** Fixas já estão provisionadas até dezembro e
 *    variáveis têm lançamentos com data à frente — dinheiro que ainda não
 *    saiu. Vai separado, em `futureProvisioned`.
 */
export async function getAllTimeSpend(): Promise<FinanceAllTimeSpend> {
  await ensureFinanceSchema();
  const pool = getPool();
  const [branch, fixed, variable, commissions, first] = await Promise.all([
    pool.query(
      // Sem piso (montagem da unidade é real desde abril/2026), mas com teto:
      // item lançado com data futura ainda não é gasto.
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE phase = 'pre_operacional'), 0) AS pre_operacional,
         COALESCE(SUM(amount) FILTER (WHERE phase <> 'pre_operacional'), 0) AS implementacao
       FROM ${SCHEMA}.finance_branch_items
       WHERE date IS NULL OR date < $1`,
      [financeCeilingExclusiveDate()]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(amount + COALESCE(benefits_amount, 0))
                  FILTER (WHERE month <= date_trunc('month', CURRENT_DATE)::date), 0) AS realizado,
         COALESCE(SUM(amount + COALESCE(benefits_amount, 0))
                  FILTER (WHERE month > date_trunc('month', CURRENT_DATE)::date), 0) AS futuro
       FROM ${SCHEMA}.finance_fixed_expenses
       WHERE month >= $1::date`,
      [FIXED_EXPENSES_START_DATE]
    ),
    pool.query(
      // Teto por MÊS (não por dia), senão uma variável lançada pro fim do mês
      // corrente cairia em "futuro". Não há piso: variável é gasto real desde
      // o primeiro lançamento, ao contrário da fixa provisionada.
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE date < $1), 0) AS realizado,
         COALESCE(SUM(amount) FILTER (WHERE date >= $1), 0) AS futuro
       FROM ${SCHEMA}.finance_variable_expenses`,
      [financeCeilingExclusiveDate()]
    ),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_commission_installments`),
    pool.query(
      // Só olha o que de fato entra na conta. O piso vale exclusivamente para
      // fixas provisionadas; variáveis entram desde o primeiro lançamento.
      `SELECT MIN(d)::date AS first FROM (
         SELECT MIN(date) AS d FROM ${SCHEMA}.finance_branch_items
         UNION ALL SELECT MIN(month) FROM ${SCHEMA}.finance_fixed_expenses WHERE month >= $1::date
         UNION ALL SELECT MIN(date) FROM ${SCHEMA}.finance_variable_expenses
       ) t`,
      [FIXED_EXPENSES_START_DATE]
    ),
  ]);

  const implementation = num(branch.rows[0]?.implementacao);
  const preOperational = num(branch.rows[0]?.pre_operacional);
  const fixedExpenses = num(fixed.rows[0]?.realizado);
  const variableExpenses = num(variable.rows[0]?.realizado);

  return {
    implementation,
    preOperational,
    fixedExpenses,
    variableExpenses,
    total: round2(implementation + preOperational + fixedExpenses + variableExpenses),
    futureProvisioned: round2(num(fixed.rows[0]?.futuro) + num(variable.rows[0]?.futuro)),
    commissionsProvisioned: num(commissions.rows[0]?.total),
    firstMovement: first.rows[0]?.first ? String(first.rows[0].first).slice(0, 10) : null,
    fixedFrom: FIXED_EXPENSES_START_MONTH,
  };
}

export async function listFixedExpenses(month: string, businessUnit?: FinanceBusinessUnit): Promise<FinanceFixedExpense[]> {
  if (month < FIXED_EXPENSES_START_MONTH) return [];
  await ensureFixedExpensesForMonth(month);
  const values: unknown[] = [monthToDate(month)];
  const unitSql = businessUnit ? ` AND f.business_unit = $${values.push(businessUnit)}` : "";
  const { rows } = await getPool().query(
    `${FIXED_SELECT} WHERE f.month = $1${unitSql} ORDER BY f.kind, f.description`,
    values
  );
  return rows.map(mapFixed);
}

/**
 * Despesas fixas de um intervalo de meses — usado quando o filtro do topo está
 * em "Período". Provisiona cada mês do intervalo até o mês corrente (meses
 * futuros nunca são gerados por navegação).
 */
export async function listFixedExpensesRange(from: string, to: string, businessUnit?: FinanceBusinessUnit): Promise<FinanceFixedExpense[]> {
  const effectiveFrom = from < FIXED_EXPENSES_START_MONTH ? FIXED_EXPENSES_START_MONTH : from;
  if (effectiveFrom > to) return [];
  const provisionLimit = currentMonth();
  let cursor = effectiveFrom;
  while (cursor <= to) {
    if (cursor <= provisionLimit) await ensureFixedExpensesForMonth(cursor);
    cursor = addMonths(cursor, 1);
  }
  await ensureFinanceSchema();
  const values: unknown[] = [monthToDate(effectiveFrom), monthToDate(addMonths(to, 1))];
  const unitSql = businessUnit ? ` AND f.business_unit = $${values.push(businessUnit)}` : "";
  const { rows } = await getPool().query(
    `${FIXED_SELECT} WHERE f.month >= $1 AND f.month < $2${unitSql} ORDER BY f.month, f.kind, f.description`,
    values
  );
  return rows.map(mapFixed);
}

/**
 * Todas as despesas fixas já lançadas, de qualquer mês — usado pelo addon
 * "ver todos os meses" da lista. Não chama ensureFixedExpensesForMonth (não
 * há um mês único a garantir) nem gera nada novo, só lista o que já existe.
 */
export async function listAllFixedExpenses(businessUnit?: FinanceBusinessUnit): Promise<FinanceFixedExpense[]> {
  await ensureFinanceSchema();
  const values: unknown[] = [FIXED_EXPENSES_START_DATE];
  const unitSql = businessUnit ? ` AND f.business_unit = $${values.push(businessUnit)}` : "";
  const { rows } = await getPool().query(
    `${FIXED_SELECT} WHERE f.month >= $1::date${unitSql} ORDER BY f.month DESC, f.kind, f.description`,
    values
  );
  return rows.map(mapFixed);
}

export interface FixedExpenseInput {
  month: string;
  businessUnit?: FinanceBusinessUnit;
  description: string;
  categoryId?: number | null;
  dueDate?: string | null;
  amount: number;
  benefitsAmount?: number | null;
  status?: ExpenseStatus;
  paidAt?: string | null;
  notes?: string | null;
  invoiceUrl?: string | null;
  recurringLocked?: boolean;
}

export async function createFixedExpense(input: FixedExpenseInput): Promise<number> {
  await ensureFinanceSchema();
  if (input.month < FIXED_EXPENSES_START_MONTH) {
    throw new Error("Despesas fixas só podem ser lançadas a partir de junho de 2026.");
  }
  if (!input.description?.trim()) throw new Error("Descrição é obrigatória.");
  const recurringLocked = Boolean(input.recurringLocked);
  const recurringDueDay = recurringLocked ? dueDayFromDate(input.dueDate) : null;
  const recurringKey = recurringLocked ? randomUUID() : null;
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_fixed_expenses
       (month, description, category_id, due_date, amount, benefits_amount, status, paid_at, notes, invoice_url, kind, recurring_locked, recurring_key, recurring_due_day, business_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'geral', $11, $12, $13, $14) RETURNING id`,
    [
      monthToDate(input.month),
      input.description.trim(),
      input.categoryId ?? null,
      input.dueDate || null,
      round2(input.amount ?? 0),
      input.benefitsAmount === undefined || input.benefitsAmount === null ? null : round2(input.benefitsAmount),
      normalizeExpenseStatus(input.status),
      input.paidAt || null,
      input.notes?.trim() || null,
      input.invoiceUrl?.trim() || null,
      recurringLocked,
      recurringKey,
      recurringDueDay,
      normalizeBusinessUnit(input.businessUnit),
    ]
  );
  const id = Number(rows[0].id);
  if (recurringLocked) await syncExistingFutureLockedExpenses(id);
  return id;
}

export async function updateFixedExpense(id: number, input: Partial<FixedExpenseInput>): Promise<void> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT month, due_date, kind, recurring_locked, recurring_key, recurring_due_day
     FROM ${SCHEMA}.finance_fixed_expenses WHERE id = $1`,
    [id]
  );
  const current = rows[0];
  if (!current) throw new Error("Despesa fixa não encontrada.");
  const lockable = current.kind === "geral" || current.kind === "folha";
  if (!lockable && input.recurringLocked) {
    throw new Error("A trava mensal vale apenas para despesas fixas gerais e folha de pagamento.");
  }

  const nextDueDate = input.dueDate === undefined ? toIsoDate(current.due_date) : input.dueDate || null;
  const nextRecurringLocked =
    lockable && (input.recurringLocked === undefined ? Boolean(current.recurring_locked) : Boolean(input.recurringLocked));
  const nextRecurringDueDay =
    nextRecurringLocked ? dueDayFromDate(nextDueDate) ?? normalizeDueDay(current.recurring_due_day) : null;
  const currentRecurringKey = (current.recurring_key as string | null) ?? null;
  const nextRecurringKey = nextRecurringLocked && !currentRecurringKey ? randomUUID() : currentRecurringKey;
  const map: Record<string, unknown> = {
    description: input.description?.trim(),
    category_id: input.categoryId,
    due_date: input.dueDate === undefined ? undefined : input.dueDate || null,
    amount: input.amount !== undefined ? round2(input.amount) : undefined,
    benefits_amount:
      input.benefitsAmount === undefined ? undefined : input.benefitsAmount === null ? null : round2(input.benefitsAmount),
    status: input.status !== undefined ? normalizeExpenseStatus(input.status) : undefined,
    paid_at: input.paidAt === undefined ? undefined : input.paidAt || null,
    notes: input.notes,
    invoice_url: input.invoiceUrl,
    business_unit: input.businessUnit,
    recurring_locked: input.recurringLocked === undefined ? undefined : nextRecurringLocked,
    recurring_key: nextRecurringKey !== currentRecurringKey ? nextRecurringKey : undefined,
    recurring_due_day:
      input.recurringLocked === false
        ? null
        : input.recurringLocked !== undefined || input.dueDate !== undefined
          ? nextRecurringDueDay
          : undefined,
  };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
    await getPool().query(
      `UPDATE ${SCHEMA}.finance_fixed_expenses SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
      [id, ...entries.map(([, v]) => v)]
    );
  }
  // Linha de folha editada atualiza o salário-base do funcionário para os próximos meses.
  if (input.amount !== undefined || input.benefitsAmount !== undefined) {
    await getPool().query(
      `UPDATE ${SCHEMA}.finance_employees e
       SET salary = COALESCE($2, e.salary), benefits = COALESCE($3, e.benefits)
       FROM ${SCHEMA}.finance_fixed_expenses f
       WHERE f.id = $1 AND f.kind = 'folha' AND f.employee_id = e.id`,
      [
        id,
        input.amount !== undefined ? round2(input.amount) : null,
        input.benefitsAmount !== undefined && input.benefitsAmount !== null ? round2(input.benefitsAmount) : null,
      ]
    );
  }

  if (lockable && nextRecurringLocked) {
    await syncExistingFutureLockedExpenses(id);
  } else if (lockable && input.recurringLocked === false) {
    await deactivateFutureLockedExpenses(nextRecurringKey, normalizeMonthDate(current.month));
  }
}

export async function deleteFixedExpense(id: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_fixed_expenses WHERE id = $1`, [id]);
}

export async function saveFixedExpenseInvoice(
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await saveFinanceInvoice("finance_fixed_expenses", id, file);
}

export async function getFixedExpenseInvoice(
  id: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  return getFinanceInvoice("finance_fixed_expenses", id);
}

// ── Gastos variáveis ─────────────────────────────────────────────

function mapVariable(r: Record<string, unknown>): FinanceVariableExpense {
  return {
    id: Number(r.id),
    date: toIsoDate(r.date) ?? "",
    businessUnit: normalizeBusinessUnit(r.business_unit),
    description: String(r.description ?? ""),
    categoryId: r.category_id === null ? null : Number(r.category_id),
    categoryName: (r.category_name as string) ?? null,
    branchId: r.branch_id === null ? null : Number(r.branch_id),
    branchName: (r.branch_name as string) ?? null,
    amount: num(r.amount),
    notes: (r.notes as string) ?? null,
    invoiceUrl: (r.invoice_url as string) ?? null,
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
  };
}

export async function listVariableExpenses(filters: FinanceFilters = {}): Promise<FinanceVariableExpense[]> {
  await ensureFinanceSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.from) {
    values.push(monthToDate(filters.from));
    conditions.push(`v.date >= $${values.length}`);
  }
  if (filters.businessUnit) {
    values.push(filters.businessUnit);
    conditions.push(`v.business_unit = $${values.length}`);
  }
  if (filters.to) {
    values.push(monthToDate(addMonths(filters.to, 1)));
    conditions.push(`v.date < $${values.length}`);
  }
  if (filters.categoryId) {
    values.push(filters.categoryId);
    conditions.push(`v.category_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT v.*, (v.invoice_file IS NOT NULL) AS has_invoice, c.name AS category_name, b.name AS branch_name
     FROM ${SCHEMA}.finance_variable_expenses v
     LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = v.category_id
     LEFT JOIN ${SCHEMA}.finance_branches b ON b.id = v.branch_id
     ${where} ORDER BY v.date DESC, v.id DESC LIMIT 2000`,
    values
  );
  return rows.map(mapVariable);
}

export interface VariableExpenseInput {
  date: string;
  businessUnit?: FinanceBusinessUnit;
  description: string;
  categoryId?: number | null;
  branchId?: number | null;
  amount: number;
  notes?: string | null;
  invoiceUrl?: string | null;
}

export async function createVariableExpense(input: VariableExpenseInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.description?.trim()) throw new Error("Descrição é obrigatória.");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_variable_expenses (date, description, category_id, branch_id, amount, notes, invoice_url, business_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.date,
      input.description.trim(),
      input.categoryId ?? null,
      input.branchId ?? null,
      round2(input.amount ?? 0),
      input.notes?.trim() || null,
      input.invoiceUrl?.trim() || null,
      normalizeBusinessUnit(input.businessUnit),
    ]
  );
  return Number(rows[0].id);
}

export async function updateVariableExpense(id: number, input: Partial<VariableExpenseInput>): Promise<void> {
  await ensureFinanceSchema();
  const map: Record<string, unknown> = {
    date: input.date,
    description: input.description?.trim(),
    category_id: input.categoryId,
    branch_id: input.branchId,
    amount: input.amount !== undefined ? round2(input.amount) : undefined,
    notes: input.notes,
    invoice_url: input.invoiceUrl,
    business_unit: input.businessUnit,
  };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_variable_expenses SET ${sets.join(", ")} WHERE id = $1`,
    [id, ...entries.map(([, v]) => v)]
  );
}

export async function deleteVariableExpense(id: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_variable_expenses WHERE id = $1`, [id]);
}

export async function saveVariableExpenseInvoice(
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await saveFinanceInvoice("finance_variable_expenses", id, file);
}

export async function getVariableExpenseInvoice(
  id: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  return getFinanceInvoice("finance_variable_expenses", id);
}

// ── Matrículas parceladas ────────────────────────────────────────

/** Divide um total em N parcelas de centavos exatos (última absorve o resto). */
export function splitInstallments(total: number, count: number): number[] {
  const n = Math.max(1, Math.trunc(count));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === n - 1 ? remainder : 0)) / 100);
}

/** Busca a taxa (%) cadastrada para N parcelas + bandeira; sem bandeira, usa a taxa padrão daquele número de parcelas. */
async function lookupInstallmentRatePct(
  pool: Pool | PoolClient,
  installments: number,
  cardBrandId: number | null
): Promise<number> {
  const { rows } = cardBrandId
    ? await pool.query(
        `SELECT rate_pct FROM ${SCHEMA}.finance_installment_rates WHERE installments = $1 AND brand_id = $2`,
        [installments, cardBrandId]
      )
    : await pool.query(
        `SELECT rate_pct FROM ${SCHEMA}.finance_installment_rates WHERE installments = $1 AND brand_id IS NULL`,
        [installments]
      );
  return num(rows[0]?.rate_pct);
}

/**
 * Uma parcela combinada com o aluno. Existe porque nem toda venda é parcelada
 * em fatias iguais: entrada maior, parcela de reforço no meio, uma no Pix e o
 * resto no cartão são o caso normal, não a exceção.
 */
export interface EnrollmentScheduleItem {
  amount: number;
  /** Vencimento exato (YYYY-MM-DD); a competência é o mês dele. */
  dueDate: string;
  /** Diferencia a entrada das parcelas mensais no cronograma. */
  type?: "entrada" | "parcela";
  paymentMethodId?: number | null;
  cardBrandId?: number | null;
}

export interface EnrollmentInput {
  student: string;
  businessUnit?: FinanceBusinessUnit;
  courseId?: number | null;
  /**
   * Turma combinada na venda (`academic_classes`). `undefined` preserva o que já
   * está gravado — é campo de logística, e um formulário que não pergunta turma não
   * pode desfazer a alocação feita em /turmas.
   */
  classId?: number | null;
  totalAmount: number;
  /** Entrada paga na contratação; ela é abatida antes do cálculo mensal. */
  downPaymentAmount?: number | null;
  installments: number;
  paymentMethodId?: number | null;
  cardBrandId?: number | null;
  firstMonth: string; // YYYY-MM
  saleDate: string;
  sellerId?: number | null;
  /** Percentual da comissão desta matrícula; quando omitido, usa o padrão do vendedor. */
  commissionPct?: number | null;
  branchId?: number | null;
  notes?: string | null;
  /**
   * Cronograma combinado parcela a parcela. Quando omitido, mantém o
   * comportamento antigo: valor dividido em fatias iguais, uma por mês, todas
   * na forma de pagamento do contrato.
   */
  schedule?: EnrollmentScheduleItem[] | null;
}

interface ResolvedInstallment {
  amount: number;
  type: "entrada" | "parcela";
  /** Null quando a data da venda não tem dia utilizável — mantém o
   *  comportamento antigo de deixar a parcela sem vencimento. */
  dueDate: string | null;
  /** Primeiro dia do mês do vencimento — é a competência da receita. */
  competence: string;
  paymentMethodId: number | null;
  cardBrandId: number | null;
}

/**
 * Cronograma efetivo da matrícula: o que o usuário combinou ou, na falta dele,
 * o padrão de parcelas iguais mês a mês.
 */
function resolveSchedule(input: EnrollmentInput, installments: number): ResolvedInstallment[] {
  const custom = input.schedule?.filter((item) => Number.isFinite(item.amount) && item.amount > 0) ?? [];
  if (custom.length > 0) {
    return custom.map((item, index) => {
      const dueDate = item.dueDate.slice(0, 10);
      return {
        amount: round2(item.amount),
        type: item.type === "entrada" || (index === 0 && num(input.downPaymentAmount) > 0) ? "entrada" : "parcela",
        dueDate,
        competence: `${dueDate.slice(0, 7)}-01`,
        paymentMethodId: item.paymentMethodId ?? input.paymentMethodId ?? null,
        cardBrandId: item.cardBrandId ?? null,
      };
    });
  }

  const downPaymentAmount = Math.max(0, Math.min(round2(num(input.downPaymentAmount)), round2(input.totalAmount)));
  const parts = splitInstallments(round2(input.totalAmount - downPaymentAmount), installments);
  const dueDay = dueDayFromDate(input.saleDate);
  const regular = parts.map((amount, index) => {
    const competence = monthToDate(addMonths(input.firstMonth, index));
    return {
      amount,
      type: "parcela" as const,
      dueDate: dateInMonth(competence, dueDay),
      competence,
      paymentMethodId: input.paymentMethodId ?? null,
      cardBrandId: input.cardBrandId ?? null,
    };
  });
  if (downPaymentAmount <= 0) return regular;
  const entryDate = input.saleDate.slice(0, 10);
  return [
    {
      amount: downPaymentAmount,
      type: "entrada",
      dueDate: entryDate,
      competence: `${entryDate.slice(0, 7)}-01`,
      paymentMethodId: input.paymentMethodId ?? null,
      cardBrandId: input.cardBrandId ?? null,
    },
    ...regular,
  ];
}

/**
 * Grava as receitas por parcela da matrícula. Usado na criação e na edição —
 * os dois caminhos apagam e regeram o cronograma inteiro, então duplicar essa
 * montagem era o jeito mais fácil de as duas telas discordarem.
 *
 * A taxa de cartão é por parcela: no cronograma padrão vale a taxa do número
 * de parcelas do contrato (comportamento histórico); no cronograma combinado
 * cada parcela é uma cobrança avulsa e usa a taxa de 1 parcela da própria
 * bandeira.
 */
async function insertEnrollmentRevenues(
  client: PoolClient,
  enrollmentId: number,
  input: EnrollmentInput,
  schedule: ResolvedInstallment[],
  contractRatePct: number,
  courseName: string | null,
  categoryId: number | null
): Promise<void> {
  const isCustom = (input.schedule?.length ?? 0) > 0;
  const student = input.student.trim();
  const regularTotal = schedule.filter((item) => item.type === "parcela").length;
  let regularNumber = 0;

  for (const item of schedule) {
    const ratePct = isCustom
      ? await paymentMethodFeePct(client, item.paymentMethodId, item.cardBrandId)
      : contractRatePct;
    const installmentNumber = item.type === "entrada" ? 0 : ++regularNumber;
    const description = item.type === "entrada"
      ? `Matrícula — ${student}${courseName ? ` (${courseName})` : ""} · entrada`
      : regularTotal === 1
        ? `Matrícula — ${student}${courseName ? ` (${courseName})` : ""}`
        : `Matrícula — ${student}${courseName ? ` (${courseName})` : ""} · parcela ${installmentNumber}/${regularTotal}`;
    await client.query(
      `INSERT INTO ${SCHEMA}.finance_revenues
         (date, description, category_id, origin, student, course_id, branch_id, payment_method_id, card_brand_id,
          seller_id, amount, fee_amount, status, enrollment_id, installment_number, due_date, business_unit)
       VALUES ($1, $2, $3, 'Matrícula parcelada', $4, $5, $6, $7, $8, $9, $10, $11, 'previsto', $12, $13, $14, $15)`,
      [
        item.competence,
        description,
        categoryId,
        student,
        input.courseId ?? null,
        input.branchId ?? null,
        item.paymentMethodId,
        item.cardBrandId,
        input.sellerId ?? null,
        item.amount,
        round2((item.amount * ratePct) / 100),
        enrollmentId,
        installmentNumber,
        item.dueDate,
        normalizeBusinessUnit(input.businessUnit),
      ]
    );
  }
}

/**
 * O cronograma tem que fechar com o valor da venda. Deixar passar uma soma
 * diferente criaria uma matrícula que se diz de R$ 9.000 cobrando R$ 8.700 —
 * a divergência só apareceria meses depois, na cobrança que faltou.
 */
function assertScheduleMatchesTotal(schedule: ResolvedInstallment[], totalAmount: number): void {
  const sum = round2(schedule.reduce((total, item) => total + item.amount, 0));
  if (Math.abs(sum - round2(totalAmount)) > 0.01) {
    throw new Error(
      `A soma das parcelas (${sum.toFixed(2)}) não bate com o valor da venda (${round2(totalAmount).toFixed(2)}).`
    );
  }
}

/**
 * Forma de pagamento pelo nome. O quadro do contrato guarda o NOME da forma
 * (é o que sai impresso), então quem volta do contrato para a matrícula precisa
 * deste caminho. Sem correspondência devolve `null` — o chamador decide se
 * mantém a forma que já estava, e nunca troca por uma errada.
 */
export async function findPaymentMethodIdByName(name: string | null | undefined): Promise<number | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT id FROM ${SCHEMA}.finance_payment_methods
      WHERE UPPER(TRIM(name)) = UPPER(TRIM($1))
      ORDER BY active DESC, id LIMIT 1`,
    [trimmed]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Recusa um cronograma mais longo do que a forma de pagamento aceita. O teto
 * vive no cadastro da forma (Financeiro → Configurações → Formas de Pagamento)
 * para o servidor e o seletor da tela usarem exatamente o mesmo número; sem esta
 * checagem, um POST direto passaria por cima do que o `<select>` oferece.
 */
function assertInstallmentsWithinMethodCap(
  method: { name?: string; max_installments?: number | null } | undefined,
  installments: number
): void {
  if (!method?.max_installments) return; // forma sem teto próprio: vale o do sistema
  const cap = installmentCap(method.max_installments);
  if (installments > cap) {
    throw new Error(`${method.name ?? "A forma de pagamento escolhida"} aceita no máximo ${cap}x.`);
  }
}

/** Taxa da forma no cronograma; taxas por parcela/bandeira são o fallback. */
async function paymentMethodFeePct(
  client: PoolClient,
  paymentMethodId: number | null,
  cardBrandId: number | null
): Promise<number> {
  if (!paymentMethodId) return 0;
  const { rows } = await client.query(
    `SELECT kind, fee_pct FROM ${SCHEMA}.finance_payment_methods WHERE id = $1`,
    [paymentMethodId]
  );
  const methodFeePct = num(rows[0]?.fee_pct);
  if (methodFeePct > 0) return methodFeePct;
  if (rows[0]?.kind !== "parcelado") return 0;
  return lookupInstallmentRatePct(client, 1, cardBrandId);
}

async function resolveEnrollmentCommissionPct(client: PoolClient, sellerId: number | null | undefined, requested: number | null | undefined): Promise<number> {
  if (!sellerId) return 0;
  if (requested !== undefined && requested !== null) return Math.max(0, Math.min(100, round2(requested)));
  const { rows } = await client.query(`SELECT default_pct FROM ${SCHEMA}.finance_sellers WHERE id = $1`, [sellerId]);
  return Math.max(0, Math.min(100, round2(num(rows[0]?.default_pct))));
}

/** Mantém uma única comissão vinculada à matrícula, regenerando suas parcelas quando a venda é editada. */
async function syncEnrollmentCommission(
  client: PoolClient,
  input: EnrollmentInput,
  enrollmentId: number,
  schedule: ResolvedInstallment[],
  commissionPct: number
): Promise<void> {
  const effectiveInstallments = schedule.length;
  const { rows: existingRows } = await client.query(
    `SELECT id FROM ${SCHEMA}.finance_commissions WHERE enrollment_id = $1 LIMIT 1`,
    [enrollmentId]
  );
  const existingId = existingRows[0]?.id ? Number(existingRows[0].id) : null;
  if (!input.sellerId || commissionPct <= 0) {
    if (existingId) await client.query(`DELETE FROM ${SCHEMA}.finance_commissions WHERE id = $1`, [existingId]);
    return;
  }

  const totalCommission = round2((input.totalAmount * commissionPct) / 100);
  const methodId = input.paymentMethodId ?? null;
  const values = [input.saleDate, input.sellerId, input.student.trim(), input.courseId ?? null, round2(input.totalAmount), commissionPct, methodId, effectiveInstallments, totalCommission, enrollmentId, input.notes?.trim() || null];
  let commissionId = existingId;
  if (commissionId) {
    // $10 é o id da MATRÍCULA (a lista é montada para o INSERT); a comissão tem
    // id próprio e vai como $12. Filtrar por $10 aqui fazia a edição escrever em
    // cima de outra comissão qualquer — a de id igual ao da matrícula — e deixar
    // esta com vendedor, valor e percentual congelados no que eram antes.
    await client.query(
      `UPDATE ${SCHEMA}.finance_commissions
       SET date = $1, seller_id = $2, student = $3, course_id = $4, sale_amount = $5,
           percent = $6, payment_method_id = $7, installments = $8, total_commission = $9, notes = $11
       WHERE id = $12 AND enrollment_id = $10`,
      [...values, commissionId]
    );
    await client.query(`DELETE FROM ${SCHEMA}.finance_commission_installments WHERE commission_id = $1`, [commissionId]);
  } else {
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_commissions
         (date, seller_id, student, course_id, sale_amount, percent, payment_method_id, installments, total_commission, enrollment_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      values
    );
    commissionId = Number(rows[0].id);
  }

  // A comissão acompanha o cronograma das parcelas, não o mês da venda: quando
  // a 1ª parcela cai no mês seguinte, iniciar pela venda jogava despesa de
  // comissão num mês sem a receita correspondente. Com parcelas de valores
  // diferentes, cada fatia da comissão é proporcional à parcela que a gerou —
  // uma entrada de 50% do contrato paga 50% da comissão.
  const total = round2(schedule.reduce((sum, item) => sum + item.amount, 0));
  let distributed = 0;
  for (const [index, item] of schedule.entries()) {
    const isLast = index === schedule.length - 1;
    const share = isLast
      ? round2(totalCommission - distributed)
      : round2((totalCommission * item.amount) / (total || 1));
    distributed = round2(distributed + share);
    await client.query(
      `INSERT INTO ${SCHEMA}.finance_commission_installments (commission_id, month, amount, status)
       VALUES ($1, $2, $3, 'pendente')`,
      [commissionId, item.competence, share]
    );
  }
}

/**
 * Cadastra a matrícula e gera automaticamente uma receita por parcela nos
 * meses correspondentes (categoria Matrícula, com taxa do cartão embutida em
 * fee_amount a partir da tabela de taxas) — sem lançamento manual. A taxa é
 * buscada pela forma quando ela tem uma configuração própria; sem essa taxa,
 * formas parceladas usam a bandeira informada e a taxa padrão daquele número
 * de parcelas.
 */
export async function createEnrollment(input: EnrollmentInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.student?.trim()) throw new Error("Aluno é obrigatório.");
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw new Error("Valor do curso inválido.");
  if (!Number.isFinite(num(input.downPaymentAmount)) || num(input.downPaymentAmount) < 0 || num(input.downPaymentAmount) > input.totalAmount) {
    throw new Error("O valor da entrada deve estar entre zero e o valor total da matrícula.");
  }
  const requestedInstallments = normalizeEnrollmentInstallments(input.installments);
  const cardBrandId = input.cardBrandId ?? null;

  const schedule = resolveSchedule(input, requestedInstallments);
  assertScheduleMatchesTotal(schedule, input.totalAmount);
  // Com cronograma combinado, quem manda é ele: o número de parcelas do
  // contrato é o número de linhas acordadas, não o que veio no seletor.
  const installments = schedule.length;

  const pool = getPool();
  const { rows: methodRows } = input.paymentMethodId
    ? await pool.query(
        `SELECT name, kind, fee_pct, max_installments FROM ${SCHEMA}.finance_payment_methods WHERE id = $1`,
        [input.paymentMethodId]
      )
    : { rows: [] as Array<{ name: string; kind: string; fee_pct: number; max_installments: number | null }> };
  assertInstallmentsWithinMethodCap(methodRows[0], requestedInstallments);
  const hasCardInstallmentFee = methodRows[0]?.kind === "parcelado";
  const methodFeePct = num(methodRows[0]?.fee_pct);
  const ratePct = methodFeePct > 0
    ? methodFeePct
    : hasCardInstallmentFee
      ? await lookupInstallmentRatePct(pool, installments, cardBrandId)
      : 0;
  const categoryId = await findCategoryId("receita", "Matrícula");

  const { rows: courseRows } = input.courseId
    ? await pool.query(`SELECT name FROM ${SCHEMA}.finance_courses WHERE id = $1`, [input.courseId])
    : { rows: [] as Array<{ name: string }> };
  const courseName = courseRows[0]?.name ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const commissionPct = await resolveEnrollmentCommissionPct(client, input.sellerId, input.commissionPct);
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_enrollments
         (student, course_id, total_amount, down_payment_amount, regular_installments, installments, payment_method_id, card_brand_id, first_month, sale_date, seller_id, branch_id, rate_pct, notes, business_unit, class_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [
        input.student.trim(),
        input.courseId ?? null,
        round2(input.totalAmount),
        round2(num(input.downPaymentAmount)),
        requestedInstallments,
        installments,
        input.paymentMethodId ?? null,
        cardBrandId,
        monthToDate(input.firstMonth),
        input.saleDate,
        input.sellerId ?? null,
        input.branchId ?? null,
        ratePct,
        input.notes?.trim() || null,
        normalizeBusinessUnit(input.businessUnit),
        input.classId ?? null,
      ]
    );
    const enrollmentId = Number(rows[0].id);

    await insertEnrollmentRevenues(client, enrollmentId, input, schedule, ratePct, courseName, categoryId);
    await syncEnrollmentCommission(client, input, enrollmentId, schedule, commissionPct);
    await client.query("COMMIT");
    return enrollmentId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sameAmount(left: unknown, right: unknown): boolean {
  return Math.abs(round2(num(left)) - round2(num(right))) <= 0.01;
}

function sameNullableId(left: unknown, right: number | null | undefined): boolean {
  const normalizedLeft = left === null || left === undefined ? null : Number(left);
  const normalizedRight = right === null || right === undefined ? null : Number(right);
  return normalizedLeft === normalizedRight;
}

/**
 * Com recebimentos registrados, a matrícula deixa de ser um rascunho. O
 * contrato original continua imutável, mas as parcelas ainda sem recebimento
 * podem ser redistribuídas para registrar uma renegociação real do saldo.
 */
function assertPaidEnrollmentContractIsStable(
  current: Record<string, unknown>,
  input: EnrollmentInput,
  requestedInstallments: number,
  schedule: ResolvedInstallment[]
): void {
  const currentFirstMonth = dateToMonth(current.first_month);
  const currentSaleDate = toIsoDate(current.sale_date) ?? "";
  const hasChangedTerms =
    !sameAmount(current.total_amount, input.totalAmount) ||
    !sameAmount(current.down_payment_amount, num(input.downPaymentAmount)) ||
    Number(current.regular_installments) !== requestedInstallments ||
    Number(current.installments) !== schedule.length ||
    !sameNullableId(current.payment_method_id, input.paymentMethodId) ||
    !sameNullableId(current.card_brand_id, input.cardBrandId) ||
    currentFirstMonth !== input.firstMonth ||
    currentSaleDate !== input.saleDate.slice(0, 10) ||
    String(current.student ?? "") !== input.student.trim() ||
    !sameNullableId(current.course_id, input.courseId) ||
    !sameNullableId(current.seller_id, input.sellerId) ||
    !sameNullableId(current.branch_id, input.branchId);

  if (hasChangedTerms) {
    throw new Error("Depois de registrar recebimentos, os dados do contrato permanecem protegidos. Altere apenas o valor ou vencimento das parcelas ainda em aberto.");
  }
}

interface EnrollmentRevenueForAdjustment {
  id: number;
  installmentNumber: number | null;
  amount: number;
  feeAmount: number;
  dueDate: string;
  paidAmount: number;
}

async function updateOpenEnrollmentSchedule(
  client: PoolClient,
  enrollmentId: number,
  input: EnrollmentInput,
  schedule: ResolvedInstallment[],
  contractRatePct: number,
  courseName: string | null,
  categoryId: number | null
): Promise<void> {
  const { rows } = await client.query(
    `SELECT r.id, r.installment_number, r.amount, r.fee_amount, r.due_date,
            COALESCE((
              SELECT SUM(allocation.amount)
              FROM ${SCHEMA}.finance_enrollment_payment_allocations allocation
              WHERE allocation.revenue_id = r.id
            ), 0) AS paid_amount
       FROM ${SCHEMA}.finance_revenues r
      WHERE r.enrollment_id = $1
      ORDER BY CASE WHEN r.installment_number = 0 THEN 0 ELSE 1 END, r.installment_number, r.id
      FOR UPDATE`,
    [enrollmentId]
  );
  const existing = rows.map((row) => ({
    id: Number(row.id),
    installmentNumber: row.installment_number === null || row.installment_number === undefined ? null : Number(row.installment_number),
    amount: round2(num(row.amount)),
    feeAmount: round2(num(row.fee_amount)),
    dueDate: toIsoDate(row.due_date) ?? "",
    paidAmount: round2(num(row.paid_amount)),
  })) as EnrollmentRevenueForAdjustment[];

  if (existing.length !== schedule.length) {
    throw new Error("Não é possível alterar a quantidade de parcelas depois de registrar recebimentos. Ajuste somente as parcelas ainda em aberto.");
  }

  for (const [index, item] of schedule.entries()) {
    const previous = existing[index];
    const expectedType = previous.installmentNumber === 0 ? "entrada" : "parcela";
    if (item.type !== expectedType) {
      throw new Error("A estrutura das parcelas não pode ser alterada depois de haver recebimentos.");
    }
    if (previous.paidAmount > 0.005 && (!sameAmount(previous.amount, item.amount) || previous.dueDate !== item.dueDate)) {
      throw new Error("Uma parcela que já recebeu pagamento não pode ter valor ou vencimento alterados.");
    }
  }

  const regularTotal = schedule.filter((item) => item.type === "parcela").length;
  let regularNumber = 0;
  for (const [index, item] of schedule.entries()) {
    const previous = existing[index];
    const installmentNumber = item.type === "entrada" ? 0 : ++regularNumber;
    const description = item.type === "entrada"
      ? `Matrícula — ${input.student.trim()}${courseName ? ` (${courseName})` : ""} · entrada`
      : regularTotal === 1
        ? `Matrícula — ${input.student.trim()}${courseName ? ` (${courseName})` : ""}`
        : `Matrícula — ${input.student.trim()}${courseName ? ` (${courseName})` : ""} · parcela ${installmentNumber}/${regularTotal}`;
    // Os valores já recebidos conservam também sua previsão de taxa original.
    // Para o saldo aberto, a taxa do contrato acompanha a nova parcela prevista.
    const feeAmount = previous.paidAmount > 0.005
      ? previous.feeAmount
      : round2((item.amount * contractRatePct) / 100);
    await client.query(
      `UPDATE ${SCHEMA}.finance_revenues
          SET date = $2, due_date = $3, description = $4, category_id = $5, origin = 'Matrícula parcelada',
              student = $6, course_id = $7, branch_id = $8, payment_method_id = $9, card_brand_id = $10,
              seller_id = $11, amount = $12, fee_amount = $13, installment_number = $14, updated_at = NOW()
        WHERE id = $1`,
      [
        previous.id,
        item.competence,
        item.dueDate,
        description,
        categoryId,
        input.student.trim(),
        input.courseId ?? null,
        input.branchId ?? null,
        item.paymentMethodId,
        item.cardBrandId,
        input.sellerId ?? null,
        item.amount,
        feeAmount,
        installmentNumber,
      ]
    );
  }
  await recomputeEnrollmentSchedule(client, enrollmentId);
}

/**
 * Atualiza a matrícula. Antes de qualquer recebimento, regera livremente o
 * cronograma. Depois, conserva as parcelas já recebidas e ajusta em linha
 * somente o saldo que continua em aberto.
 */
export async function updateEnrollment(id: number, input: EnrollmentInput): Promise<void> {
  await ensureFinanceSchema();
  if (!input.student?.trim()) throw new Error("Aluno é obrigatório.");
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw new Error("Valor do curso inválido.");
  if (!Number.isFinite(num(input.downPaymentAmount)) || num(input.downPaymentAmount) < 0 || num(input.downPaymentAmount) > input.totalAmount) {
    throw new Error("O valor da entrada deve estar entre zero e o valor total da matrícula.");
  }
  const requestedInstallments = normalizeEnrollmentInstallments(input.installments);
  const cardBrandId = input.cardBrandId ?? null;

  const schedule = resolveSchedule(input, requestedInstallments);
  assertScheduleMatchesTotal(schedule, input.totalAmount);
  // Com cronograma combinado, quem manda é ele: o número de parcelas do
  // contrato é o número de linhas acordadas, não o que veio no seletor.
  const installments = schedule.length;

  const pool = getPool();
  const { rows: methodRows } = input.paymentMethodId
    ? await pool.query(
        `SELECT name, kind, fee_pct, max_installments FROM ${SCHEMA}.finance_payment_methods WHERE id = $1`,
        [input.paymentMethodId]
      )
    : { rows: [] as Array<{ name: string; kind: string; fee_pct: number; max_installments: number | null }> };
  assertInstallmentsWithinMethodCap(methodRows[0], requestedInstallments);
  const hasCardInstallmentFee = methodRows[0]?.kind === "parcelado";
  const methodFeePct = num(methodRows[0]?.fee_pct);
  const ratePct = methodFeePct > 0
    ? methodFeePct
    : hasCardInstallmentFee
      ? await lookupInstallmentRatePct(pool, installments, cardBrandId)
      : 0;
  const categoryId = await findCategoryId("receita", "Matrícula");

  const { rows: courseRows } = input.courseId
    ? await pool.query(`SELECT name FROM ${SCHEMA}.finance_courses WHERE id = $1`, [input.courseId])
    : { rows: [] as Array<{ name: string }> };
  const courseName = courseRows[0]?.name ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: enrollmentRows } = await client.query(
      `SELECT * FROM ${SCHEMA}.finance_enrollments WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const currentEnrollment = enrollmentRows[0] as Record<string, unknown> | undefined;
    if (!currentEnrollment) throw new Error("Matrícula não encontrada.");
    // Unidade de negócio: quem informa manda (a venda do CRM manda a do curso
    // vendido), quem não informa conserva a que já estava. Normalizar
    // `undefined` aqui faria toda edição vinda da tela de Matrículas — que não
    // tem esse campo — devolver a matrícula do Instituto UP para a Voz UP.
    const enrollment = {
      ...input,
      businessUnit: input.businessUnit
        ? normalizeBusinessUnit(input.businessUnit)
        : normalizeBusinessUnit(currentEnrollment.business_unit),
    };
    const { rows: paymentRows } = await client.query(
      `SELECT COUNT(*)::int AS total FROM ${SCHEMA}.finance_enrollment_payments WHERE enrollment_id = $1`,
      [id]
    );
    if (Number(paymentRows[0]?.total ?? 0) > 0) {
      assertPaidEnrollmentContractIsStable(currentEnrollment, input, requestedInstallments, schedule);
      await updateOpenEnrollmentSchedule(client, id, enrollment, schedule, ratePct, courseName, categoryId);
      // Turma entra aqui junto com as observações de propósito: contrato com
      // pagamento tem o dinheiro congelado, mas trocar de horário é rotina e não
      // pode depender de o aluno ainda não ter pago nada.
      await client.query(
        `UPDATE ${SCHEMA}.finance_enrollments
            SET notes = $1,
                class_id = CASE WHEN $3::boolean THEN class_id ELSE $4 END
          WHERE id = $2`,
        [input.notes?.trim() || null, id, input.classId === undefined, input.classId ?? null]
      );
      await client.query("COMMIT");
      return;
    }
    const commissionPct = await resolveEnrollmentCommissionPct(client, input.sellerId, input.commissionPct);
    const { rowCount } = await client.query(
      `UPDATE ${SCHEMA}.finance_enrollments
         SET student = $1, course_id = $2, total_amount = $3, down_payment_amount = $4,
             regular_installments = $5, installments = $6, payment_method_id = $7,
             card_brand_id = $8, first_month = $9, sale_date = $10, seller_id = $11, branch_id = $12,
             rate_pct = $13, notes = $14, business_unit = $18,
             class_id = CASE WHEN $16::boolean THEN class_id ELSE $17 END
       WHERE id = $15`,
      [
        input.student.trim(),
        input.courseId ?? null,
        round2(input.totalAmount),
        round2(num(input.downPaymentAmount)),
        requestedInstallments,
        installments,
        input.paymentMethodId ?? null,
        cardBrandId,
        monthToDate(input.firstMonth),
        input.saleDate,
        input.sellerId ?? null,
        input.branchId ?? null,
        ratePct,
        input.notes?.trim() || null,
        id,
        input.classId === undefined,
        input.classId ?? null,
        enrollment.businessUnit,
      ]
    );
    if (!rowCount) throw new Error("Matrícula não encontrada.");

    await client.query(`DELETE FROM ${SCHEMA}.finance_revenues WHERE enrollment_id = $1`, [id]);

    await insertEnrollmentRevenues(client, id, enrollment, schedule, ratePct, courseName, categoryId);
    await syncEnrollmentCommission(client, enrollment, id, schedule, commissionPct);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapEnrollment(r: Record<string, unknown>): FinanceEnrollment {
  const total = num(r.total_amount);
  const feeTotal = num(r.fee_total);
  const paidAmount = num(r.paid_amount);
  const commissionPct = num(r.commission_pct);
  const commissionTotal = round2((total * commissionPct) / 100);
  return {
    id: Number(r.id),
    student: String(r.student ?? ""),
    courseId: r.course_id === null ? null : Number(r.course_id),
    courseName: (r.course_name as string) ?? null,
    classId: r.class_id === null || r.class_id === undefined ? null : Number(r.class_id),
    totalAmount: total,
    downPaymentAmount: num(r.down_payment_amount),
    regularInstallments: Math.max(1, Number(r.regular_installments ?? r.installments ?? 1)),
    installments: Number(r.installments),
    paymentMethodId: r.payment_method_id === null ? null : Number(r.payment_method_id),
    paymentMethodName: (r.payment_method_name as string) ?? null,
    cardBrandId: r.card_brand_id === null ? null : Number(r.card_brand_id),
    cardBrandName: (r.card_brand_name as string) ?? null,
    firstMonth: dateToMonth(r.first_month),
    saleDate: toIsoDate(r.sale_date) ?? "",
    sellerId: r.seller_id === null ? null : Number(r.seller_id),
    sellerName: (r.seller_name as string) ?? null,
    commissionPct,
    branchId: r.branch_id === null ? null : Number(r.branch_id),
    branchName: (r.branch_name as string) ?? null,
    ratePct: num(r.rate_pct),
    feeTotal,
    paidAmount,
    balanceRemaining: Math.max(0, round2(total - paidAmount)),
    paymentsFeeTotal: num(r.payments_fee_total),
    netReceived: num(r.net_received),
    paymentCount: Number(r.payment_count ?? 0),
    // Receita líquida da matrícula: valor bruto menos taxas de pagamento e comissão do vendedor.
    netTotal: round2(total - feeTotal - commissionTotal),
    notes: (r.notes as string) ?? null,
    invoiceStatus: (r.invoice_status as EnrollmentInvoiceStatus) ?? "pendente",
    invoiceNumber: (r.invoice_number as string) ?? null,
    invoiceIssuedAt: toIsoDate(r.invoice_issued_at),
    invoiceNotes: (r.invoice_notes as string) ?? null,
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
  };
}

const ENROLLMENT_SELECT = `
  SELECT e.*, co.name AS course_name, pm.name AS payment_method_name, s.name AS seller_name, b.name AS branch_name,
         cb.name AS card_brand_name,
         (e.invoice_file IS NOT NULL) AS has_invoice,
         COALESCE((SELECT percent FROM ${SCHEMA}.finance_commissions cm WHERE cm.enrollment_id = e.id LIMIT 1), 0) AS commission_pct,
         COALESCE((SELECT SUM(fee_amount) FROM ${SCHEMA}.finance_revenues r WHERE r.enrollment_id = e.id), 0) AS fee_total,
         COALESCE(pay.paid_amount, 0) AS paid_amount,
         COALESCE(pay.fee_total, 0) AS payments_fee_total,
         COALESCE(pay.net_received, 0) AS net_received,
         COALESCE(pay.payment_count, 0) AS payment_count
  FROM ${SCHEMA}.finance_enrollments e
  LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = e.course_id
  LEFT JOIN ${SCHEMA}.finance_payment_methods pm ON pm.id = e.payment_method_id
  LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
  LEFT JOIN ${SCHEMA}.finance_branches b ON b.id = e.branch_id
  LEFT JOIN ${SCHEMA}.finance_card_brands cb ON cb.id = e.card_brand_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS paid_amount,
           COALESCE(SUM(fee_amount), 0) AS fee_total,
           COALESCE(SUM(net_amount), 0) AS net_received,
           COUNT(*)::int AS payment_count
    FROM ${SCHEMA}.finance_enrollment_payments ep
    WHERE ep.enrollment_id = e.id
  ) pay ON TRUE
`;

export async function getEnrollmentById(id: number): Promise<FinanceEnrollment | null> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(`${ENROLLMENT_SELECT} WHERE e.id = $1`, [id]);
  return rows[0] ? mapEnrollment(rows[0]) : null;
}

/** Parcelas previstas da matrícula, ordenadas para leitura e vinculação dos recebimentos. */
export async function listEnrollmentRevenues(enrollmentId: number): Promise<FinanceRevenue[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `${REVENUE_SELECT} WHERE r.enrollment_id = $1 ORDER BY r.date ASC, r.installment_number ASC, r.id ASC`,
    [enrollmentId]
  );
  return rows.map(mapRevenue);
}

// ── Cobrança: as parcelas vistas pelo vencimento ──────────────────

export interface ReceivableFilters {
  /** Mês inicial (YYYY-MM) do vencimento. */
  from?: string;
  businessUnit?: FinanceBusinessUnit;
  /** Mês final (YYYY-MM) do vencimento, inclusive. */
  to?: string;
  sellerId?: number;
  courseId?: number;
  branchId?: number;
}

/**
 * Parcelas de matrícula que VENCEM no período — a lista da aba Cobrança.
 *
 * A aba Receitas recorta pela competência (`r.date`) porque responde "quanto
 * este mês faturou". Aqui a pergunta é outra: "o que eu tenho para receber e
 * cobrar neste mês", e quem manda nisso é o vencimento acordado. Numa venda
 * em 24x as duas datas caminham juntas, mas cronograma irregular (entrada
 * hoje, primeira parcela só no mês que vem) separa uma da outra.
 */
export async function listReceivables(filters: ReceivableFilters = {}): Promise<FinanceRevenue[]> {
  await ensureFinanceSchema();
  const conditions: string[] = ["r.enrollment_id IS NOT NULL", "r.status <> 'cancelado'"];
  const values: unknown[] = [];
  if (filters.from) {
    values.push(monthToDate(filters.from));
    conditions.push(`COALESCE(r.due_date, r.date) >= $${values.length}`);
  }
  if (filters.to) {
    values.push(monthToDate(addMonths(filters.to, 1)));
    conditions.push(`COALESCE(r.due_date, r.date) < $${values.length}`);
  }
  for (const [key, column] of [
    ["sellerId", "r.seller_id"],
    ["courseId", "r.course_id"],
    ["branchId", "r.branch_id"],
  ] as const) {
    const value = filters[key];
    if (value) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }
  if (filters.businessUnit) {
    values.push(filters.businessUnit);
    conditions.push(`r.business_unit = $${values.length}`);
  }
  const { rows } = await getPool().query(
    `${REVENUE_SELECT} WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(r.due_date, r.date) ASC, r.student ASC NULLS LAST, r.installment_number ASC, r.id ASC
     LIMIT 2000`,
    values
  );
  return rows.map(mapRevenue);
}

/**
 * Fila de inadimplência: parcela vencida com saldo em aberto, de qualquer mês.
 *
 * Ignora o filtro de período do topo pelo mesmo motivo da fila de NF — parcela
 * que venceu em março continua em aberto em agosto, e respeitar o mês
 * selecionado faria a cobrança sumir sozinha na virada do mês.
 */
export async function listOverdueReceivables(): Promise<FinanceRevenue[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `${REVENUE_SELECT}
      WHERE r.enrollment_id IS NOT NULL
        AND r.status <> 'cancelado'
        AND COALESCE(r.due_date, r.date) < CURRENT_DATE
        AND r.amount - ${ALLOCATED_PAID_SQL} > 0.005
      ORDER BY COALESCE(r.due_date, r.date) ASC, r.student ASC NULLS LAST, r.id ASC
      LIMIT 500`
  );
  return rows.map(mapRevenue);
}

/**
 * Situação de pagamento de cada matrícula: em dia, em atraso, quitada.
 *
 * Vive fora do recorte de período de propósito (mesma razão da fila de
 * inadimplência): parcela que venceu em março continua devida em agosto, e amarrar
 * isto ao mês selecionado faria o atraso sumir sozinho na virada do mês.
 *
 * O saldo de cada parcela sai das ALOCAÇÕES de pagamento, não do status gravado —
 * `status` só é reescrito quando alguém mexe naquela matrícula ou quando a varredura
 * roda, e quem simplesmente parou de pagar é justamente quem ninguém tocou.
 */
export async function listEnrollmentPaymentHealth(): Promise<EnrollmentPaymentHealth[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `WITH parcelas AS (
       SELECT r.enrollment_id,
              COALESCE(r.due_date, r.date) AS due,
              r.amount AS valor,
              COALESCE((
                SELECT SUM(epa.amount)
                  FROM ${SCHEMA}.finance_enrollment_payment_allocations epa
                 WHERE epa.revenue_id = r.id
              ), 0) AS alocado
         FROM ${SCHEMA}.finance_revenues r
        WHERE r.enrollment_id IS NOT NULL
          AND r.status <> 'cancelado'
     ),
     saldos AS (
       SELECT enrollment_id, due,
              GREATEST(valor - alocado, 0) AS saldo,
              -- Alocação acima do valor da parcela NÃO quita as seguintes: ela fica
              -- presa ali. Por isso o "aplicado" é limitado ao valor da parcela e o
              -- excesso volta como crédito do contrato.
              LEAST(alocado, valor) AS aplicado
         FROM parcelas
     ),
     agregado AS (
       SELECT enrollment_id,
              COUNT(*)::int AS schedule_count,
              COUNT(*) FILTER (WHERE saldo > 0.005 AND due < CURRENT_DATE)::int AS overdue_count,
              COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND due < CURRENT_DATE), 0) AS overdue_amount,
              COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005), 0) AS open_amount,
              COALESCE(SUM(aplicado), 0) AS applied_amount,
              MIN(due) FILTER (WHERE saldo > 0.005 AND due < CURRENT_DATE) AS oldest_due,
              MIN(due) FILTER (WHERE saldo > 0.005 AND due >= CURRENT_DATE) AS next_due,
              (array_agg(saldo ORDER BY due) FILTER (WHERE saldo > 0.005 AND due >= CURRENT_DATE))[1] AS next_amount
         FROM saldos
        GROUP BY enrollment_id
     ),
     recebido AS (
       SELECT enrollment_id, COALESCE(SUM(amount), 0) AS paid
         FROM ${SCHEMA}.finance_enrollment_payments
        GROUP BY enrollment_id
     )
     SELECT a.*, COALESCE(p.paid, 0) AS paid_amount
       FROM agregado a
       LEFT JOIN recebido p ON p.enrollment_id = a.enrollment_id`
  );

  const today = new Date(new Date().toISOString().slice(0, 10));
  return rows.map((row) => {
    const overdueCount = Number(row.overdue_count) || 0;
    const overdueAmount = num(row.overdue_amount);
    const openAmount = num(row.open_amount);
    const scheduleCount = Number(row.schedule_count) || 0;
    const oldestDueDate = toIsoDate(row.oldest_due);
    // Dinheiro que entrou no contrato e não está fazendo efeito em parcela nenhuma:
    // pagamento lançado sem selecionar parcela, ou rateio antigo preso na primeira.
    // Sem descontar isto, a tela acusa de caloteiro quem já pagou — a armadilha
    // "aluno aparece em atraso mas jurou que pagou" do guia técnico. É conciliação
    // pendente, não inadimplência, e as duas não podem virar o mesmo aviso.
    const creditAmount = Math.max(0, round2(num(row.paid_amount) - num(row.applied_amount)));
    // A classificação em si vive em lib/receivables.ts (pura e testada): é a mesma
    // pergunta que a aba Cobrança responde, e duas implementações de "atrasado" já
    // produziram telas discordando entre si.
    const { status, uncoveredAmount } = classifyPaymentHealth({
      scheduleCount,
      openAmount,
      overdueCount,
      overdueAmount,
      creditAmount,
    });

    return {
      enrollmentId: Number(row.enrollment_id),
      status,
      overdueAmount,
      uncoveredAmount,
      creditAmount,
      overdueCount,
      oldestDueDate,
      daysLate: oldestDueDate
        ? Math.max(0, Math.round((today.getTime() - new Date(oldestDueDate).getTime()) / 86400000))
        : 0,
      nextDueDate: toIsoDate(row.next_due),
      nextAmount: num(row.next_amount),
      openAmount,
      scheduleCount,
    };
  });
}

export interface OverdueSweepRow {
  revenueId: number;
  enrollmentId: number;
  student: string | null;
  dueDate: string;
  balance: number;
}

/**
 * Marca como `atrasado` toda parcela vencida que ainda tem saldo.
 *
 * Até isto existir, o status gravado só era refeito por `recomputeEnrollmentSchedule`,
 * ou seja, quando alguém lançava um pagamento naquela matrícula — quem parou de
 * pagar nunca era recalculado, justamente o caso que interessa. A tela sempre
 * calculou o atraso na hora (`receivableStatus`) e por isso parecia certa; o
 * banco é que ficava para trás, e com ele qualquer relatório ou alerta.
 *
 * Devolve só as parcelas que MUDARAM de status nesta passada, para o alerta
 * avisar uma vez e não repetir a mesma dívida todo dia.
 */
export async function markOverdueRevenues(): Promise<OverdueSweepRow[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `UPDATE ${SCHEMA}.finance_revenues r
        SET status = 'atrasado', updated_at = NOW()
      WHERE r.enrollment_id IS NOT NULL
        AND r.status IN ('previsto', 'parcial')
        AND COALESCE(r.due_date, r.date) < CURRENT_DATE
        AND r.amount - COALESCE((
              SELECT SUM(epa.amount)
                FROM ${SCHEMA}.finance_enrollment_payment_allocations epa
               WHERE epa.revenue_id = r.id
            ), 0) > 0.005
      RETURNING r.id,
                r.enrollment_id,
                r.student,
                COALESCE(r.due_date, r.date) AS due_date,
                r.amount - COALESCE((
                  SELECT SUM(epa.amount)
                    FROM ${SCHEMA}.finance_enrollment_payment_allocations epa
                   WHERE epa.revenue_id = r.id
                ), 0) AS balance`
  );
  return rows.map((row) => ({
    revenueId: Number(row.id),
    enrollmentId: Number(row.enrollment_id),
    student: (row.student as string) ?? null,
    dueDate: toIsoDate(row.due_date) ?? "",
    balance: num(row.balance),
  }));
}

// ── Nota fiscal da matrícula ─────────────────────────────────────

/**
 * Controle manual de emissão da NF da matrícula.
 *
 * A emissão acontece fora do CRM (portal da prefeitura / contador); aqui só se
 * registra o que foi emitido. Por isso NÃO passa por `updateEnrollment`, que
 * regenera as parcelas do zero e se recusa a rodar quando já existe pagamento
 * lançado — justamente a matrícula que mais precisa de nota.
 */
export interface EnrollmentInvoiceInput {
  status: EnrollmentInvoiceStatus;
  number?: string | null;
  issuedAt?: string | null;
  notes?: string | null;
}

const ENROLLMENT_INVOICE_STATUSES: EnrollmentInvoiceStatus[] = ["pendente", "emitida", "dispensada"];

export interface NormalizedEnrollmentInvoice {
  status: EnrollmentInvoiceStatus;
  number: string | null;
  /** Null numa nota emitida significa "use a data de hoje", resolvida no UPDATE. */
  issuedAt: string | null;
  notes: string | null;
}

/**
 * Regras de preenchimento do controle de NF, separadas do UPDATE para poderem
 * ser testadas sem banco. Número e data só sobrevivem no status `emitida` — se
 * ficassem gravados numa matrícula que voltou para pendente, a fila mostraria
 * uma pendência que já exibe número de nota.
 */
export function normalizeEnrollmentInvoiceInput(input: EnrollmentInvoiceInput): NormalizedEnrollmentInvoice {
  const status = input.status;
  if (!ENROLLMENT_INVOICE_STATUSES.includes(status)) {
    throw new Error("Status de nota fiscal inválido.");
  }

  const notes = input.notes?.trim() || null;
  const number = input.number?.trim() || null;
  const issuedAt = input.issuedAt?.trim() || null;

  if (status === "emitida") {
    if (!number) throw new Error("Informe o número da nota fiscal emitida.");
    if (issuedAt && !/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) {
      throw new Error("Data de emissão inválida.");
    }
    return { status, number, issuedAt, notes };
  }

  // Dispensa sem motivo é o caminho fácil para zerar a fila sem resolver nada.
  if (status === "dispensada" && !notes) {
    throw new Error("Explique por que esta matrícula não gera nota fiscal.");
  }

  return { status, number: null, issuedAt: null, notes };
}

export async function updateEnrollmentInvoice(id: number, input: EnrollmentInvoiceInput): Promise<void> {
  await ensureFinanceSchema();
  const { status, number, issuedAt, notes } = normalizeEnrollmentInvoiceInput(input);

  // Data em branco numa nota emitida vale hoje, e quem decide "hoje" é o banco
  // (mesmo fuso do resto do módulo) — o que não pode é a linha ficar "emitida"
  // sem data nenhuma na hora de conferir com o contador.
  const { rowCount } = await getPool().query(
    `UPDATE ${SCHEMA}.finance_enrollments
       SET invoice_status = $2,
           invoice_number = $3,
           invoice_issued_at = CASE WHEN $2 = 'emitida' THEN COALESCE($4::date, CURRENT_DATE) ELSE NULL END,
           invoice_notes = $5
     WHERE id = $1`,
    [id, status, number, issuedAt, notes]
  );
  if (!rowCount) throw new Error("Matrícula não encontrada.");
}

export async function saveEnrollmentInvoice(
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  return saveFinanceInvoice("finance_enrollments", id, file);
}

export async function getEnrollmentInvoice(id: number) {
  return getFinanceInvoice("finance_enrollments", id);
}

/**
 * Fila de cobrança: matrículas com dinheiro já recebido e NF ainda pendente.
 *
 * Ignora de propósito o filtro de período da tela — uma venda de março com nota
 * pendente continua devendo nota em agosto, e some da cobrança se a consulta
 * respeitar o mês selecionado. A obrigação nasce do primeiro pagamento, não da
 * data da venda, então é dele que sai a contagem de dias.
 */
export async function listPendingInvoiceEnrollments(): Promise<PendingInvoiceEnrollment[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT e.id, e.student, e.total_amount, e.sale_date,
            co.name AS course_name, s.name AS seller_name,
            e.invoice_notes, e.invoice_filename, (e.invoice_file IS NOT NULL) AS has_invoice,
            pay.paid_amount, pay.first_payment_date,
            GREATEST(0, (CURRENT_DATE - pay.first_payment_date))::int AS days_waiting
     FROM ${SCHEMA}.finance_enrollments e
     LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = e.course_id
     LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
     JOIN LATERAL (
       SELECT COALESCE(SUM(ep.amount), 0) AS paid_amount, MIN(ep.payment_date) AS first_payment_date
       FROM ${SCHEMA}.finance_enrollment_payments ep
       WHERE ep.enrollment_id = e.id
       HAVING COALESCE(SUM(ep.amount), 0) > 0
     ) pay ON TRUE
     WHERE e.invoice_status = 'pendente'
     ORDER BY pay.first_payment_date ASC, e.id ASC`
  );

  return rows.map((r) => ({
    id: Number(r.id),
    student: String(r.student ?? ""),
    courseName: (r.course_name as string) ?? null,
    sellerName: (r.seller_name as string) ?? null,
    totalAmount: num(r.total_amount),
    paidAmount: num(r.paid_amount),
    saleDate: toIsoDate(r.sale_date) ?? "",
    firstPaymentDate: toIsoDate(r.first_payment_date) ?? "",
    daysWaiting: Number(r.days_waiting ?? 0),
    invoiceNotes: (r.invoice_notes as string) ?? null,
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
  }));
}

// ── Agenda financeira ────────────────────────────────────────────

type AgendaRecurrence = "once" | "weekly";

function normalizeAgendaDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("Data inicial da turma inválida.");
  }
  return value;
}

function addMonthsToAgendaDate(date: string, months: number): string {
  const [year, month, day] = date.split("-").map((value) => Number.parseInt(value, 10));
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function addAgendaDays(date: string, days: number): string[] {
  const start = new Date(`${date}T00:00:00Z`);
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const current = new Date(start);
    current.setUTCDate(current.getUTCDate() + index);
    return current.toISOString().slice(0, 10);
  });
}

function buildAgendaSessionDates(
  startsAt: string,
  daysPerMeeting: number,
  recurrence: AgendaRecurrence,
  durationMonths: number
): string[] {
  if (recurrence === "once") return addAgendaDays(startsAt, daysPerMeeting);
  const endExclusive = addMonthsToAgendaDate(startsAt, durationMonths);
  const dates: string[] = [];
  for (let meeting = startsAt; meeting < endExclusive;) {
    for (const date of addAgendaDays(meeting, daysPerMeeting)) {
      if (date < endExclusive) dates.push(date);
    }
    const next = new Date(`${meeting}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    meeting = next.toISOString().slice(0, 10);
  }
  return dates;
}

/**
 * Reaproveita as turmas já cadastradas no calendário operacional. A capacidade
 * fica no módulo financeiro apenas como complemento, sem duplicar inscrições
 * ou criar uma segunda fonte de verdade para as turmas.
 */
export async function listFinanceAgenda(): Promise<FinanceAgendaClass[]> {
  await ensureFinanceSchema();
  const [trainings, capacityResult, scheduleResult] = await Promise.all([
    listTrainingsWithStats(),
    getPool().query(`SELECT id, training_id, capacity FROM ${SCHEMA}.finance_training_capacities`),
    getPool().query(`SELECT id, training_id, label, product, days_per_meeting, starts_at, recurrence, duration_months FROM ${SCHEMA}.finance_training_schedules`),
  ]);
  const capacities = new Map<string, { id: number; capacity: number }>();
  for (const row of capacityResult.rows) {
    capacities.set(String(row.training_id), { id: Number(row.id), capacity: num(row.capacity) });
  }
  const schedules = new Map<string, { id: number; label: string | null; product: "online" | "up-day-plus" | "curso-oratoria" | null; daysPerMeeting: number; startsAt: string; recurrence: AgendaRecurrence; durationMonths: number }>();
  for (const row of scheduleResult.rows) {
    const startsAt = toIsoDate(row.starts_at);
    if (!startsAt) continue;
    schedules.set(String(row.training_id), {
      id: Number(row.id),
      label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : null,
      product: row.product === "online" || row.product === "up-day-plus" || row.product === "curso-oratoria" ? row.product : null,
      daysPerMeeting: Math.max(1, Math.min(7, Math.trunc(num(row.days_per_meeting) || 1))),
      startsAt,
      recurrence: row.recurrence === "weekly" ? "weekly" : "once",
      durationMonths: Math.max(1, Math.min(24, Math.trunc(num(row.duration_months) || 1))),
    });
  }

  const fromOperationalTrainings = trainings
    .map((training) => {
      const configuredSchedule = schedules.get(training.id) ?? null;
      const startsAt = configuredSchedule?.startsAt ?? toIsoDate(training.startsAt);
      if (!startsAt) return null;
      const capacity = capacities.get(training.id) ?? null;
      const enrolledCount = Math.max(0, Number(training.totalInscritos) || 0);
      const seatsAvailable = capacity ? Math.max(0, capacity.capacity - enrolledCount) : null;
      const days = configuredSchedule?.daysPerMeeting ?? Math.max(1, Math.trunc(training.days || 1));
      const recurrence = configuredSchedule?.recurrence ?? "once";
      const durationMonths = configuredSchedule?.durationMonths ?? 1;
      return {
        trainingId: training.id,
        label: training.label,
        startsAt,
        days,
        sessionDates: buildAgendaSessionDates(startsAt, days, recurrence, durationMonths),
        recurrence,
        durationMonths,
        scheduleId: configuredSchedule?.id ?? null,
        isManual: configuredSchedule?.label !== null && configuredSchedule?.label !== undefined && !training.id.startsWith("agenda:"),
        product: configuredSchedule?.product ?? training.product,
        enrolledCount,
        capacityId: capacity?.id ?? null,
        capacity: capacity?.capacity ?? null,
        seatsAvailable,
        isFull: capacity ? enrolledCount >= capacity.capacity : false,
      } satisfies FinanceAgendaClass;
    })
    .filter((training): training is FinanceAgendaClass => training !== null);
  const existingTrainingIds = new Set(trainings.map((training) => training.id));
  const manualClasses = Array.from(schedules.entries())
    .filter(([trainingId, schedule]) => !existingTrainingIds.has(trainingId) && schedule.label)
    .map(([trainingId, schedule]) => {
      const capacity = capacities.get(trainingId) ?? null;
      const seatsAvailable = capacity ? capacity.capacity : null;
      return {
        trainingId,
        label: schedule.label!,
        startsAt: schedule.startsAt,
        days: schedule.daysPerMeeting,
        sessionDates: buildAgendaSessionDates(schedule.startsAt, schedule.daysPerMeeting, schedule.recurrence, schedule.durationMonths),
        recurrence: schedule.recurrence,
        durationMonths: schedule.durationMonths,
        scheduleId: schedule.id,
        isManual: true,
        product: schedule.product,
        enrolledCount: 0,
        capacityId: capacity?.id ?? null,
        capacity: capacity?.capacity ?? null,
        seatsAvailable,
        isFull: false,
      } satisfies FinanceAgendaClass;
    });
  return [...fromOperationalTrainings, ...manualClasses]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.label.localeCompare(b.label));
}

export async function upsertFinanceAgendaCapacity(trainingId: string, capacity: number): Promise<number> {
  await ensureFinanceSchema();
  const normalizedTrainingId = trainingId.trim();
  const normalizedCapacity = Math.trunc(capacity);
  if (!normalizedTrainingId) throw new Error("Turma inválida.");
  if (!Number.isFinite(normalizedCapacity) || normalizedCapacity <= 0) {
    throw new Error("A capacidade deve ser maior que zero.");
  }
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_training_capacities (training_id, capacity, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (training_id) DO UPDATE SET capacity = EXCLUDED.capacity, updated_at = NOW()
     RETURNING id`,
    [normalizedTrainingId, normalizedCapacity]
  );
  return Number(rows[0].id);
}

export async function getFinanceAgendaCapacityId(trainingId: string): Promise<number | null> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT id FROM ${SCHEMA}.finance_training_capacities WHERE training_id = $1`,
    [trainingId.trim()]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export interface FinanceAgendaScheduleInput {
  startsAt: string;
  recurrence: AgendaRecurrence;
  durationMonths: number;
}

export interface FinanceAgendaClassInput extends FinanceAgendaScheduleInput {
  label: string;
  trainingId?: string | null;
  product?: "online" | "up-day-plus" | "curso-oratoria" | null;
  daysPerMeeting?: number;
  capacity: number;
}

/** Cria uma turma diretamente pela Agenda, sem depender do catálogo financeiro. */
export async function createFinanceAgendaClass(input: FinanceAgendaClassInput): Promise<{ trainingId: string; scheduleId: number }> {
  await ensureFinanceSchema();
  const label = input.label.trim();
  if (!label) throw new Error("Nome da turma é obrigatório.");
  const requestedTrainingId = input.trainingId?.trim();
  const trainingId = requestedTrainingId || `agenda:${randomUUID()}`;
  const startsAt = normalizeAgendaDate(input.startsAt);
  const recurrence: AgendaRecurrence = input.recurrence === "weekly" ? "weekly" : "once";
  const durationMonths = Math.trunc(input.durationMonths);
  const daysPerMeeting = Math.trunc(input.daysPerMeeting ?? 1);
  const capacity = Math.trunc(input.capacity);
  if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 24) throw new Error("A duração deve ficar entre 1 e 24 meses.");
  if (!Number.isFinite(daysPerMeeting) || daysPerMeeting < 1 || daysPerMeeting > 7) throw new Error("Informe de 1 a 7 dias por encontro.");
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error("A capacidade deve ser maior que zero.");
  const product = input.product === "online" || input.product === "up-day-plus" || input.product === "curso-oratoria" ? input.product : null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      `SELECT id FROM ${SCHEMA}.finance_training_schedules WHERE training_id = $1 FOR UPDATE`,
      [trainingId]
    );
    if (existing[0]) throw new Error("Já existe uma turma com este código. Use outro código ou edite a turma existente.");
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_training_schedules
         (training_id, label, product, days_per_meeting, starts_at, recurrence, duration_months, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [trainingId, label, product, daysPerMeeting, startsAt, recurrence, durationMonths]
    );
    await client.query(
      `INSERT INTO ${SCHEMA}.finance_training_capacities (training_id, capacity, updated_at)
       VALUES ($1, $2, NOW())`,
      [trainingId, capacity]
    );
    await client.query("COMMIT");
    return { trainingId, scheduleId: Number(rows[0].id) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Remove apenas turmas criadas manualmente na Agenda e sua capacidade associada. */
export async function deleteFinanceAgendaClass(trainingId: string): Promise<void> {
  await ensureFinanceSchema();
  const normalizedTrainingId = trainingId.trim();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, label FROM ${SCHEMA}.finance_training_schedules WHERE training_id = $1 FOR UPDATE`,
      [normalizedTrainingId]
    );
    const schedule = rows[0];
    if (!schedule?.label) throw new Error("Só é possível excluir turmas criadas diretamente na Agenda.");
    await client.query(`DELETE FROM ${SCHEMA}.finance_training_capacities WHERE training_id = $1`, [normalizedTrainingId]);
    await client.query(`DELETE FROM ${SCHEMA}.finance_training_schedules WHERE id = $1`, [Number(schedule.id)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getFinanceAgendaScheduleId(trainingId: string): Promise<number | null> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT id FROM ${SCHEMA}.finance_training_schedules WHERE training_id = $1`,
    [trainingId.trim()]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function upsertFinanceAgendaSchedule(
  trainingId: string,
  input: FinanceAgendaScheduleInput
): Promise<number> {
  await ensureFinanceSchema();
  const normalizedTrainingId = trainingId.trim();
  if (!normalizedTrainingId) throw new Error("Turma inválida.");
  const startsAt = normalizeAgendaDate(input.startsAt);
  const recurrence: AgendaRecurrence = input.recurrence === "weekly" ? "weekly" : "once";
  const durationMonths = Math.trunc(input.durationMonths);
  if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 24) {
    throw new Error("A duração deve ficar entre 1 e 24 meses.");
  }
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_training_schedules (training_id, starts_at, recurrence, duration_months, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (training_id) DO UPDATE
       SET starts_at = EXCLUDED.starts_at, recurrence = EXCLUDED.recurrence,
           duration_months = EXCLUDED.duration_months, updated_at = NOW()
     RETURNING id`,
    [normalizedTrainingId, startsAt, recurrence, durationMonths]
  );
  return Number(rows[0].id);
}

function agendaParticipantEmail(payload: Record<string, unknown>): string | null {
  const direct = payload.email;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = payload.dados_extras ?? payload.dadosExtras;
  if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).email === "string") {
    return String((nested as Record<string, unknown>).email).trim() || null;
  }
  return null;
}

export async function listFinanceAgendaParticipants(trainingId: string): Promise<FinanceAgendaParticipant[]> {
  const normalizedTrainingId = trainingId.trim();
  if (!normalizedTrainingId) throw new Error("Turma inválida.");
  const options = {
    pageSize: 500,
    orderBy: "nome" as const,
    orderDirection: "asc" as const,
    filters: { treinamento: normalizedTrainingId },
  };
  const firstPage = await listInscricoes({
    page: 1,
    ...options,
  });
  const totalPages = Math.ceil(firstPage.total / options.pageSize);
  const remainingPages = totalPages > 1
    ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => listInscricoes({ page: index + 2, ...options })))
    : [];
  return [firstPage, ...remainingPages].flatMap((result) => result.data).map((item) => ({
    id: item.id,
    name: item.nome,
    phone: item.telefone,
    email: agendaParticipantEmail(item.payload),
    city: item.cidade,
    profession: item.profissao,
    role: item.tipo === "recrutador" ? "recrutador" : item.tipo === "lead" ? "lead" : null,
    status: item.status ?? null,
    recruiterName: item.recrutadorNome,
    enrolledAt: item.criadoEm,
    attendanceValidated: Boolean(item.presencaValidada),
    attendanceApproved: Boolean(item.presencaAprovada),
  }));
}

export async function listEnrollments(filters: FinanceFilters = {}): Promise<FinanceEnrollment[]> {
  await ensureFinanceSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.from) {
    values.push(monthToDate(filters.from));
    conditions.push(`e.sale_date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(monthToDate(addMonths(filters.to, 1)));
    conditions.push(`e.sale_date < $${values.length}`);
  }
  if (filters.sellerId) {
    values.push(filters.sellerId);
    conditions.push(`e.seller_id = $${values.length}`);
  }
  if (filters.courseId) {
    values.push(filters.courseId);
    conditions.push(`e.course_id = $${values.length}`);
  }
  // O filtro de unidade do topo do Financeiro já recortava receita, despesa e
  // comissão, mas passava batido aqui: a carteira de matrículas mostrava a
  // venda das duas empresas junto mesmo com uma delas selecionada.
  if (filters.businessUnit) {
    values.push(filters.businessUnit);
    conditions.push(`e.business_unit = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `${ENROLLMENT_SELECT} ${where} ORDER BY e.sale_date DESC, e.id DESC LIMIT 1000`,
    values
  );
  return rows.map(mapEnrollment);
}

export async function deleteEnrollment(id: number): Promise<void> {
  await ensureFinanceSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // A FK da comissão usa SET NULL para preservar comissões manuais; as comissões
    // automáticas da matrícula precisam ser removidas junto com a venda.
    await client.query(`DELETE FROM ${SCHEMA}.finance_commissions WHERE enrollment_id = $1`, [id]);
    // Receitas geradas caem junto (FK ON DELETE CASCADE).
    await client.query(`DELETE FROM ${SCHEMA}.finance_enrollments WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Pagamentos flexíveis de matrículas ────────────────────────────

/**
 * Diferente das parcelas previstas no cadastro, cada linha abaixo representa
 * dinheiro efetivamente recebido. Isso permite combinar datas, valores e
 * formas de pagamento sem alterar o valor contratado da matrícula.
 */
export interface EnrollmentPaymentInput {
  amount: number;
  paymentDate: string;
  paymentMethod: RevenuePaymentMethod;
  installments?: number | null;
  cardBrandId?: number | null;
  /** Parcelas que este recebimento quita; quando vazio, usa a do mês do pagamento. */
  revenueIds?: number[] | null;
  /**
   * Pagando menos que o saldo das parcelas marcadas, quita todas elas e joga a
   * diferença nas parcelas ainda em aberto. Desligado, vale o rateio em
   * cascata puro e a última selecionada fica parcial.
   */
  redistributeShortfall?: boolean;
  /** Compatibilidade com clientes antigos que ainda enviam uma única parcela. */
  revenueId?: number | null;
  notes?: string | null;
  asaasPaymentUrl?: string | null;
  createdByUserId?: number | null;
  createdByName?: string | null;
}

function mapEnrollmentPayment(r: Record<string, unknown>): EnrollmentPayment {
  const allocations = Array.isArray(r.allocations) ? r.allocations as Array<Record<string, unknown>> : [];
  return {
    id: Number(r.id),
    enrollmentId: Number(r.enrollment_id),
    revenueId: r.revenue_id === null || r.revenue_id === undefined ? null : Number(r.revenue_id),
    revenueDescription: (r.revenue_description as string) ?? null,
    revenueDate: toIsoDate(r.revenue_date),
    installmentNumber: r.installment_number === null || r.installment_number === undefined ? null : Number(r.installment_number),
    allocations: allocations.map((allocation) => ({
      revenueId: Number(allocation.revenueId),
      revenueDate: String(allocation.revenueDate ?? ""),
      installmentNumber: allocation.installmentNumber === null || allocation.installmentNumber === undefined
        ? null
        : Number(allocation.installmentNumber),
      amount: num(allocation.amount),
    })),
    scheduleShift: parseScheduleShift(r.schedule_shift),
    amount: num(r.amount),
    paymentDate: toIsoDate(r.payment_date) ?? "",
    paymentMethod: r.payment_method as RevenuePaymentMethod,
    installments: r.installments === null || r.installments === undefined ? null : Number(r.installments),
    cardBrandId: r.card_brand_id === null || r.card_brand_id === undefined ? null : Number(r.card_brand_id),
    cardBrandName: (r.card_brand_name as string) ?? null,
    feePct: r.fee_pct === null || r.fee_pct === undefined ? null : num(r.fee_pct),
    feeAmount: num(r.fee_amount),
    netAmount: num(r.net_amount),
    notes: (r.notes as string) ?? null,
    asaasPaymentUrl: (r.asaas_payment_url as string) ?? null,
    commissionPct: num(r.commission_pct),
    commissionAmount: num(r.commission_amount),
    commissionStatus: r.commission_status === "paga" ? "paga" : "disponivel",
    commissionPaidAt: toIsoDate(r.commission_paid_at),
    createdByUserId: r.created_by_user_id === null || r.created_by_user_id === undefined ? null : Number(r.created_by_user_id),
    createdByName: (r.created_by_name as string) ?? null,
    createdAt: toIsoDate(r.created_at) ?? "",
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
  };
}

const ENROLLMENT_PAYMENT_SELECT = `
  SELECT ep.*, (ep.invoice_file IS NOT NULL) AS has_invoice, cb.name AS card_brand_name,
         r.description AS revenue_description, r.date AS revenue_date, r.installment_number,
         COALESCE((
           SELECT JSON_AGG(JSON_BUILD_OBJECT(
             'revenueId', allocation.revenue_id,
             'revenueDate', revenue.date::text,
             'installmentNumber', revenue.installment_number,
             'amount', allocation.amount
           ) ORDER BY revenue.date, revenue.installment_number, allocation.revenue_id)
           FROM ${SCHEMA}.finance_enrollment_payment_allocations allocation
           JOIN ${SCHEMA}.finance_revenues revenue ON revenue.id = allocation.revenue_id
           WHERE allocation.payment_id = ep.id
         ), '[]'::json) AS allocations
  FROM ${SCHEMA}.finance_enrollment_payments ep
  LEFT JOIN ${SCHEMA}.finance_card_brands cb ON cb.id = ep.card_brand_id
  LEFT JOIN ${SCHEMA}.finance_revenues r ON r.id = ep.revenue_id
`;

function validatePaymentDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("Data do pagamento inválida.");
  }
}

async function lockEnrollmentAndGetBalance(
  client: PoolClient,
  enrollmentId: number,
  excludingPaymentId?: number
): Promise<{ total: number; paid: number; balance: number; ratePct: number }> {
  const { rows: enrollmentRows } = await client.query(
    `SELECT total_amount, rate_pct FROM ${SCHEMA}.finance_enrollments WHERE id = $1 FOR UPDATE`,
    [enrollmentId]
  );
  if (!enrollmentRows[0]) throw new Error("Matrícula não encontrada.");

  const values: unknown[] = [enrollmentId];
  const excludingSql = excludingPaymentId ? ` AND id <> $2` : "";
  if (excludingPaymentId) values.push(excludingPaymentId);
  const { rows: totalRows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM ${SCHEMA}.finance_enrollment_payments
     WHERE enrollment_id = $1${excludingSql}`,
    values
  );
  const total = round2(num(enrollmentRows[0].total_amount));
  const paid = round2(num(totalRows[0]?.paid));
  return {
    total,
    paid,
    balance: Math.max(0, round2(total - paid)),
    ratePct: num(enrollmentRows[0].rate_pct),
  };
}

function assertPaymentFitsBalance(amount: number, balance: number): void {
  if (amount > balance + 0.0001) {
    throw new Error(`O pagamento excede o saldo restante da matrícula (R$ ${balance.toFixed(2)}).`);
  }
}

function normalizeAsaasPaymentUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("Link da Asaas inválido.");
  }
}

/**
 * Resolve e rateia um recebimento entre parcelas. Sem seleção explícita, usa
 * a primeira parcela prevista no mês da data do pagamento, preservando o
 * comportamento anterior. Com duas ou mais parcelas selecionadas, distribui
 * pela ordem de vencimento até quitar o valor informado.
 */
async function resolveEnrollmentPaymentAllocations(
  client: PoolClient,
  enrollmentId: number,
  revenueIds: number[] | null | undefined,
  legacyRevenueId: number | null | undefined,
  paymentDate: string,
  amount: number,
  excludingPaymentId?: number
): Promise<{ requested: number[]; allocations: Array<{ revenueId: number; amount: number }> }> {
  const requested = Array.from(
    new Set(
      (revenueIds?.length ? revenueIds : legacyRevenueId ? [legacyRevenueId] : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (requested.length === 0) {
    const { rows } = await client.query(
      `SELECT id FROM ${SCHEMA}.finance_revenues
       WHERE enrollment_id = $1 AND date = $2::date
       ORDER BY installment_number, id LIMIT 1 FOR UPDATE`,
      [enrollmentId, monthToDate(paymentDate.slice(0, 7))]
    );
    if (!rows[0]) {
      throw new Error("Não há parcela prevista para o mês da data do pagamento. Selecione as parcelas que serão quitadas.");
    }
    requested.push(Number(rows[0].id));
  }

  const allocationValues: unknown[] = [requested, enrollmentId];
  const excludingSql = excludingPaymentId ? " AND payment_id <> $3" : "";
  if (excludingPaymentId) allocationValues.push(excludingPaymentId);
  const { rows } = await client.query(
    `SELECT r.id, r.enrollment_id, r.status, r.amount, r.date, r.installment_number,
            COALESCE((
              SELECT SUM(amount) FROM ${SCHEMA}.finance_enrollment_payment_allocations
               WHERE revenue_id = r.id${excludingSql}
            ), 0) AS allocated_amount
       FROM ${SCHEMA}.finance_revenues r
      WHERE r.id = ANY($1::bigint[]) AND r.enrollment_id = $2
      ORDER BY r.date, r.installment_number, r.id
      FOR UPDATE`,
    allocationValues
  );
  if (rows.length !== requested.length) {
    throw new Error("Uma das parcelas selecionadas não pertence a esta matrícula.");
  }
  let remainingPayment = round2(amount);
  const allocations: Array<{ revenueId: number; amount: number }> = [];
  for (const revenue of rows) {
    if (revenue.status === "cancelado") throw new Error("Não é possível lançar pagamento em uma parcela cancelada.");
    const available = Math.max(0, round2(num(revenue.amount) - num(revenue.allocated_amount)));
    if (available <= 0) continue;
    const allocated = Math.min(available, remainingPayment);
    if (allocated > 0) {
      allocations.push({ revenueId: Number(revenue.id), amount: round2(allocated) });
      remainingPayment = round2(remainingPayment - allocated);
    }
  }
  if (remainingPayment > 0.0001) {
    throw new Error("O valor informado é maior que o saldo das parcelas selecionadas.");
  }
  if (allocations.length === 0) throw new Error("As parcelas selecionadas já estão quitadas.");
  return { requested, allocations };
}

// ── Remanejamento do saldo das parcelas selecionadas ──────────────

/** Linha do cronograma como o remanejamento a enxerga, em ordem cronológica. */
export interface EnrollmentScheduleLine {
  revenueId: number;
  amount: number;
  /** Soma de TODOS os rateios gravados para esta parcela, deste e de outros pagamentos. */
  allocated: number;
  /** A parcela foi marcada no recebimento que está sendo lançado. */
  selected: boolean;
  cancelled: boolean;
  /** Entrada é 0; ela não absorve diferença porque é um fato passado do contrato. */
  installmentNumber: number | null;
}

/** Valor de uma parcela antes e depois do remanejamento, para poder desfazer. */
export interface ScheduleShiftEntry {
  revenueId: number;
  before: number;
  after: number;
}

/**
 * Quando o recebimento é menor que o saldo das parcelas selecionadas, cada uma
 * delas fica quitada pelo que efetivamente recebeu e a diferença é remanejada,
 * em partes iguais, para as parcelas ainda intocadas. O valor do contrato não
 * muda — é adiamento de dívida, não desconto.
 *
 * Devolve lista vazia (mantendo o rateio em cascata, que deixa a última
 * selecionada parcial) em duas situações:
 * - não sobrou parcela em aberto para absorver a diferença;
 * - a parcela selecionada não recebeu um centavo — quitá-la seria fabricar
 *   quitação, então ela continua aberta pelo valor cheio.
 */
export function planShortfallRedistribution(lines: EnrollmentScheduleLine[]): ScheduleShiftEntry[] {
  const settled = lines.filter(
    (line) => line.selected && !line.cancelled && line.allocated > 0.005 && line.amount - line.allocated > 0.005
  );
  const shortfall = round2(settled.reduce((total, line) => total + (line.amount - line.allocated), 0));
  if (shortfall <= 0.005) return [];

  const absorbers = lines.filter(
    (line) => !line.selected && !line.cancelled && line.allocated <= 0.005 && (line.installmentNumber ?? 0) > 0
  );
  if (absorbers.length === 0) return [];

  const shares = splitInstallments(
    round2(absorbers.reduce((total, line) => total + line.amount, 0) + shortfall),
    absorbers.length
  );
  return [
    ...settled.map((line) => ({ revenueId: line.revenueId, before: round2(line.amount), after: round2(line.allocated) })),
    ...absorbers.map((line, index) => ({ revenueId: line.revenueId, before: round2(line.amount), after: shares[index] })),
  ].filter((entry) => Math.abs(entry.before - entry.after) > 0.005);
}

function parseScheduleShift(value: unknown): ScheduleShiftEntry[] {
  const raw = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item && Number.isInteger(Number(item.revenueId)))
    .map((item) => ({ revenueId: Number(item.revenueId), before: num(item.before), after: num(item.after) }));
}

async function loadEnrollmentScheduleLines(
  client: PoolClient,
  enrollmentId: number,
  selectedRevenueIds: number[]
): Promise<EnrollmentScheduleLine[]> {
  const { rows } = await client.query(
    `SELECT r.id, r.amount, r.status, r.installment_number,
            COALESCE((
              SELECT SUM(allocation.amount)
              FROM ${SCHEMA}.finance_enrollment_payment_allocations allocation
              WHERE allocation.revenue_id = r.id
            ), 0) AS allocated
       FROM ${SCHEMA}.finance_revenues r
      WHERE r.enrollment_id = $1
      ORDER BY CASE WHEN r.installment_number = 0 THEN 0 ELSE 1 END, r.installment_number, r.id
      FOR UPDATE`,
    [enrollmentId]
  );
  const selected = new Set(selectedRevenueIds);
  return rows.map((row) => ({
    revenueId: Number(row.id),
    amount: round2(num(row.amount)),
    allocated: round2(num(row.allocated)),
    selected: selected.has(Number(row.id)),
    cancelled: row.status === "cancelado",
    installmentNumber: row.installment_number === null || row.installment_number === undefined
      ? null
      : Number(row.installment_number),
  }));
}

/**
 * Grava os novos valores. Parcela que já recebeu dinheiro conserva a taxa
 * prevista original — mesma regra da renegociação manual em
 * `updateOpenEnrollmentSchedule`; a que continua aberta recalcula pela taxa
 * do contrato.
 */
async function writeEnrollmentScheduleAmounts(
  client: PoolClient,
  entries: ScheduleShiftEntry[],
  ratePct: number,
  field: "before" | "after"
): Promise<void> {
  for (const entry of entries) {
    await client.query(
      `UPDATE ${SCHEMA}.finance_revenues
          SET amount = $2,
              fee_amount = CASE
                WHEN EXISTS (
                  SELECT 1 FROM ${SCHEMA}.finance_enrollment_payment_allocations allocation
                  WHERE allocation.revenue_id = ${SCHEMA}.finance_revenues.id
                ) THEN fee_amount
                ELSE ROUND($2::numeric * $3::numeric / 100, 2)
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [entry.revenueId, entry[field], ratePct]
    );
  }
}

async function applyEnrollmentScheduleShift(
  client: PoolClient,
  paymentId: number,
  entries: ScheduleShiftEntry[],
  ratePct: number
): Promise<void> {
  await writeEnrollmentScheduleAmounts(client, entries, ratePct, "after");
  await client.query(
    `UPDATE ${SCHEMA}.finance_enrollment_payments SET schedule_shift = $2::jsonb WHERE id = $1`,
    [paymentId, entries.length > 0 ? JSON.stringify(entries) : null]
  );
}

/**
 * Desfaz o remanejamento gravado num pagamento. É tudo ou nada: se qualquer
 * parcela envolvida já foi mexida depois (renegociação manual no editor, ou
 * outro pagamento que ocupou o valor novo), o cronograma fica como está —
 * voltar só uma parte quebraria a invariante "soma das parcelas = contrato".
 */
async function revertEnrollmentScheduleShift(
  client: PoolClient,
  paymentId: number,
  ratePct: number
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT schedule_shift FROM ${SCHEMA}.finance_enrollment_payments WHERE id = $1`,
    [paymentId]
  );
  const entries = parseScheduleShift(rows[0]?.schedule_shift);
  if (entries.length === 0) return true;

  const { rows: currentRows } = await client.query(
    `SELECT r.id, r.amount,
            COALESCE((
              SELECT SUM(allocation.amount)
              FROM ${SCHEMA}.finance_enrollment_payment_allocations allocation
              WHERE allocation.revenue_id = r.id AND allocation.payment_id <> $2
            ), 0) AS allocated_by_others
       FROM ${SCHEMA}.finance_revenues r
      WHERE r.id = ANY($1::bigint[])
      FOR UPDATE`,
    [entries.map((entry) => entry.revenueId), paymentId]
  );
  const current = new Map(currentRows.map((row) => [Number(row.id), row]));
  const canRevert = entries.every((entry) => {
    const row = current.get(entry.revenueId);
    if (!row) return false;
    return Math.abs(num(row.amount) - entry.after) <= 0.005
      && entry.before >= num(row.allocated_by_others) - 0.005;
  });
  if (!canRevert) return false;

  await writeEnrollmentScheduleAmounts(client, entries, ratePct, "before");
  await client.query(
    `UPDATE ${SCHEMA}.finance_enrollment_payments SET schedule_shift = NULL WHERE id = $1`,
    [paymentId]
  );
  return true;
}

/** Recalcula cada parcela com a soma de todos os rateios que a quitam. */
async function recomputeEnrollmentSchedule(client: PoolClient, enrollmentId: number): Promise<void> {
  await client.query(
    `WITH calc AS (
       SELECT r.id,
              CASE
                WHEN COALESCE(p.paid, 0) >= r.amount THEN 'recebido'
                WHEN COALESCE(p.paid, 0) > 0 THEN 'parcial'
                WHEN COALESCE(r.due_date, r.date) < CURRENT_DATE THEN 'atrasado'
                ELSE 'previsto'
              END AS next_status
       FROM ${SCHEMA}.finance_revenues r
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(amount), 0) AS paid
         FROM ${SCHEMA}.finance_enrollment_payment_allocations allocation WHERE allocation.revenue_id = r.id
       ) p ON TRUE
       WHERE r.enrollment_id = $1 AND r.status <> 'cancelado'
     )
     UPDATE ${SCHEMA}.finance_revenues t
     SET status = calc.next_status, updated_at = NOW()
     FROM calc
     WHERE t.id = calc.id AND t.status IS DISTINCT FROM calc.next_status`,
    [enrollmentId]
  );
}

export async function listEnrollmentPayments(enrollmentId: number): Promise<EnrollmentPayment[]> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `${ENROLLMENT_PAYMENT_SELECT} WHERE ep.enrollment_id = $1 ORDER BY ep.payment_date DESC, ep.id DESC`,
    [enrollmentId]
  );
  return rows.map(mapEnrollmentPayment);
}

/** % de comissão acordado na matrícula — guardado na comissão vinculada ao contrato. */
async function getEnrollmentCommissionPct(client: PoolClient, enrollmentId: number): Promise<number> {
  const { rows } = await client.query(
    `SELECT percent FROM ${SCHEMA}.finance_commissions WHERE enrollment_id = $1 LIMIT 1`,
    [enrollmentId]
  );
  return num(rows[0]?.percent);
}

export async function createEnrollmentPayment(
  enrollmentId: number,
  input: EnrollmentPaymentInput
): Promise<{ id: number; enrollment: FinanceEnrollment }> {
  await ensureFinanceSchema();
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Valor do pagamento inválido.");
  validatePaymentDate(input.paymentDate);

  const amount = round2(input.amount);
  const method = normalizePaymentMethod(input.paymentMethod);
  const asaasPaymentUrl = normalizeAsaasPaymentUrl(input.asaasPaymentUrl);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { balance, ratePct } = await lockEnrollmentAndGetBalance(client, enrollmentId);
    assertPaymentFitsBalance(amount, balance);
    const { requested, allocations } = await resolveEnrollmentPaymentAllocations(
      client,
      enrollmentId,
      input.revenueIds,
      input.revenueId,
      input.paymentDate,
      amount
    );

    const { feePct, feeAmount, netAmount } = await calculatePaymentFee(client, {
      method,
      amount,
      installments: input.installments,
      cardBrandId: input.cardBrandId ?? null,
    });
    // A comissão do vendedor é calculada sobre o dinheiro que entrou, no
    // percentual acordado na matrícula — é isso que a aba Comissões mostra como
    // "real" (o provisionamento contábil continua nas parcelas da comissão).
    const commissionPct = await getEnrollmentCommissionPct(client, enrollmentId);
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_enrollment_payments
         (enrollment_id, revenue_id, amount, payment_date, payment_method, installments, card_brand_id, fee_pct, fee_amount, net_amount,
          notes, asaas_payment_url, commission_pct, commission_amount, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        enrollmentId,
        allocations[0].revenueId,
        amount,
        input.paymentDate,
        method,
        Math.max(1, Math.min(24, Math.trunc(input.installments || 1))),
        method === "credito" ? input.cardBrandId ?? null : null,
        feePct,
        feeAmount,
        netAmount,
        input.notes?.trim() || null,
        asaasPaymentUrl,
        commissionPct,
        round2((amount * commissionPct) / 100),
        input.createdByUserId ?? null,
        input.createdByName?.trim() || null,
      ]
    );
    const paymentId = Number(rows[0].id);
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO ${SCHEMA}.finance_enrollment_payment_allocations (payment_id, revenue_id, amount)
         VALUES ($1, $2, $3)`,
        [paymentId, allocation.revenueId, allocation.amount]
      );
    }
    if (input.redistributeShortfall !== false) {
      const lines = await loadEnrollmentScheduleLines(client, enrollmentId, requested);
      await applyEnrollmentScheduleShift(client, paymentId, planShortfallRedistribution(lines), ratePct);
    }
    await recomputeEnrollmentSchedule(client, enrollmentId);
    await client.query("COMMIT");

    const enrollment = await getEnrollmentById(enrollmentId);
    if (!enrollment) throw new Error("Matrícula não encontrada após lançamento.");
    return { id: paymentId, enrollment };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateEnrollmentPayment(
  paymentId: number,
  input: Partial<EnrollmentPaymentInput>
): Promise<FinanceEnrollment> {
  await ensureFinanceSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: paymentRows } = await client.query(
      `SELECT * FROM ${SCHEMA}.finance_enrollment_payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );
    const current = paymentRows[0];
    if (!current) throw new Error("Pagamento não encontrado.");

    const amount = input.amount === undefined ? num(current.amount) : round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Valor do pagamento inválido.");
    const paymentDate = input.paymentDate === undefined ? toIsoDate(current.payment_date) ?? "" : input.paymentDate;
    validatePaymentDate(paymentDate);
    const method = input.paymentMethod === undefined
      ? normalizePaymentMethod(current.payment_method)
      : normalizePaymentMethod(input.paymentMethod);
    const installments = input.installments === undefined ? current.installments : input.installments;
    const cardBrandId = input.cardBrandId === undefined ? current.card_brand_id : input.cardBrandId;
    const oldRevenueId = current.revenue_id === null || current.revenue_id === undefined ? null : Number(current.revenue_id);
    const asaasPaymentUrl = input.asaasPaymentUrl === undefined
      ? normalizeAsaasPaymentUrl((current.asaas_payment_url as string | null | undefined) ?? null)
      : normalizeAsaasPaymentUrl(input.asaasPaymentUrl);
    const enrollmentId = Number(current.enrollment_id);
    const { balance, ratePct } = await lockEnrollmentAndGetBalance(client, enrollmentId, paymentId);
    // O rateio é refeito do zero, então o cronograma precisa voltar ao que era
    // antes deste pagamento — senão o remanejamento seria aplicado duas vezes.
    if (!(await revertEnrollmentScheduleShift(client, paymentId, ratePct))) {
      throw new Error(
        "O cronograma foi renegociado depois deste pagamento, então ele não pode mais ser editado aqui. Exclua o pagamento e lance de novo, ou ajuste as parcelas no editor da matrícula."
      );
    }
    assertPaymentFitsBalance(amount, balance);
    const currentAllocationRows = await client.query(
      `SELECT revenue_id FROM ${SCHEMA}.finance_enrollment_payment_allocations WHERE payment_id = $1 ORDER BY revenue_id`,
      [paymentId]
    );
    const preservedRevenueIds = currentAllocationRows.rows.length > 0
      ? currentAllocationRows.rows.map((row) => Number(row.revenue_id))
      : oldRevenueId ? [oldRevenueId] : [];
    const requestedRevenueIds = input.revenueIds !== undefined
      ? input.revenueIds
      : input.revenueId !== undefined
        ? input.revenueId === null ? [] : [input.revenueId]
        : preservedRevenueIds;
    const { requested, allocations } = await resolveEnrollmentPaymentAllocations(
      client,
      enrollmentId,
      requestedRevenueIds,
      null,
      paymentDate,
      amount,
      paymentId
    );

    const { feePct, feeAmount, netAmount } = await calculatePaymentFee(client, {
      method,
      amount,
      installments,
      cardBrandId: cardBrandId ?? null,
    });
    const commissionPct = await getEnrollmentCommissionPct(client, enrollmentId);
    await client.query(
      `UPDATE ${SCHEMA}.finance_enrollment_payments
       SET revenue_id = $2, amount = $3, payment_date = $4, payment_method = $5, installments = $6, card_brand_id = $7,
           fee_pct = $8, fee_amount = $9, net_amount = $10, notes = $11, asaas_payment_url = $12,
           commission_pct = $13, commission_amount = $14
       WHERE id = $1`,
      [
        paymentId,
        allocations[0].revenueId,
        amount,
        paymentDate,
        method,
        Math.max(1, Math.min(24, Math.trunc(Number(installments) || 1))),
        method === "credito" ? cardBrandId ?? null : null,
        feePct,
        feeAmount,
        netAmount,
        input.notes === undefined ? current.notes : input.notes?.trim() || null,
        asaasPaymentUrl,
        commissionPct,
        round2((amount * commissionPct) / 100),
      ]
    );
    await client.query(`DELETE FROM ${SCHEMA}.finance_enrollment_payment_allocations WHERE payment_id = $1`, [paymentId]);
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO ${SCHEMA}.finance_enrollment_payment_allocations (payment_id, revenue_id, amount)
         VALUES ($1, $2, $3)`,
        [paymentId, allocation.revenueId, allocation.amount]
      );
    }
    if (input.redistributeShortfall !== false) {
      const lines = await loadEnrollmentScheduleLines(client, enrollmentId, requested);
      await applyEnrollmentScheduleShift(client, paymentId, planShortfallRedistribution(lines), ratePct);
    }
    await recomputeEnrollmentSchedule(client, enrollmentId);
    await client.query("COMMIT");

    const enrollment = await getEnrollmentById(enrollmentId);
    if (!enrollment) throw new Error("Matrícula não encontrada após atualização.");
    return enrollment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteEnrollmentPayment(paymentId: number): Promise<FinanceEnrollment> {
  await ensureFinanceSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: paymentRows } = await client.query(
      `SELECT enrollment_id, revenue_id FROM ${SCHEMA}.finance_enrollment_payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );
    const enrollmentId = paymentRows[0]?.enrollment_id ? Number(paymentRows[0].enrollment_id) : null;
    if (!enrollmentId) throw new Error("Pagamento não encontrado.");
    const { ratePct } = await lockEnrollmentAndGetBalance(client, enrollmentId);
    // Se o remanejamento não puder mais ser desfeito (parcela mexida depois),
    // o cronograma renegociado permanece: a soma das parcelas continua igual
    // ao contrato, e desfazer pela metade é que deixaria a matrícula torta.
    await revertEnrollmentScheduleShift(client, paymentId, ratePct);
    await client.query(`DELETE FROM ${SCHEMA}.finance_enrollment_payments WHERE id = $1`, [paymentId]);
    await recomputeEnrollmentSchedule(client, enrollmentId);
    await client.query("COMMIT");

    const enrollment = await getEnrollmentById(enrollmentId);
    if (!enrollment) throw new Error("Matrícula não encontrada após exclusão.");
    return enrollment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveEnrollmentPaymentInvoice(
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await saveFinanceInvoice("finance_enrollment_payments", id, file);
}

export async function getEnrollmentPaymentInvoice(
  id: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  return getFinanceInvoice("finance_enrollment_payments", id);
}

// ── Comissões ────────────────────────────────────────────────────

export interface CommissionInput {
  date: string;
  sellerId: number;
  student: string;
  courseId?: number | null;
  saleAmount: number;
  percent: number;
  paymentMethodId?: number | null;
  installments?: number;
  enrollmentId?: number | null;
  notes?: string | null;
}

/**
 * Registra a venda e gera as parcelas de comissão automaticamente:
 * PIX/Débito (à vista) = integral no mês da venda; cartão/boleto parcelado =
 * dividida pelo número de parcelas a partir do mês da venda. As parcelas
 * alimentam os Gastos Fixos do mês correspondente (linha calculada).
 */
export async function createCommission(input: CommissionInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.student?.trim()) throw new Error("Aluno é obrigatório.");
  if (!input.sellerId) throw new Error("Vendedor é obrigatório.");
  if (!Number.isFinite(input.saleAmount) || input.saleAmount <= 0) throw new Error("Valor da venda inválido.");
  if (!Number.isFinite(input.percent) || input.percent <= 0) throw new Error("Percentual inválido.");

  const pool = getPool();
  const { rows: methodRows } = input.paymentMethodId
    ? await pool.query(`SELECT kind FROM ${SCHEMA}.finance_payment_methods WHERE id = $1`, [input.paymentMethodId])
    : { rows: [] as Array<{ kind: string }> };
  const isParcelado = methodRows[0]?.kind === "parcelado";
  const installments = isParcelado ? Math.max(1, Math.min(24, Math.trunc(input.installments || 1))) : 1;

  const total = round2((input.saleAmount * input.percent) / 100);
  const saleMonth = input.date.slice(0, 7);
  const parts = splitInstallments(total, installments);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_commissions
         (date, seller_id, student, course_id, sale_amount, percent, payment_method_id, installments, total_commission, enrollment_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        input.date,
        input.sellerId,
        input.student.trim(),
        input.courseId ?? null,
        round2(input.saleAmount),
        input.percent,
        input.paymentMethodId ?? null,
        installments,
        total,
        input.enrollmentId ?? null,
        input.notes?.trim() || null,
      ]
    );
    const commissionId = Number(rows[0].id);
    for (let i = 0; i < parts.length; i += 1) {
      await client.query(
        `INSERT INTO ${SCHEMA}.finance_commission_installments (commission_id, month, amount, status)
         VALUES ($1, $2, $3, 'pendente')`,
        [commissionId, monthToDate(addMonths(saleMonth, i)), parts[i]]
      );
    }
    await client.query("COMMIT");
    return commissionId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapCommission(r: Record<string, unknown>): FinanceCommission {
  return {
    id: Number(r.id),
    date: toIsoDate(r.date) ?? "",
    sellerId: Number(r.seller_id),
    sellerName: String(r.seller_name ?? ""),
    student: String(r.student ?? ""),
    courseId: r.course_id === null ? null : Number(r.course_id),
    courseName: (r.course_name as string) ?? null,
    saleAmount: num(r.sale_amount),
    percent: num(r.percent),
    paymentMethodId: r.payment_method_id === null ? null : Number(r.payment_method_id),
    paymentMethodName: (r.payment_method_name as string) ?? null,
    installments: Number(r.installments),
    totalCommission: num(r.total_commission),
    enrollmentId: r.enrollment_id === null ? null : Number(r.enrollment_id),
    notes: (r.notes as string) ?? null,
    installmentsDetail: [],
  };
}

export async function listCommissions(filters: FinanceFilters = {}): Promise<FinanceCommission[]> {
  await ensureFinanceSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.from) {
    values.push(monthToDate(filters.from));
    conditions.push(`cm.date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(monthToDate(addMonths(filters.to, 1)));
    conditions.push(`cm.date < $${values.length}`);
  }
  if (filters.sellerId) {
    values.push(filters.sellerId);
    conditions.push(`cm.seller_id = $${values.length}`);
  }
  // Mesma regra do resumo (ver commissionBusinessUnitSql): a comissão segue a
  // unidade da matrícula que a gerou, e comissão lançada à mão conta como
  // VozUP. Sem isto, a lista mostrava a comissão das duas empresas junto
  // enquanto o resumo logo acima já mostrava só a da unidade escolhida.
  if (filters.businessUnit) {
    values.push(filters.businessUnit);
    conditions.push(`COALESCE((
      SELECT e.business_unit FROM ${SCHEMA}.finance_enrollments e WHERE e.id = cm.enrollment_id
    ), 'vozup') = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT cm.*, s.name AS seller_name, co.name AS course_name, pm.name AS payment_method_name
     FROM ${SCHEMA}.finance_commissions cm
     JOIN ${SCHEMA}.finance_sellers s ON s.id = cm.seller_id
     LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = cm.course_id
     LEFT JOIN ${SCHEMA}.finance_payment_methods pm ON pm.id = cm.payment_method_id
     ${where} ORDER BY cm.date DESC, cm.id DESC LIMIT 1000`,
    values
  );
  const commissions = rows.map(mapCommission);
  if (commissions.length > 0) {
    const ids = commissions.map((c) => c.id);
    const { rows: instRows } = await getPool().query(
      `SELECT * FROM ${SCHEMA}.finance_commission_installments WHERE commission_id = ANY($1::bigint[]) ORDER BY month`,
      [ids]
    );
    const byCommission = new Map<number, FinanceCommissionInstallment[]>();
    for (const row of instRows) {
      const item: FinanceCommissionInstallment = {
        id: Number(row.id),
        commissionId: Number(row.commission_id),
        month: dateToMonth(row.month),
        amount: num(row.amount),
        status: (row.status === "pago" ? "pago" : "pendente") as InstallmentStatus,
        paidAt: toIsoDate(row.paid_at),
      };
      const list = byCommission.get(item.commissionId) ?? [];
      list.push(item);
      byCommission.set(item.commissionId, list);
    }
    for (const commission of commissions) {
      commission.installmentsDetail = byCommission.get(commission.id) ?? [];
    }
  }
  return commissions;
}

export async function deleteCommission(id: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_commissions WHERE id = $1`, [id]);
}

export async function setCommissionInstallmentStatus(
  id: number,
  status: InstallmentStatus
): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_commission_installments
     SET status = $2, paid_at = CASE WHEN $2 = 'pago' THEN CURRENT_DATE ELSE NULL END
     WHERE id = $1`,
    [id, status === "pago" ? "pago" : "pendente"]
  );
}

export async function getCommissionPanel(month: string): Promise<FinanceCommissionPanel> {
  await ensureFinanceSchema();
  const year = month.slice(0, 4);
  const { rows } = await getPool().query(
    // "Pagas"/"Pendentes" no mesmo recorte de ano dos outros dois totais: sem o
    // filtro, o card mostrava mês e ano ao lado de números de todos os tempos.
    `SELECT s.id AS seller_id, s.name AS seller_name,
            COALESCE(SUM(ci.amount) FILTER (WHERE ci.month = $1::date), 0) AS month_total,
            COALESCE(SUM(ci.amount) FILTER (WHERE EXTRACT(YEAR FROM ci.month) = $2::int), 0) AS year_total,
            COALESCE(SUM(ci.amount) FILTER (WHERE ci.status = 'pago' AND EXTRACT(YEAR FROM ci.month) = $2::int), 0) AS paid_total,
            COALESCE(SUM(ci.amount) FILTER (WHERE ci.status = 'pendente' AND EXTRACT(YEAR FROM ci.month) = $2::int), 0) AS pending_total
     FROM ${SCHEMA}.finance_sellers s
     LEFT JOIN ${SCHEMA}.finance_commissions cm ON cm.seller_id = s.id
     LEFT JOIN ${SCHEMA}.finance_commission_installments ci ON ci.commission_id = cm.id
     WHERE s.active = TRUE
     GROUP BY s.id, s.name
     ORDER BY s.name`,
    [monthToDate(month), Number(year)]
  );
  const sellers = rows.map((r) => ({
    sellerId: Number(r.seller_id),
    sellerName: String(r.seller_name),
    monthTotal: num(r.month_total),
    yearTotal: num(r.year_total),
    paidTotal: num(r.paid_total),
    pendingTotal: num(r.pending_total),
  }));
  return {
    sellers,
    monthTotal: round2(sellers.reduce((s, x) => s + x.monthTotal, 0)),
    yearTotal: round2(sellers.reduce((s, x) => s + x.yearTotal, 0)),
    paidTotal: round2(sellers.reduce((s, x) => s + x.paidTotal, 0)),
    pendingTotal: round2(sellers.reduce((s, x) => s + x.pendingTotal, 0)),
  };
}

// ── Implementação de filiais ─────────────────────────────────────

function mapBranchItem(r: Record<string, unknown>): FinanceBranchItem {
  return {
    id: Number(r.id),
    branchId: Number(r.branch_id),
    branchName: String(r.branch_name ?? ""),
    item: String(r.item ?? ""),
    category: String(r.category ?? "Outros"),
    supplier: (r.supplier as string) ?? null,
    amount: num(r.amount),
    date: toIsoDate(r.date),
    status: normalizeExpenseStatus(r.status),
    costKind: (r.cost_kind === "variavel" ? "variavel" : "fixo") as BranchItemCostKind,
    phase: (r.phase === "pre_operacional" ? "pre_operacional" : "implementacao") as BranchItemPhase,
    invoiceUrl: (r.invoice_url as string) ?? null,
    hasInvoiceFile: Boolean(r.has_invoice),
    invoiceFilename: (r.invoice_filename as string) ?? null,
    notes: (r.notes as string) ?? null,
  };
}

export async function listBranchItems(branchId?: number): Promise<FinanceBranchItem[]> {
  await ensureFinanceSchema();
  const values: unknown[] = [];
  let where = "";
  if (branchId) {
    values.push(branchId);
    where = `WHERE bi.branch_id = $1`;
  }
  const { rows } = await getPool().query(
    `SELECT bi.id, bi.branch_id, bi.item, bi.category, bi.supplier, bi.amount, bi.date, bi.status,
            bi.cost_kind, bi.phase, bi.invoice_url, bi.invoice_filename, bi.notes,
            (bi.invoice_file IS NOT NULL) AS has_invoice, b.name AS branch_name
     FROM ${SCHEMA}.finance_branch_items bi
     JOIN ${SCHEMA}.finance_branches b ON b.id = bi.branch_id
     ${where} ORDER BY bi.date DESC NULLS LAST, bi.id DESC LIMIT 2000`,
    values
  );
  return rows.map(mapBranchItem);
}

export interface BranchItemInput {
  branchId: number;
  item: string;
  category?: string;
  supplier?: string | null;
  amount: number;
  date?: string | null;
  status?: ExpenseStatus;
  costKind?: BranchItemCostKind;
  phase?: BranchItemPhase;
  invoiceUrl?: string | null;
  notes?: string | null;
}

export async function createBranchItem(input: BranchItemInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.branchId) throw new Error("Filial é obrigatória.");
  if (!input.item?.trim()) throw new Error("Item é obrigatório.");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_branch_items
       (branch_id, item, category, supplier, amount, date, status, cost_kind, phase, invoice_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      input.branchId,
      input.item.trim(),
      input.category?.trim() || "Outros",
      input.supplier?.trim() || null,
      round2(input.amount ?? 0),
      input.date || null,
      normalizeExpenseStatus(input.status),
      input.costKind === "variavel" ? "variavel" : "fixo",
      input.phase === "pre_operacional" ? "pre_operacional" : "implementacao",
      input.invoiceUrl?.trim() || null,
      input.notes?.trim() || null,
    ]
  );
  return Number(rows[0].id);
}

export async function updateBranchItem(id: number, input: Partial<BranchItemInput>): Promise<void> {
  await ensureFinanceSchema();
  const map: Record<string, unknown> = {
    branch_id: input.branchId,
    item: input.item?.trim(),
    category: input.category?.trim(),
    supplier: input.supplier,
    amount: input.amount !== undefined ? round2(input.amount) : undefined,
    date: input.date === undefined ? undefined : input.date || null,
    status: input.status !== undefined ? normalizeExpenseStatus(input.status) : undefined,
    cost_kind: input.costKind === undefined ? undefined : input.costKind === "variavel" ? "variavel" : "fixo",
    phase: input.phase === undefined ? undefined : input.phase === "pre_operacional" ? "pre_operacional" : "implementacao",
    invoice_url: input.invoiceUrl,
    notes: input.notes,
  };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_branch_items SET ${sets.join(", ")} WHERE id = $1`,
    [id, ...entries.map(([, v]) => v)]
  );
}

export async function deleteBranchItem(id: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_branch_items WHERE id = $1`, [id]);
}

export async function saveBranchItemInvoice(
  id: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<void> {
  await saveFinanceInvoice("finance_branch_items", id, file);
}

export async function getBranchItemInvoice(
  id: number
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  return getFinanceInvoice("finance_branch_items", id);
}

// ── Resumos (dashboard, fluxo de caixa, trimestral) ──────────────

/**
 * Recorte por unidade de negócio, para qualquer tabela que tenha a coluna.
 * Sem filtro escolhido, soma as duas — "Tudo" é ausência de condição, nunca
 * `= 'vozup'`.
 */
function businessUnitSql(filters: FinanceFilters, values: unknown[], alias = ""): string {
  if (!filters.businessUnit) return "";
  values.push(filters.businessUnit);
  return ` AND ${alias}business_unit = $${values.length}`;
}

function buildRevenueFilterSql(filters: FinanceFilters, values: unknown[]): string {
  const conditions: string[] = [];
  for (const [key, column] of [
    ["branchId", "r.branch_id"],
    ["courseId", "r.course_id"],
    ["categoryId", "r.category_id"],
    ["sellerId", "r.seller_id"],
    ["paymentMethodId", "r.payment_method_id"],
  ] as const) {
    const value = filters[key];
    if (value) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }
  const base = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
  return base + businessUnitSql(filters, values, "r.");
}

/** Filtros aplicáveis a uma matrícula quando o lançamento é um pagamento real. */
function buildEnrollmentFilterSql(filters: FinanceFilters, values: unknown[]): string {
  const conditions: string[] = [];
  for (const [key, column] of [
    ["branchId", "e.branch_id"],
    ["courseId", "e.course_id"],
    ["sellerId", "e.seller_id"],
    ["paymentMethodId", "e.payment_method_id"],
  ] as const) {
    const value = filters[key];
    if (value) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }
  // Sem isto, o recebimento de uma matrícula da VozUP aparecia como "entrou"
  // na visão do Instituto UP: o dinheiro real vem daqui, não da parcela.
  if (filters.businessUnit) {
    values.push(filters.businessUnit);
    conditions.push(`e.business_unit = $${values.length}`);
  }
  return conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
}

/**
 * Comissão segue a unidade da matrícula que a gerou. Comissão lançada à mão,
 * sem matrícula vinculada, conta como VozUP — era a única operação até a
 * separação existir.
 */
function commissionBusinessUnitSql(filters: FinanceFilters, values: unknown[], alias = "ci"): string {
  if (!filters.businessUnit) return "";
  values.push(filters.businessUnit);
  return ` AND COALESCE((
    SELECT e.business_unit FROM ${SCHEMA}.finance_enrollments e
      JOIN ${SCHEMA}.finance_commissions c2 ON c2.enrollment_id = e.id
     WHERE c2.id = ${alias}.commission_id
     LIMIT 1
  ), 'vozup') = $${values.length}`;
}

/** Totais mensais consolidados entre `from` e `to` (inclusive), mês a mês. */
export async function getMonthlyTotals(
  from: string,
  to: string,
  filters: FinanceFilters = {}
): Promise<FinanceMonthTotals[]> {
  await ensureFinanceSchema();
  const pool = getPool();
  // Teto: nada além do mês corrente entra na série. Como praticamente todo
  // indicador e gráfico do módulo nasce daqui, recortar neste ponto já impede
  // que despesa fixa de agosto→dezembro apareça em KPI, lucro ou gráfico.
  const range = clampMonthRange(from, to);
  if (range.empty) return [];
  const effectiveTo = range.to;
  const fromDate = monthToDate(from);
  const toDate = monthToDate(addMonths(effectiveTo, 1));

  const revenueValues: unknown[] = [fromDate, toDate];
  const revenueFilterSql = buildRevenueFilterSql(filters, revenueValues);
  // Despesas só conseguem honrar o filtro de unidade — as demais dimensões
  // (curso, vendedor, forma de pagamento, categoria de receita) não existem nas
  // tabelas de gasto. A tela avisa isso ao ativar um filtro desses.
  const expenseBranchValues: unknown[] = [fromDate, toDate];
  const expenseBranchSql =
    (filters.branchId ? ` AND branch_id = $${expenseBranchValues.push(filters.branchId)}` : "") +
    businessUnitSql(filters, expenseBranchValues);
  // Fixas não têm unidade física, mas têm unidade de negócio.
  const fixedValues: unknown[] = [fromDate, toDate, FIXED_EXPENSES_START_DATE];
  const fixedBusinessUnitSql = businessUnitSql(filters, fixedValues);
  const enrollmentValues: unknown[] = [fromDate, toDate];
  const enrollmentFilterSql = buildEnrollmentFilterSql(filters, enrollmentValues);
  const [revenues, fixed, variable, commissions, branchSetup, enrollments] = await Promise.all([
    pool.query(
      // "Receita prevista" = o que ainda falta entrar das parcelas do mês. Antes
      // era o filtro por status = 'previsto', que zerava assim que um pagamento
      // parcial mudava o status — dizendo "previsto R$ 0" com saldo em aberto.
      `SELECT date_trunc('month', r.date)::date AS month,
              COALESCE(SUM(r.amount) FILTER (WHERE r.status <> 'cancelado'), 0) AS forecast,
              COALESCE(SUM(r.fee_amount) FILTER (WHERE r.status <> 'cancelado'), 0) AS fees
       FROM ${SCHEMA}.finance_revenues r
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(amount), 0) AS paid
         FROM ${SCHEMA}.finance_revenue_payments WHERE revenue_id = r.id
       ) pay ON TRUE
       ${ENROLLMENT_ALLOCATION_JOIN}
       WHERE r.date >= $1 AND r.date < $2${revenueFilterSql}
       GROUP BY 1`,
      revenueValues
    ),
    pool.query(
      `SELECT month, COALESCE(SUM(amount + COALESCE(benefits_amount, 0)), 0) AS total
       FROM ${SCHEMA}.finance_fixed_expenses
       WHERE month >= $1 AND month < $2 AND month >= $3::date${fixedBusinessUnitSql} GROUP BY month`,
      fixedValues
    ),
    pool.query(
      // Variáveis são gastos pontuais reais e entram desde a data do lançamento.
      // O piso de junho se aplica somente às fixas provisionadas.
      `SELECT date_trunc('month', date)::date AS month, COALESCE(SUM(amount), 0) AS total
       FROM ${SCHEMA}.finance_variable_expenses
       WHERE date >= $1 AND date < $2${expenseBranchSql}
       GROUP BY 1`,
      expenseBranchValues
    ),
    (() => {
      const values: unknown[] = [fromDate, toDate];
      const unitSql = commissionBusinessUnitSql(filters, values);
      return pool.query(
        `SELECT month, COALESCE(SUM(amount), 0) AS total
           FROM ${SCHEMA}.finance_commission_installments ci
          WHERE month >= $1 AND month < $2${unitSql} GROUP BY month`,
        values
      );
    })(),
    pool.query(
      `SELECT date_trunc('month', date)::date AS month, COALESCE(SUM(amount), 0) AS total
       FROM ${SCHEMA}.finance_branch_items WHERE date IS NOT NULL AND date >= $1 AND date < $2${expenseBranchSql} GROUP BY 1`,
      expenseBranchValues
    ),
    // Ticket médio precisa do valor contratado das vendas do mês, não da soma
    // das parcelas que vencem no mês — são coisas diferentes num parcelamento.
    pool.query(
      `SELECT date_trunc('month', e.sale_date)::date AS month,
              COUNT(*)::int AS total,
              COALESCE(SUM(e.total_amount), 0) AS amount
       FROM ${SCHEMA}.finance_enrollments e
       WHERE e.sale_date >= $1 AND e.sale_date < $2${enrollmentFilterSql}
       GROUP BY 1`,
      enrollmentValues
    ),
  ]);

  // Receita realizada é sempre dinheiro efetivamente registrado, no mês da
  // data do pagamento. As parcelas acima continuam sendo só a previsão.
  const enrollmentReceiptValues: unknown[] = [fromDate, toDate];
  const enrollmentReceiptFilterSql = buildEnrollmentFilterSql(filters, enrollmentReceiptValues);
  const avulsoReceiptValues: unknown[] = [fromDate, toDate];
  const avulsoReceiptFilterSql = buildRevenueFilterSql(filters, avulsoReceiptValues);
  const [enrollmentReceipts, avulsoReceipts] = await Promise.all([
    pool.query(
      `SELECT date_trunc('month', ep.payment_date)::date AS month, COALESCE(SUM(ep.amount), 0) AS total
       FROM ${SCHEMA}.finance_enrollment_payments ep
       JOIN ${SCHEMA}.finance_enrollments e ON e.id = ep.enrollment_id
       WHERE ep.payment_date >= $1 AND ep.payment_date < $2${enrollmentReceiptFilterSql}
       GROUP BY 1`,
      enrollmentReceiptValues
    ),
    pool.query(
      `SELECT date_trunc('month', p.payment_date)::date AS month, COALESCE(SUM(p.amount), 0) AS total
       FROM ${SCHEMA}.finance_revenue_payments p
       JOIN ${SCHEMA}.finance_revenues r ON r.id = p.revenue_id
       WHERE p.payment_date >= $1 AND p.payment_date < $2
         AND r.revenue_mode = 'avulso'${avulsoReceiptFilterSql}
       GROUP BY 1`,
      avulsoReceiptValues
    ),
  ]);

  const byMonth = new Map<string, FinanceMonthTotals>();
  let cursor = from;
  while (cursor <= effectiveTo) {
    byMonth.set(cursor, {
      month: cursor,
      revenue: 0,
      revenueForecast: 0,
      fixedExpenses: 0,
      variableExpenses: 0,
      commissions: 0,
      branchSetup: 0,
      totalExpenses: 0,
      profit: 0,
      margin: 0,
      enrollmentsCount: 0,
      enrollmentsAmount: 0,
      cardFees: 0,
    });
    cursor = addMonths(cursor, 1);
  }

  const setValue = (rows: Array<Record<string, unknown>>, apply: (t: FinanceMonthTotals, r: Record<string, unknown>) => void) => {
    for (const row of rows) {
      const key = dateToMonth(row.month);
      const target = byMonth.get(key);
      if (target) apply(target, row);
    }
  };

  setValue(revenues.rows, (t, r) => {
    t.revenueForecast = num(r.forecast);
    t.cardFees = num(r.fees);
  });
  setValue(enrollmentReceipts.rows, (t, r) => {
    t.revenue = round2(t.revenue + num(r.total));
  });
  setValue(avulsoReceipts.rows, (t, r) => {
    t.revenue = round2(t.revenue + num(r.total));
  });
  setValue(fixed.rows, (t, r) => {
    t.fixedExpenses = num(r.total);
  });
  setValue(variable.rows, (t, r) => {
    t.variableExpenses = num(r.total);
  });
  setValue(commissions.rows, (t, r) => {
    t.commissions = num(r.total);
  });
  setValue(branchSetup.rows, (t, r) => {
    t.branchSetup = num(r.total);
  });
  setValue(enrollments.rows, (t, r) => {
    t.enrollmentsCount = Number(r.total);
    t.enrollmentsAmount = num(r.amount);
  });

  for (const totals of byMonth.values()) {
    // Comissões alimentam os gastos fixos do mês (linha calculada, não gravada).
    totals.totalExpenses = round2(totals.fixedExpenses + totals.commissions + totals.variableExpenses);
    totals.profit = round2(totals.revenue - totals.totalExpenses);
    totals.margin = totals.revenue > 0 ? round2((totals.profit / totals.revenue) * 100) : 0;
  }

  return Array.from(byMonth.values());
}

/**
 * Primeiro e último mês com qualquer movimento financeiro — usado pelo modo
 * "Tudo" do filtro do topo, que precisa de um intervalo concreto para
 * alimentar KPIs, listas e gráficos de uma vez só. O fim nunca fica antes do
 * mês corrente, senão o mês em curso sumiria do recorte "tudo".
 */
export async function getFinanceDataRange(): Promise<{ from: string; to: string }> {
  await ensureFinanceSchema();
  const { rows } = await getPool().query(
    `SELECT MIN(min_d)::date AS min_date, MAX(max_d)::date AS max_date FROM (
       SELECT MIN(date) AS min_d, MAX(date) AS max_d FROM ${SCHEMA}.finance_revenues
       UNION ALL SELECT MIN(month), MAX(month) FROM ${SCHEMA}.finance_fixed_expenses WHERE month >= '${FIXED_EXPENSES_START_DATE}'::date
       UNION ALL SELECT MIN(date), MAX(date) FROM ${SCHEMA}.finance_variable_expenses
       UNION ALL SELECT MIN(sale_date), MAX(sale_date) FROM ${SCHEMA}.finance_enrollments
       UNION ALL SELECT MIN(payment_date), MAX(payment_date) FROM ${SCHEMA}.finance_enrollment_payments
       UNION ALL SELECT MIN(month), MAX(month) FROM ${SCHEMA}.finance_commission_installments
       UNION ALL SELECT MIN(date), MAX(date) FROM ${SCHEMA}.finance_branch_items
     ) x`
  );
  const current = currentMonth();
  const from = rows[0]?.min_date ? dateToMonth(rows[0].min_date) : current;
  // O fim é SEMPRE o mês corrente. Antes devolvia o último mês com registro, e
  // como a folha já está provisionada até dezembro e há parcela até 2027, o
  // modo "Tudo" abria um recorte que ia até o futuro.
  return { from: from < current ? from : current, to: current };
}

/**
 * Quebra mensal completa, do primeiro lançamento até o mês atual — usado
 * pelo addon "ver todos os meses" da aba Fluxo de Caixa. Descobre a data
 * mais antiga entre todas as tabelas financeiras e delega pra
 * getMonthlyTotals com esse intervalo.
 */
export async function listAllMonthlyTotals(): Promise<FinanceMonthTotals[]> {
  await ensureFinanceSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT MIN(d)::date AS min_date FROM (
       SELECT MIN(date) AS d FROM ${SCHEMA}.finance_revenues
       UNION ALL SELECT MIN(month) FROM ${SCHEMA}.finance_fixed_expenses WHERE month >= '${FIXED_EXPENSES_START_DATE}'::date
       UNION ALL SELECT MIN(date) FROM ${SCHEMA}.finance_variable_expenses
       UNION ALL SELECT MIN(sale_date) FROM ${SCHEMA}.finance_enrollments
       UNION ALL SELECT MIN(month) FROM ${SCHEMA}.finance_commission_installments
     ) x`
  );
  const minDate = rows[0]?.min_date;
  if (!minDate) return [];
  return getMonthlyTotals(dateToMonth(minDate), currentMonth(), {});
}

/**
 * Saldo em caixa: saldo inicial + tudo que foi efetivamente recebido − pago,
 * até o mês corrente. Pagamento agendado pra frente (existe recebimento de
 * matrícula com data em agosto) não pode aparecer como dinheiro já em caixa.
 */
export async function getCashBalance(): Promise<number> {
  await ensureFinanceSchema();
  const pool = getPool();
  const ceiling = financeCeilingExclusiveDate();
  const [settings, received, enrollmentReceived, fixedPaid, variableTotal, commissionsPaid, branchPaid] = await Promise.all([
    pool.query(`SELECT value FROM ${SCHEMA}.finance_settings WHERE key = 'saldo_inicial'`),
    pool.query(
      // Receita avulsa entra no caixa pelo que foi efetivamente pago, mesmo
      // parcialmente — esperar o status virar "recebido" escondia do saldo todo
      // pagamento parcial. Receita legada continua entrando só quando quitada.
      `SELECT COALESCE(SUM(
         CASE WHEN r.revenue_mode = 'avulso' THEN COALESCE(pay.net_received, 0)
              WHEN r.status = 'recebido' THEN r.amount - r.fee_amount
              ELSE 0 END
       ), 0) AS total
       FROM ${SCHEMA}.finance_revenues r
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(net_amount), 0) AS net_received
         FROM ${SCHEMA}.finance_revenue_payments WHERE revenue_id = r.id
       ) pay ON TRUE
       WHERE r.status <> 'cancelado'
         AND r.enrollment_id IS NULL
         AND r.date < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(net_amount), 0) AS total FROM ${SCHEMA}.finance_enrollment_payments
        WHERE payment_date < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount + COALESCE(benefits_amount, 0)), 0) AS total
       FROM ${SCHEMA}.finance_fixed_expenses WHERE status = 'pago' AND month >= $1::date AND month < $2`,
      [FIXED_EXPENSES_START_DATE, ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_variable_expenses
        WHERE date < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_commission_installments
        WHERE status = 'pago' AND month < $1`,
      [ceiling]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_branch_items
        WHERE status = 'pago' AND (date IS NULL OR date < $1)`,
      [ceiling]
    ),
  ]);
  return round2(
    num(settings.rows[0]?.value) +
      num(received.rows[0]?.total) +
      num(enrollmentReceived.rows[0]?.total) -
      num(fixedPaid.rows[0]?.total) -
      num(variableTotal.rows[0]?.total) -
      num(commissionsPaid.rows[0]?.total) -
      num(branchPaid.rows[0]?.total)
  );
}

async function getDistribution(
  sql: string,
  values: unknown[]
): Promise<FinanceDistributionSlice[]> {
  const { rows } = await getPool().query(sql, values);
  return rows
    .map((r) => ({ name: String(r.name ?? "Outros"), value: num(r.value) }))
    .filter((slice) => slice.value > 0);
}

export function toQuarterTotals(monthly: FinanceMonthTotals[]): FinanceQuarterTotals[] {
  const byQuarter = new Map<string, FinanceQuarterTotals>();
  for (const m of monthly) {
    const year = Number(m.month.slice(0, 4));
    const quarter = Math.floor((Number(m.month.slice(5, 7)) - 1) / 3) + 1;
    const key = `${year}-Q${quarter}`;
    const target =
      byQuarter.get(key) ??
      ({
        year,
        quarter,
        label: `Q${quarter} ${year}`,
        revenue: 0,
        fixedExpenses: 0,
        variableExpenses: 0,
        totalExpenses: 0,
        profit: 0,
        margin: 0,
      } satisfies FinanceQuarterTotals);
    target.revenue = round2(target.revenue + m.revenue);
    target.fixedExpenses = round2(target.fixedExpenses + m.fixedExpenses + m.commissions);
    target.variableExpenses = round2(target.variableExpenses + m.variableExpenses);
    target.totalExpenses = round2(target.totalExpenses + m.totalExpenses);
    target.profit = round2(target.profit + m.profit);
    byQuarter.set(key, target);
  }
  const list = Array.from(byQuarter.values());
  for (const q of list) {
    q.margin = q.revenue > 0 ? round2((q.profit / q.revenue) * 100) : 0;
  }
  return list.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

function deltaPct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

function countMonths(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map((value) => Number.parseInt(value, 10));
  const [toYear, toMonth] = to.split("-").map((value) => Number.parseInt(value, 10));
  return Math.max(1, (toYear - fromYear) * 12 + toMonth - fromMonth + 1);
}

function sumMonthTotals(monthly: FinanceMonthTotals[], label: string): FinanceMonthTotals {
  const totals: FinanceMonthTotals = {
    month: label,
    revenue: 0,
    revenueForecast: 0,
    fixedExpenses: 0,
    variableExpenses: 0,
    commissions: 0,
    branchSetup: 0,
    totalExpenses: 0,
    profit: 0,
    margin: 0,
    enrollmentsCount: 0,
    enrollmentsAmount: 0,
    cardFees: 0,
  };

  for (const monthTotals of monthly) {
    totals.revenue = round2(totals.revenue + monthTotals.revenue);
    totals.revenueForecast = round2(totals.revenueForecast + monthTotals.revenueForecast);
    totals.fixedExpenses = round2(totals.fixedExpenses + monthTotals.fixedExpenses);
    totals.variableExpenses = round2(totals.variableExpenses + monthTotals.variableExpenses);
    totals.commissions = round2(totals.commissions + monthTotals.commissions);
    totals.branchSetup = round2(totals.branchSetup + monthTotals.branchSetup);
    totals.cardFees = round2(totals.cardFees + monthTotals.cardFees);
    totals.enrollmentsCount += monthTotals.enrollmentsCount;
    totals.enrollmentsAmount = round2(totals.enrollmentsAmount + monthTotals.enrollmentsAmount);
  }

  totals.totalExpenses = round2(totals.fixedExpenses + totals.commissions + totals.variableExpenses);
  totals.profit = round2(totals.revenue - totals.totalExpenses);
  totals.margin = totals.revenue > 0 ? round2((totals.profit / totals.revenue) * 100) : 0;
  return totals;
}

async function getFinanceCashOverview(
  fromDate: string,
  toDate: string,
  filters: FinanceFilters,
  current: FinanceMonthTotals
): Promise<FinanceCashOverview> {
  const pool = getPool();
  const revenueValues: unknown[] = [fromDate, toDate];
  const revenueFilterSql = buildRevenueFilterSql(filters, revenueValues);
  const enrollmentPaymentValues: unknown[] = [fromDate, toDate];
  const enrollmentPaymentFilterSql = buildEnrollmentFilterSql(filters, enrollmentPaymentValues);

  const branchValues: unknown[] = filters.branchId ? [fromDate, toDate, filters.branchId] : [fromDate, toDate];
  const branchFilter =
    (filters.branchId ? " AND branch_id = $3" : "") + businessUnitSql(filters, branchValues);
  const cashFixedValues: unknown[] = [fromDate, toDate, FIXED_EXPENSES_START_DATE];
  const cashFixedBusinessUnitSql = businessUnitSql(filters, cashFixedValues);

  const commissionConditions: string[] = [];
  const commissionValues: unknown[] = [fromDate, toDate];
  for (const [key, column] of [
    ["sellerId", "cm.seller_id"],
    ["courseId", "cm.course_id"],
    ["paymentMethodId", "cm.payment_method_id"],
  ] as const) {
    const value = filters[key];
    if (value) {
      commissionValues.push(value);
      commissionConditions.push(`${column} = $${commissionValues.length}`);
    }
  }
  const commissionFilterSql =
    (commissionConditions.length ? ` AND ${commissionConditions.join(" AND ")}` : "") +
    commissionBusinessUnitSql(filters, commissionValues);

  const [revenues, enrollmentPayments, fixed, variable, commissions, branch] = await Promise.all([
    // Receitas "legacy" (matrícula/lançamento antigo) mantêm exatamente o
    // cálculo original (amount - fee_amount por status). Receitas "avulso"
    // (novo fluxo de pagamentos parciais) usam o valor líquido/saldo real dos
    // pagamentos já registrados, em vez do valor bruto da venda.
    pool.query(
      `SELECT
          COALESCE(SUM(
            CASE WHEN r.revenue_mode = 'avulso' THEN COALESCE(pay.net_received, 0)
                 WHEN r.enrollment_id IS NOT NULL THEN 0
                 WHEN r.status = 'recebido' AND (r.enrollment_id IS NULL OR NOT EXISTS (
                   SELECT 1 FROM ${SCHEMA}.finance_enrollment_payments ep WHERE ep.enrollment_id = r.enrollment_id
                 )) THEN r.amount - r.fee_amount
                 ELSE 0 END
          ), 0) AS received,
          COALESCE(SUM(
            CASE WHEN r.revenue_mode = 'avulso' THEN GREATEST(r.amount - COALESCE(pay.paid, 0), 0)
                 WHEN r.enrollment_id IS NOT NULL THEN GREATEST(r.amount - ${ALLOCATED_PAID_SQL}, 0)
                 WHEN r.status IN ('previsto', 'atrasado') THEN r.amount - r.fee_amount
                 ELSE 0 END
          ), 0) AS to_receive
       FROM ${SCHEMA}.finance_revenues r
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS paid, SUM(net_amount) AS net_received
         FROM ${SCHEMA}.finance_revenue_payments WHERE revenue_id = r.id
       ) pay ON TRUE
       ${ENROLLMENT_ALLOCATION_JOIN}
       WHERE r.date >= $1 AND r.date < $2 AND r.status <> 'cancelado'${revenueFilterSql}`,
      revenueValues
    ),
    pool.query(
      `SELECT COALESCE(SUM(ep.net_amount), 0) AS received
       FROM ${SCHEMA}.finance_enrollment_payments ep
       JOIN ${SCHEMA}.finance_enrollments e ON e.id = ep.enrollment_id
       WHERE ep.payment_date >= $1 AND ep.payment_date < $2${enrollmentPaymentFilterSql}`,
      enrollmentPaymentValues
    ),
    pool.query(
      `SELECT
          COALESCE(SUM(amount + COALESCE(benefits_amount, 0)) FILTER (WHERE status = 'pago'), 0) AS paid,
          COALESCE(SUM(amount + COALESCE(benefits_amount, 0)) FILTER (WHERE status <> 'pago'), 0) AS to_pay
       FROM ${SCHEMA}.finance_fixed_expenses
       WHERE month >= $1 AND month < $2 AND month >= $3::date${cashFixedBusinessUnitSql}`,
      cashFixedValues
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM ${SCHEMA}.finance_variable_expenses
       WHERE date >= $1 AND date < $2${branchFilter}`,
      branchValues
    ),
    pool.query(
      `SELECT
          COALESCE(SUM(ci.amount) FILTER (WHERE ci.status = 'pago'), 0) AS paid,
          COALESCE(SUM(ci.amount) FILTER (WHERE ci.status = 'pendente'), 0) AS to_pay
       FROM ${SCHEMA}.finance_commission_installments ci
       JOIN ${SCHEMA}.finance_commissions cm ON cm.id = ci.commission_id
       WHERE ci.month >= $1 AND ci.month < $2${commissionFilterSql}`,
      commissionValues
    ),
    pool.query(
      `SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'pago'), 0) AS paid,
          COALESCE(SUM(amount) FILTER (WHERE status <> 'pago'), 0) AS to_pay
       FROM ${SCHEMA}.finance_branch_items
       WHERE date IS NOT NULL AND date >= $1 AND date < $2${branchFilter}`,
      branchValues
    ),
  ]);

  const received = num(revenues.rows[0]?.received) + num(enrollmentPayments.rows[0]?.received);
  const paid =
    num(fixed.rows[0]?.paid) +
    num(variable.rows[0]?.paid) +
    num(commissions.rows[0]?.paid) +
    num(branch.rows[0]?.paid);
  const toReceive = num(revenues.rows[0]?.to_receive);
  const toPay = num(fixed.rows[0]?.to_pay) + num(commissions.rows[0]?.to_pay) + num(branch.rows[0]?.to_pay);

  return {
    received: round2(received),
    paid: round2(paid),
    realizedNet: round2(received - paid),
    toReceive: round2(toReceive),
    toPay: round2(toPay),
    forecastNet: round2(toReceive - toPay),
    competenceRevenue: current.revenue,
    competenceExpenses: current.totalExpenses,
    monthProfit: current.profit,
  };
}

function mapAlertRows(rows: Array<Record<string, unknown>>): FinanceAlertGroup {
  const first = rows[0];
  return {
    count: Number(first?.total_count ?? 0),
    total: round2(num(first?.total_amount)),
    items: rows.map((row) => ({
      id: String(row.id),
      label: String(row.label ?? ""),
      amount: num(row.amount),
      date: toIsoDate(row.date),
      detail: (row.detail as string) ?? null,
    })),
  };
}

async function getFinanceAlerts(fromDate: string, toDate: string, filters: FinanceFilters): Promise<FinanceAlertsSummary> {
  const pool = getPool();

  const overdueRevenueValues: unknown[] = [];
  const overdueRevenueFilterSql = buildRevenueFilterSql(filters, overdueRevenueValues);

  const commissionConditions: string[] = [];
  const commissionValues: unknown[] = [fromDate, toDate];
  for (const [key, column] of [
    ["sellerId", "cm.seller_id"],
    ["courseId", "cm.course_id"],
    ["paymentMethodId", "cm.payment_method_id"],
  ] as const) {
    const value = filters[key];
    if (value) {
      commissionValues.push(value);
      commissionConditions.push(`${column} = $${commissionValues.length}`);
    }
  }
  const commissionFilterSql =
    (commissionConditions.length ? ` AND ${commissionConditions.join(" AND ")}` : "") +
    commissionBusinessUnitSql(filters, commissionValues);

  const [dueSoonBills, overdueBills, overdueRevenues, pendingCommissions] = await Promise.all([
    pool.query(
      `SELECT
          f.id::text AS id,
          f.description AS label,
          f.amount + COALESCE(f.benefits_amount, 0) AS amount,
          f.due_date AS date,
          COALESCE(c.name, 'Sem categoria') AS detail,
          COUNT(*) OVER () AS total_count,
          COALESCE(SUM(f.amount + COALESCE(f.benefits_amount, 0)) OVER (), 0) AS total_amount
       FROM ${SCHEMA}.finance_fixed_expenses f
       LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = f.category_id
       WHERE f.status <> 'pago'
         AND f.due_date >= CURRENT_DATE
         AND f.due_date <= CURRENT_DATE + INTERVAL '7 days'
       ORDER BY f.due_date ASC, f.description ASC
       LIMIT 5`
    ),
    pool.query(
      `SELECT
          f.id::text AS id,
          f.description AS label,
          f.amount + COALESCE(f.benefits_amount, 0) AS amount,
          f.due_date AS date,
          COALESCE(c.name, 'Sem categoria') AS detail,
          COUNT(*) OVER () AS total_count,
          COALESCE(SUM(f.amount + COALESCE(f.benefits_amount, 0)) OVER (), 0) AS total_amount
       FROM ${SCHEMA}.finance_fixed_expenses f
       LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = f.category_id
       WHERE f.status <> 'pago'
         AND (f.status = 'atrasado' OR f.due_date < CURRENT_DATE)
       ORDER BY f.due_date ASC NULLS LAST, f.description ASC
       LIMIT 5`
    ),
    pool.query(
      `SELECT
          r.id::text AS id,
          r.description AS label,
          CASE WHEN r.revenue_mode = 'avulso' THEN GREATEST(r.amount - COALESCE(pay.paid, 0), 0)
               WHEN r.enrollment_id IS NOT NULL THEN GREATEST(r.amount - ${ALLOCATED_PAID_SQL}, 0)
               ELSE r.amount - r.fee_amount END AS amount,
          COALESCE(r.due_date, r.date) AS date,
          COALESCE(r.student, co.name, 'Receita') AS detail,
          COUNT(*) OVER () AS total_count,
          COALESCE(SUM(CASE WHEN r.revenue_mode = 'avulso' THEN GREATEST(r.amount - COALESCE(pay.paid, 0), 0)
                            WHEN r.enrollment_id IS NOT NULL THEN GREATEST(r.amount - ${ALLOCATED_PAID_SQL}, 0)
                            ELSE r.amount - r.fee_amount END) OVER (), 0) AS total_amount
       FROM ${SCHEMA}.finance_revenues r
       LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = r.course_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(amount), 0) AS paid
         FROM ${SCHEMA}.finance_revenue_payments WHERE revenue_id = r.id
       ) pay ON TRUE
       ${ENROLLMENT_ALLOCATION_JOIN}
       WHERE r.status <> 'cancelado'
         AND COALESCE(r.due_date, r.date) < CURRENT_DATE
         AND (
           (r.enrollment_id IS NOT NULL AND r.amount > ${ALLOCATED_PAID_SQL})
           OR (r.enrollment_id IS NULL AND r.status <> 'recebido')
         )${overdueRevenueFilterSql}
       ORDER BY COALESCE(r.due_date, r.date) ASC, r.description ASC
       LIMIT 5`,
      overdueRevenueValues
    ),
    pool.query(
      `SELECT
          ci.id::text AS id,
          'Comissão - ' || s.name AS label,
          ci.amount AS amount,
          ci.month AS date,
          cm.student AS detail,
          COUNT(*) OVER () AS total_count,
          COALESCE(SUM(ci.amount) OVER (), 0) AS total_amount
       FROM ${SCHEMA}.finance_commission_installments ci
       JOIN ${SCHEMA}.finance_commissions cm ON cm.id = ci.commission_id
       JOIN ${SCHEMA}.finance_sellers s ON s.id = cm.seller_id
       WHERE ci.status = 'pendente'
         AND ci.month >= $1
         AND ci.month < $2${commissionFilterSql}
       ORDER BY ci.month ASC, s.name ASC
       LIMIT 5`,
      commissionValues
    ),
  ]);

  return {
    dueSoonBills: mapAlertRows(dueSoonBills.rows),
    overdueBills: mapAlertRows(overdueBills.rows),
    overdueRevenues: mapAlertRows(overdueRevenues.rows),
    pendingCommissions: mapAlertRows(pendingCommissions.rows),
  };
}

export async function getFinanceDashboardSummary(
  month: string,
  filters: FinanceFilters = {}
): Promise<FinanceDashboardSummary> {
  await ensureFinanceSchema();
  const periodFrom = filters.from || month;
  // Teto aplicado já aqui: `periodTo` alimenta fromDate/toDate, que por sua vez
  // recortam distribuições, fluxo de caixa e período de comparação. Sem isso um
  // recorte "junho a dezembro" continuaria somando a folha provisionada.
  const periodTo = clampMonthRange(periodFrom, filters.to || month).to;
  const span = countMonths(periodFrom, periodTo);
  const previousFrom = addMonths(periodFrom, -span);
  const previousTo = addMonths(periodTo, -span);

  // Só provisiona despesa fixa nos meses do próprio recorte e até o mês
  // corrente. Antes, abrir um mês futuro copiava a folha inteira do mês
  // anterior para lá, e o período de comparação chegava a semear folha de
  // pagamento em meses anteriores ao início da operação.
  const provisionLimit = currentMonth();
  let cursor = periodFrom;
  while (cursor <= periodTo) {
    if (cursor <= provisionLimit) await ensureFixedExpensesForMonth(cursor);
    cursor = addMonths(cursor, 1);
  }

  const monthly = await getMonthlyTotals(periodFrom, periodTo, filters);
  const previousMonthly = await getMonthlyTotals(previousFrom, previousTo, {
    ...filters,
    from: undefined,
    to: undefined,
  });
  const current = sumMonthTotals(monthly, periodFrom === periodTo ? periodFrom : `${periodFrom} a ${periodTo}`);
  const previous = sumMonthTotals(previousMonthly, previousFrom === previousTo ? previousFrom : `${previousFrom} a ${previousTo}`);

  const year = month.slice(0, 4);
  const yearStart = `${year}-01`;
  // O ano inteiro (e não só até o mês selecionado) porque a Consolidação
  // Trimestral precisa do trimestre fechado: derivar os trimestres do período
  // filtrado fazia "Q3" exibir apenas o mês que estava no filtro. Quando o
  // recorte é maior que o ano (modo "Tudo"), ele manda — aí os trimestres
  // cobrem todos os anos com movimento.
  const spanFrom = periodFrom < yearStart ? periodFrom : yearStart;
  const spanTo = periodTo > `${year}-12` ? periodTo : `${year}-12`;
  const spanMonthly = await getMonthlyTotals(spanFrom, spanTo, filters);
  const yearToDateMonthly = spanMonthly.filter((item) => item.month >= yearStart && item.month <= month);
  const yearRevenue = round2(yearToDateMonthly.reduce((s, m) => s + m.revenue, 0));
  const prevYearRevenue = round2(yearRevenue - current.revenue);

  const fromDate = monthToDate(periodFrom);
  const toDate = monthToDate(addMonths(periodTo, 1));
  const previousFromDate = monthToDate(previousFrom);
  const previousToDate = monthToDate(addMonths(previousTo, 1));
  const distributionValues: unknown[] = [fromDate, toDate];
  const revenueFilterSql = buildRevenueFilterSql(filters, distributionValues);
  // A distribuição de despesas soma três fontes numa consulta só (fixas,
  // comissões e variáveis); cada uma precisa do seu recorte de unidade, e os
  // três compartilham a mesma lista de parâmetros.
  const distUnitSql = (() => {
    const values: unknown[] = [fromDate, toDate];
    const fixed = businessUnitSql(filters, values, "f.");
    const commission = commissionBusinessUnitSql(filters, values);
    const variable = businessUnitSql(filters, values, "v.");
    return { values, fixed, commission, variable };
  })();

  const [expenseDistribution, revenueByCourse, revenueByBranch, commissionBySeller, paidCommissions, cashBalance, cashOverview, alerts, allTimeSpend] =
    await Promise.all([
      getDistribution(
        `SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(f.amount + COALESCE(f.benefits_amount, 0)) AS value
         FROM ${SCHEMA}.finance_fixed_expenses f
         LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = f.category_id
         WHERE f.month >= $1 AND f.month < $2 AND f.month >= '${FIXED_EXPENSES_START_DATE}'::date${distUnitSql.fixed}
         GROUP BY 1
         UNION ALL
         SELECT '${COMMISSION_EXPENSE_LABEL}' AS name, COALESCE(SUM(amount), 0) AS value
         FROM ${SCHEMA}.finance_commission_installments ci WHERE month >= $1 AND month < $2${distUnitSql.commission}
         UNION ALL
         SELECT COALESCE(c.name, 'Variáveis') AS name, SUM(v.amount) AS value
         FROM ${SCHEMA}.finance_variable_expenses v
         LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = v.category_id
         WHERE v.date >= $1 AND v.date < $2${distUnitSql.variable} GROUP BY 1`,
        distUnitSql.values
      ),
      getDistribution(
        `SELECT COALESCE(co.name, 'Sem curso') AS name, SUM(r.amount) AS value
         FROM ${SCHEMA}.finance_revenues r
         LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = r.course_id
         WHERE r.date >= $1 AND r.date < $2 AND r.status <> 'cancelado'${revenueFilterSql}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        distributionValues
      ),
      getDistribution(
        `SELECT COALESCE(b.name, 'Sem unidade') AS name, SUM(r.amount) AS value
         FROM ${SCHEMA}.finance_revenues r
         LEFT JOIN ${SCHEMA}.finance_branches b ON b.id = r.branch_id
         WHERE r.date >= $1 AND r.date < $2 AND r.status <> 'cancelado'${revenueFilterSql}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        distributionValues
      ),
      getDistribution(
        `SELECT s.name AS name, SUM(ci.amount) AS value
         FROM ${SCHEMA}.finance_commission_installments ci
         JOIN ${SCHEMA}.finance_commissions cm ON cm.id = ci.commission_id
         JOIN ${SCHEMA}.finance_sellers s ON s.id = cm.seller_id
         WHERE ci.month >= $1 AND ci.month < $2 GROUP BY 1 ORDER BY 2 DESC`,
        [fromDate, toDate]
      ),
      (() => {
          const values: unknown[] = [fromDate, toDate, previousFromDate, previousToDate];
          const unitSql = commissionBusinessUnitSql(filters, values);
          const prevUnitSql = commissionBusinessUnitSql(filters, values, "ci_prev");
          return getPool().query(
            `SELECT COALESCE(SUM(amount), 0) AS total,
                    (SELECT COALESCE(SUM(amount), 0) FROM ${SCHEMA}.finance_commission_installments ci_prev
                      WHERE month >= $3 AND month < $4 AND status = 'pago'${prevUnitSql}) AS prev_total
             FROM ${SCHEMA}.finance_commission_installments ci
             WHERE month >= $1 AND month < $2 AND status = 'pago'${unitSql}`,
            values
          );
        })(),
      getCashBalance(),
      getFinanceCashOverview(fromDate, toDate, filters, current),
      getFinanceAlerts(fromDate, toDate, filters),
      getAllTimeSpend(),
    ]);

  // Comissões geradas (legado, independente de status) e taxas de cartão
  // (legado) no período — somadas às fontes novas de pagamentos, inclusive
  // recebimentos flexíveis de matrícula, para alimentar os KPIs de
  // Comissões/Taxas sem duplicar contagem.
  const legacyValues: unknown[] = [fromDate, toDate];
  const legacyRevenueFilterSql = buildRevenueFilterSql(filters, legacyValues);
  const [commissionsGeneratedLegacyRow, cardFeesLegacyRow, revenuePaymentsAggRow, enrollmentPaymentsAggRow] = await Promise.all([
    (() => {
        const values: unknown[] = [fromDate, toDate];
        const unitSql = commissionBusinessUnitSql(filters, values);
        return getPool().query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_commission_installments ci
            WHERE month >= $1 AND month < $2${unitSql}`,
          values
        );
      })(),
    getPool().query(
      `SELECT COALESCE(SUM(r.fee_amount), 0) AS total
       FROM ${SCHEMA}.finance_revenues r
       WHERE r.date >= $1 AND r.date < $2 AND r.revenue_mode = 'legacy' AND r.status <> 'cancelado'${legacyRevenueFilterSql}`,
      legacyValues
    ),
    (() => {
      const values: unknown[] = [fromDate, toDate];
      const filterSql = buildRevenueFilterSql(filters, values);
      return getPool().query(
        `SELECT
            COALESCE(SUM(p.commission_amount), 0) AS commission_generated,
            COALESCE(SUM(p.commission_amount) FILTER (WHERE p.commission_status = 'paga'), 0) AS commission_paid,
            COALESCE(SUM(p.fee_amount) FILTER (WHERE p.payment_method = 'credito'), 0) AS card_fees,
            COALESCE(SUM(p.fee_amount) FILTER (WHERE p.payment_method = 'boleto'), 0) AS boleto_fees
         FROM ${SCHEMA}.finance_revenue_payments p
         JOIN ${SCHEMA}.finance_revenues r ON r.id = p.revenue_id
         WHERE p.payment_date >= $1 AND p.payment_date < $2${filterSql}`,
        values
      );
    })(),
    (() => {
      const values: unknown[] = [fromDate, toDate];
      const filterSql = buildEnrollmentFilterSql(filters, values);
      return getPool().query(
        `SELECT
            COALESCE(SUM(ep.fee_amount) FILTER (WHERE ep.payment_method = 'credito'), 0) AS card_fees,
            COALESCE(SUM(ep.fee_amount) FILTER (WHERE ep.payment_method = 'boleto'), 0) AS boleto_fees
         FROM ${SCHEMA}.finance_enrollment_payments ep
         JOIN ${SCHEMA}.finance_enrollments e ON e.id = ep.enrollment_id
         WHERE ep.payment_date >= $1 AND ep.payment_date < $2${filterSql}`,
        values
      );
    })(),
  ]);

  const paidNow = num(paidCommissions.rows[0]?.total);
  const paidPrev = num(paidCommissions.rows[0]?.prev_total);
  const commissionsGeneratedTotal = round2(num(commissionsGeneratedLegacyRow.rows[0]?.total) + num(revenuePaymentsAggRow.rows[0]?.commission_generated));
  const commissionsPaidTotal = round2(paidNow + num(revenuePaymentsAggRow.rows[0]?.commission_paid));
  const cardFeesTotal = round2(
    num(cardFeesLegacyRow.rows[0]?.total)
      + num(revenuePaymentsAggRow.rows[0]?.card_fees)
      + num(enrollmentPaymentsAggRow.rows[0]?.card_fees)
  );
  const boletoFeesTotal = round2(
    num(revenuePaymentsAggRow.rows[0]?.boleto_fees)
      + num(enrollmentPaymentsAggRow.rows[0]?.boleto_fees)
  );
  // Ticket = valor contratado ÷ vendas do período. Dividir a receita do mês
  // (que num parcelamento é só a parcela) pelo nº de vendas dava um ticket de
  // R$ 520 para cursos de R$ 5.000.
  const ticket = current.enrollmentsCount > 0 ? round2(current.enrollmentsAmount / current.enrollmentsCount) : 0;
  const prevTicket =
    previous && previous.enrollmentsCount > 0 ? round2(previous.enrollmentsAmount / previous.enrollmentsCount) : null;

  const kpis: FinanceKpi[] = [
    { key: "receita_mes", label: "Receita Recebida", value: current.revenue, previous: previous?.revenue ?? null, deltaPct: deltaPct(current.revenue, previous?.revenue ?? null), format: "currency", hint: "Soma bruta dos pagamentos registrados no período." },
    { key: "receita_anual", label: "Receita Anual", value: yearRevenue, previous: prevYearRevenue, deltaPct: deltaPct(yearRevenue, prevYearRevenue), format: "currency" },
    { key: "gastos_fixos", label: "Despesas Fixas", value: round2(current.fixedExpenses + current.commissions), previous: previous ? round2(previous.fixedExpenses + previous.commissions) : null, deltaPct: deltaPct(round2(current.fixedExpenses + current.commissions), previous ? round2(previous.fixedExpenses + previous.commissions) : null), format: "currency" },
    { key: "gastos_variaveis", label: "Despesas Variáveis", value: current.variableExpenses, previous: previous?.variableExpenses ?? null, deltaPct: deltaPct(current.variableExpenses, previous?.variableExpenses ?? null), format: "currency" },
    { key: "gastos_total_acumulado", label: "Gasto Total Acumulado", value: allTimeSpend.total, previous: null, deltaPct: null, format: "currency", hint: "Implantação + pré-operacional + fixas + variáveis, de todos os meses até o atual. Não desconta receita e não muda com o filtro de período." },
    { key: "lucro", label: "Lucro Líquido", value: current.profit, previous: previous?.profit ?? null, deltaPct: deltaPct(current.profit, previous?.profit ?? null), format: "currency", hint: "Resultado operacional do período (não inclui implantação da unidade)." },
    { key: "saldo", label: "Saldo em Caixa", value: cashBalance, previous: null, deltaPct: null, format: "currency", hint: "Acumulado de todos os meses, incluindo saldo inicial e implantação da unidade — não é o lucro do mês." },
    { key: "margem", label: "Margem de Lucro", value: current.margin, previous: previous?.margin ?? null, deltaPct: deltaPct(current.margin, previous?.margin ?? null), format: "percent" },
    { key: "comissoes_pagas", label: "Comissões Pagas", value: paidNow, previous: paidPrev, deltaPct: deltaPct(paidNow, paidPrev), format: "currency" },
    { key: "implantacao", label: "Custo de Implantação", value: current.branchSetup, previous: previous?.branchSetup ?? null, deltaPct: deltaPct(current.branchSetup, previous?.branchSetup ?? null), format: "currency" },
    { key: "matriculas", label: "Matrículas", value: current.enrollmentsCount, previous: previous?.enrollmentsCount ?? null, deltaPct: deltaPct(current.enrollmentsCount, previous?.enrollmentsCount ?? null), format: "number" },
    { key: "ticket", label: "Ticket Médio", value: ticket, previous: prevTicket, deltaPct: deltaPct(ticket, prevTicket), format: "currency", hint: "Valor contratado das matrículas vendidas no período ÷ nº de vendas." },
    { key: "receita_prevista", label: "Receita Prevista", value: current.revenueForecast, previous: previous?.revenueForecast ?? null, deltaPct: deltaPct(current.revenueForecast, previous?.revenueForecast ?? null), format: "currency", hint: "Soma das parcelas previstas para o período." },
    { key: "receita_pendente", label: "Receita Pendente", value: round2(current.revenueForecast - current.revenue), previous: previous ? round2(previous.revenueForecast - previous.revenue) : null, deltaPct: previous ? deltaPct(round2(current.revenueForecast - current.revenue), round2(previous.revenueForecast - previous.revenue)) : null, format: "currency", hint: "Receita prevista menos pagamentos registrados no período." },
    { key: "receita_bruta", label: "Receita Recebida (bruta)", value: current.revenue, previous: previous?.revenue ?? null, deltaPct: deltaPct(current.revenue, previous?.revenue ?? null), format: "currency", hint: "Pagamentos registrados no período, antes das taxas." },
    { key: "receita_liquida", label: "Recebido no Período (caixa)", value: cashOverview.received, previous: null, deltaPct: null, format: "currency", hint: "Dinheiro que entrou no período, líquido de taxas — pode quitar parcelas de outros meses." },
    { key: "comissoes_geradas", label: "Total Comissões Geradas", value: commissionsGeneratedTotal, previous: null, deltaPct: null, format: "currency" },
    { key: "comissoes_pagas_total", label: "Total Comissões Pagas", value: commissionsPaidTotal, previous: null, deltaPct: null, format: "currency" },
    { key: "taxas_cartao", label: "Total Taxas de Cartão", value: cardFeesTotal, previous: null, deltaPct: null, format: "currency" },
    { key: "taxas_boleto", label: "Total Taxas de Boleto", value: boletoFeesTotal, previous: null, deltaPct: null, format: "currency" },
    { key: "saldo_a_receber", label: "Saldo a Receber", value: cashOverview.toReceive, previous: null, deltaPct: null, format: "currency" },
  ];

  return {
    month,
    kpis,
    monthly,
    cashOverview,
    alerts,
    expenseDistribution,
    revenueByCourse,
    revenueByBranch,
    commissionBySeller,
    quarterly: toQuarterTotals(spanMonthly),
    cashBalance,
    allTimeSpend,
    effectivePeriod: {
      from: periodFrom,
      to: periodTo,
      requestedTo: filters.to || month,
      clamped: (filters.to || month) > periodTo,
      empty: monthly.length === 0,
    },
  };
}
