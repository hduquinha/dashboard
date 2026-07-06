import { getPool } from "@/lib/db";
import type {
  BranchItemCostKind,
  ExpenseStatus,
  FinanceBranchItem,
  FinanceCatalog,
  FinanceCategoryKind,
  FinanceCommission,
  FinanceCommissionInstallment,
  FinanceCommissionPanel,
  FinanceDashboardSummary,
  FinanceDistributionSlice,
  FinanceEnrollment,
  FinanceFilters,
  FinanceFixedExpense,
  FinanceKpi,
  FinanceMonthTotals,
  FinanceQuarterTotals,
  FinanceRevenue,
  FinanceVariableExpense,
  InstallmentStatus,
  RevenueStatus,
} from "@/types/finance";

const SCHEMA = "dashboard";

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

const REVENUE_STATUSES: RevenueStatus[] = ["previsto", "recebido", "atrasado", "cancelado"];
const EXPENSE_STATUSES: ExpenseStatus[] = ["pendente", "pago", "atrasado"];
const MAX_INVOICE_BYTES = 8 * 1024 * 1024;

export function normalizeRevenueStatus(value: unknown): RevenueStatus {
  return REVENUE_STATUSES.includes(value as RevenueStatus) ? (value as RevenueStatus) : "previsto";
}

export function normalizeExpenseStatus(value: unknown): ExpenseStatus {
  return EXPENSE_STATUSES.includes(value as ExpenseStatus) ? (value as ExpenseStatus) : "pendente";
}

type InvoiceTableName = "finance_fixed_expenses" | "finance_variable_expenses" | "finance_branch_items";

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

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_installment_rates (
      installments INTEGER PRIMARY KEY CHECK (installments BETWEEN 1 AND 24),
      rate_pct NUMERIC NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.finance_enrollments (
      id BIGSERIAL PRIMARY KEY,
      student TEXT NOT NULL,
      course_id BIGINT REFERENCES ${SCHEMA}.finance_courses(id),
      total_amount NUMERIC NOT NULL,
      installments INTEGER NOT NULL DEFAULT 1,
      payment_method_id BIGINT REFERENCES ${SCHEMA}.finance_payment_methods(id),
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
      invoice_url TEXT,
      invoice_file BYTEA,
      invoice_filename TEXT,
      invoice_mime TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_finance_revenues_date ON ${SCHEMA}.finance_revenues(date);
    CREATE INDEX IF NOT EXISTS idx_finance_revenues_enrollment ON ${SCHEMA}.finance_revenues(enrollment_id);
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
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
      ALTER TABLE ${SCHEMA}.finance_variable_expenses
        ADD COLUMN IF NOT EXISTS invoice_url TEXT,
        ADD COLUMN IF NOT EXISTS invoice_file BYTEA,
        ADD COLUMN IF NOT EXISTS invoice_filename TEXT,
        ADD COLUMN IF NOT EXISTS invoice_mime TEXT;
    `);

    await dedupeFixedExpenseDuplicates();
    await getPool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fixed_unique_general
        ON ${SCHEMA}.finance_fixed_expenses (month, LOWER(description), COALESCE(category_id, 0::bigint))
        WHERE kind = 'geral';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fixed_unique_payroll
        ON ${SCHEMA}.finance_fixed_expenses (month, employee_id)
        WHERE kind = 'folha' AND employee_id IS NOT NULL;
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
const DEFAULT_PAYMENT_METHODS: Array<{ name: string; kind: "avista" | "parcelado" }> = [
  { name: "PIX", kind: "avista" },
  { name: "Débito", kind: "avista" },
  { name: "Dinheiro", kind: "avista" },
  { name: "Transferência", kind: "avista" },
  { name: "Crédito à Vista", kind: "avista" },
  { name: "Cartão Parcelado", kind: "parcelado" },
  { name: "Boleto Parcelado", kind: "parcelado" },
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
      `INSERT INTO ${SCHEMA}.finance_payment_methods (name, kind) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [method.name, method.kind]
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

  for (let n = 1; n <= 12; n += 1) {
    await pool.query(
      `INSERT INTO ${SCHEMA}.finance_installment_rates (installments, rate_pct) VALUES ($1, 0)
       ON CONFLICT (installments) DO NOTHING`,
      [n]
    );
  }

  await pool.query(
    `INSERT INTO ${SCHEMA}.finance_settings (key, value) VALUES ('saldo_inicial', '0'::jsonb)
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
  const [categories, methods, courses, branches, employees, sellers, rates, settings] =
    await Promise.all([
      pool.query(`SELECT * FROM ${SCHEMA}.finance_categories ORDER BY kind, sort, name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_payment_methods ORDER BY id`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_courses ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_branches ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_employees ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_sellers ORDER BY name`),
      pool.query(`SELECT * FROM ${SCHEMA}.finance_installment_rates ORDER BY installments`),
      pool.query(`SELECT value FROM ${SCHEMA}.finance_settings WHERE key = 'saldo_inicial'`),
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
    installmentRates: rates.rows.map((r) => ({
      installments: Number(r.installments),
      ratePct: num(r.rate_pct),
    })),
    initialBalance: num(settings.rows[0]?.value),
  };
}

interface CatalogEntityDef {
  table: string;
  columns: Record<string, string>; // apiField -> column
}

/** Entidades de catálogo com CRUD genérico em /api/finance/catalog/:entity. */
export const CATALOG_ENTITIES: Record<string, CatalogEntityDef> = {
  categories: {
    table: "finance_categories",
    columns: { kind: "kind", name: "name", active: "active" },
  },
  "payment-methods": {
    table: "finance_payment_methods",
    columns: { name: "name", kind: "kind", active: "active" },
  },
  courses: {
    table: "finance_courses",
    columns: { name: "name", defaultPrice: "default_price", active: "active" },
  },
  branches: {
    table: "finance_branches",
    columns: { name: "name", city: "city", active: "active" },
  },
  employees: {
    table: "finance_employees",
    columns: { name: "name", role: "role", salary: "salary", benefits: "benefits", active: "active" },
  },
  sellers: {
    table: "finance_sellers",
    columns: { name: "name", defaultPct: "default_pct", active: "active" },
  },
};

export async function createCatalogEntity(
  entity: string,
  payload: Record<string, unknown>
): Promise<number> {
  await ensureFinanceSchema();
  const def = CATALOG_ENTITIES[entity];
  if (!def) throw new Error("Entidade inválida.");
  const fields = Object.entries(def.columns).filter(([api]) => payload[api] !== undefined);
  if (fields.length === 0) throw new Error("Nada para salvar.");
  const cols = fields.map(([, col]) => col);
  const values = fields.map(([api]) => payload[api]);
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
  const fields = Object.entries(def.columns).filter(([api]) => payload[api] !== undefined);
  if (fields.length === 0) return;
  const sets = fields.map(([, col], i) => `${col} = $${i + 2}`);
  await getPool().query(
    `UPDATE ${SCHEMA}.${def.table} SET ${sets.join(", ")} WHERE id = $1`,
    [id, ...fields.map(([api]) => payload[api])]
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
  rates: Array<{ installments: number; ratePct: number }>
): Promise<void> {
  await ensureFinanceSchema();
  for (const rate of rates) {
    const n = Math.trunc(rate.installments);
    if (!Number.isFinite(n) || n < 1 || n > 24) continue;
    await getPool().query(
      `INSERT INTO ${SCHEMA}.finance_installment_rates (installments, rate_pct) VALUES ($1, $2)
       ON CONFLICT (installments) DO UPDATE SET rate_pct = EXCLUDED.rate_pct`,
      [n, num(rate.ratePct)]
    );
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

// ── Receitas ─────────────────────────────────────────────────────

const REVENUE_SELECT = `
  SELECT r.*, c.name AS category_name, co.name AS course_name, b.name AS branch_name,
         pm.name AS payment_method_name, s.name AS seller_name
  FROM ${SCHEMA}.finance_revenues r
  LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = r.category_id
  LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = r.course_id
  LEFT JOIN ${SCHEMA}.finance_branches b ON b.id = r.branch_id
  LEFT JOIN ${SCHEMA}.finance_payment_methods pm ON pm.id = r.payment_method_id
  LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = r.seller_id
`;

function mapRevenue(r: Record<string, unknown>): FinanceRevenue {
  return {
    id: Number(r.id),
    date: toIsoDate(r.date) ?? "",
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
    amount: num(r.amount),
    feeAmount: num(r.fee_amount),
    status: normalizeRevenueStatus(r.status),
    enrollmentId: r.enrollment_id === null ? null : Number(r.enrollment_id),
    installmentNumber: r.installment_number === null ? null : Number(r.installment_number),
    notes: (r.notes as string) ?? null,
  };
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
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `${REVENUE_SELECT} ${where} ORDER BY r.date DESC, r.id DESC LIMIT 2000`,
    values
  );
  return rows.map(mapRevenue);
}

export interface RevenueInput {
  date: string;
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
}

export async function createRevenue(input: RevenueInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.description?.trim()) throw new Error("Descrição é obrigatória.");
  if (!Number.isFinite(input.amount)) throw new Error("Valor inválido.");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_revenues
       (date, description, category_id, origin, student, course_id, branch_id, payment_method_id, seller_id, amount, fee_amount, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      normalizeRevenueStatus(input.status),
      input.notes?.trim() || null,
    ]
  );
  return Number(rows[0].id);
}

export async function updateRevenue(id: number, input: Partial<RevenueInput>): Promise<void> {
  await ensureFinanceSchema();
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
    status: input.status !== undefined ? normalizeRevenueStatus(input.status) : undefined,
    notes: input.notes,
  };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_revenues SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
    [id, ...entries.map(([, v]) => v)]
  );
}

export async function deleteRevenue(id: number): Promise<void> {
  await ensureFinanceSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_revenues WHERE id = $1`, [id]);
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
  };
}

async function findCategoryId(kind: FinanceCategoryKind, name: string): Promise<number | null> {
  const { rows } = await getPool().query(
    `SELECT id FROM ${SCHEMA}.finance_categories WHERE kind = $1 AND name = $2 LIMIT 1`,
    [kind, name]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Garante os lançamentos fixos do mês: no primeiro acesso copia os itens do mês
 * anterior (valores e vencimentos, status zerado) — ou o modelo padrão quando
 * ainda não há histórico — e cria uma linha de folha por funcionário ativo.
 */
export async function ensureFixedExpensesForMonth(month: string): Promise<void> {
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
        `INSERT INTO ${SCHEMA}.finance_fixed_expenses (month, description, category_id, due_date, amount, notes, kind)
         SELECT $1::date, description, category_id,
                CASE WHEN due_date IS NULL THEN NULL
                     ELSE ($1::date + (LEAST(EXTRACT(DAY FROM due_date), 28) - 1) * INTERVAL '1 day')::date END,
                amount, notes, kind
         FROM (
           SELECT DISTINCT ON (LOWER(description), COALESCE(category_id, 0::bigint))
                  description, category_id, due_date, amount, notes, kind, id
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
         (month, description, category_id, amount, benefits_amount, employee_id, kind)
       SELECT $1::date, name, $2::bigint, salary, benefits, id, 'folha'
       FROM ${SCHEMA}.finance_employees e
       WHERE active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.finance_fixed_expenses f
           WHERE f.month = $1::date AND f.kind = 'folha' AND f.employee_id = e.id
         )`,
      [monthDate, payrollCategoryId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listFixedExpenses(month: string): Promise<FinanceFixedExpense[]> {
  await ensureFixedExpensesForMonth(month);
  const { rows } = await getPool().query(
    `${FIXED_SELECT} WHERE f.month = $1 ORDER BY f.kind, f.description`,
    [monthToDate(month)]
  );
  return rows.map(mapFixed);
}

export interface FixedExpenseInput {
  month: string;
  description: string;
  categoryId?: number | null;
  dueDate?: string | null;
  amount: number;
  benefitsAmount?: number | null;
  status?: ExpenseStatus;
  paidAt?: string | null;
  notes?: string | null;
  invoiceUrl?: string | null;
}

export async function createFixedExpense(input: FixedExpenseInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.description?.trim()) throw new Error("Descrição é obrigatória.");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_fixed_expenses
       (month, description, category_id, due_date, amount, benefits_amount, status, paid_at, notes, invoice_url, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'geral') RETURNING id`,
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
    ]
  );
  return Number(rows[0].id);
}

export async function updateFixedExpense(id: number, input: Partial<FixedExpenseInput>): Promise<void> {
  await ensureFinanceSchema();
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
  };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_fixed_expenses SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
    [id, ...entries.map(([, v]) => v)]
  );
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
    `INSERT INTO ${SCHEMA}.finance_variable_expenses (date, description, category_id, branch_id, amount, notes, invoice_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.date,
      input.description.trim(),
      input.categoryId ?? null,
      input.branchId ?? null,
      round2(input.amount ?? 0),
      input.notes?.trim() || null,
      input.invoiceUrl?.trim() || null,
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

export interface EnrollmentInput {
  student: string;
  courseId?: number | null;
  totalAmount: number;
  installments: number;
  paymentMethodId?: number | null;
  firstMonth: string; // YYYY-MM
  saleDate: string;
  sellerId?: number | null;
  branchId?: number | null;
  notes?: string | null;
}

/**
 * Cadastra a matrícula e gera automaticamente uma receita por parcela nos
 * meses correspondentes (categoria Matrícula, com taxa do cartão embutida em
 * fee_amount a partir da tabela de taxas) — sem lançamento manual.
 */
export async function createEnrollment(input: EnrollmentInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.student?.trim()) throw new Error("Aluno é obrigatório.");
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw new Error("Valor do curso inválido.");
  const installments = Math.max(1, Math.min(24, Math.trunc(input.installments || 1)));

  const pool = getPool();
  const { rows: rateRows } = await pool.query(
    `SELECT rate_pct FROM ${SCHEMA}.finance_installment_rates WHERE installments = $1`,
    [installments]
  );
  const ratePct = num(rateRows[0]?.rate_pct);
  const categoryId = await findCategoryId("receita", "Matrícula");

  const { rows: courseRows } = input.courseId
    ? await pool.query(`SELECT name FROM ${SCHEMA}.finance_courses WHERE id = $1`, [input.courseId])
    : { rows: [] as Array<{ name: string }> };
  const courseName = courseRows[0]?.name ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.finance_enrollments
         (student, course_id, total_amount, installments, payment_method_id, first_month, sale_date, seller_id, branch_id, rate_pct, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        input.student.trim(),
        input.courseId ?? null,
        round2(input.totalAmount),
        installments,
        input.paymentMethodId ?? null,
        monthToDate(input.firstMonth),
        input.saleDate,
        input.sellerId ?? null,
        input.branchId ?? null,
        ratePct,
        input.notes?.trim() || null,
      ]
    );
    const enrollmentId = Number(rows[0].id);

    const parts = splitInstallments(input.totalAmount, installments);
    for (let i = 0; i < parts.length; i += 1) {
      const month = addMonths(input.firstMonth, i);
      const description =
        installments === 1
          ? `Matrícula — ${input.student.trim()}${courseName ? ` (${courseName})` : ""}`
          : `Matrícula — ${input.student.trim()}${courseName ? ` (${courseName})` : ""} · parcela ${i + 1}/${installments}`;
      await client.query(
        `INSERT INTO ${SCHEMA}.finance_revenues
           (date, description, category_id, origin, student, course_id, branch_id, payment_method_id, seller_id, amount, fee_amount, status, enrollment_id, installment_number)
         VALUES ($1, $2, $3, 'Matrícula parcelada', $4, $5, $6, $7, $8, $9, $10, 'previsto', $11, $12)`,
        [
          monthToDate(month),
          description,
          categoryId,
          input.student.trim(),
          input.courseId ?? null,
          input.branchId ?? null,
          input.paymentMethodId ?? null,
          input.sellerId ?? null,
          parts[i],
          round2((parts[i] * ratePct) / 100),
          enrollmentId,
          i + 1,
        ]
      );
    }
    await client.query("COMMIT");
    return enrollmentId;
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
  return {
    id: Number(r.id),
    student: String(r.student ?? ""),
    courseId: r.course_id === null ? null : Number(r.course_id),
    courseName: (r.course_name as string) ?? null,
    totalAmount: total,
    installments: Number(r.installments),
    paymentMethodId: r.payment_method_id === null ? null : Number(r.payment_method_id),
    paymentMethodName: (r.payment_method_name as string) ?? null,
    firstMonth: dateToMonth(r.first_month),
    saleDate: toIsoDate(r.sale_date) ?? "",
    sellerId: r.seller_id === null ? null : Number(r.seller_id),
    sellerName: (r.seller_name as string) ?? null,
    branchId: r.branch_id === null ? null : Number(r.branch_id),
    branchName: (r.branch_name as string) ?? null,
    ratePct: num(r.rate_pct),
    feeTotal,
    netTotal: round2(total - feeTotal),
    notes: (r.notes as string) ?? null,
  };
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
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT e.*, co.name AS course_name, pm.name AS payment_method_name, s.name AS seller_name, b.name AS branch_name,
            COALESCE((SELECT SUM(fee_amount) FROM ${SCHEMA}.finance_revenues r WHERE r.enrollment_id = e.id), 0) AS fee_total
     FROM ${SCHEMA}.finance_enrollments e
     LEFT JOIN ${SCHEMA}.finance_courses co ON co.id = e.course_id
     LEFT JOIN ${SCHEMA}.finance_payment_methods pm ON pm.id = e.payment_method_id
     LEFT JOIN ${SCHEMA}.finance_sellers s ON s.id = e.seller_id
     LEFT JOIN ${SCHEMA}.finance_branches b ON b.id = e.branch_id
     ${where} ORDER BY e.sale_date DESC, e.id DESC LIMIT 1000`,
    values
  );
  return rows.map(mapEnrollment);
}

export async function deleteEnrollment(id: number): Promise<void> {
  await ensureFinanceSchema();
  // Receitas geradas caem junto (FK ON DELETE CASCADE).
  await getPool().query(`DELETE FROM ${SCHEMA}.finance_enrollments WHERE id = $1`, [id]);
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
    `SELECT s.id AS seller_id, s.name AS seller_name,
            COALESCE(SUM(ci.amount) FILTER (WHERE ci.month = $1::date), 0) AS month_total,
            COALESCE(SUM(ci.amount) FILTER (WHERE EXTRACT(YEAR FROM ci.month) = $2::int), 0) AS year_total,
            COALESCE(SUM(ci.amount) FILTER (WHERE ci.status = 'pago'), 0) AS paid_total,
            COALESCE(SUM(ci.amount) FILTER (WHERE ci.status = 'pendente'), 0) AS pending_total
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
            bi.cost_kind, bi.invoice_url, bi.invoice_filename, bi.notes,
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
  invoiceUrl?: string | null;
  notes?: string | null;
}

export async function createBranchItem(input: BranchItemInput): Promise<number> {
  await ensureFinanceSchema();
  if (!input.branchId) throw new Error("Filial é obrigatória.");
  if (!input.item?.trim()) throw new Error("Item é obrigatório.");
  const { rows } = await getPool().query(
    `INSERT INTO ${SCHEMA}.finance_branch_items
       (branch_id, item, category, supplier, amount, date, status, cost_kind, invoice_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      input.branchId,
      input.item.trim(),
      input.category?.trim() || "Outros",
      input.supplier?.trim() || null,
      round2(input.amount ?? 0),
      input.date || null,
      normalizeExpenseStatus(input.status),
      input.costKind === "variavel" ? "variavel" : "fixo",
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
  return conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
}

/** Totais mensais consolidados entre `from` e `to` (inclusive), mês a mês. */
export async function getMonthlyTotals(
  from: string,
  to: string,
  filters: FinanceFilters = {}
): Promise<FinanceMonthTotals[]> {
  await ensureFinanceSchema();
  const pool = getPool();
  const fromDate = monthToDate(from);
  const toDate = monthToDate(addMonths(to, 1));

  const revenueValues: unknown[] = [fromDate, toDate];
  const revenueFilterSql = buildRevenueFilterSql(filters, revenueValues);
  const [revenues, fixed, variable, commissions, branchSetup, enrollments] = await Promise.all([
    pool.query(
      `SELECT date_trunc('month', r.date)::date AS month,
              COALESCE(SUM(r.amount) FILTER (WHERE r.status <> 'cancelado'), 0) AS revenue,
              COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'previsto'), 0) AS forecast,
              COALESCE(SUM(r.fee_amount) FILTER (WHERE r.status <> 'cancelado'), 0) AS fees
       FROM ${SCHEMA}.finance_revenues r
       WHERE r.date >= $1 AND r.date < $2${revenueFilterSql}
       GROUP BY 1`,
      revenueValues
    ),
    pool.query(
      `SELECT month, COALESCE(SUM(amount + COALESCE(benefits_amount, 0)), 0) AS total
       FROM ${SCHEMA}.finance_fixed_expenses WHERE month >= $1 AND month < $2 GROUP BY month`,
      [fromDate, toDate]
    ),
    pool.query(
      `SELECT date_trunc('month', date)::date AS month, COALESCE(SUM(amount), 0) AS total
       FROM ${SCHEMA}.finance_variable_expenses WHERE date >= $1 AND date < $2 GROUP BY 1`,
      [fromDate, toDate]
    ),
    pool.query(
      `SELECT month, COALESCE(SUM(amount), 0) AS total
       FROM ${SCHEMA}.finance_commission_installments WHERE month >= $1 AND month < $2 GROUP BY month`,
      [fromDate, toDate]
    ),
    pool.query(
      `SELECT date_trunc('month', date)::date AS month, COALESCE(SUM(amount), 0) AS total
       FROM ${SCHEMA}.finance_branch_items WHERE date IS NOT NULL AND date >= $1 AND date < $2 GROUP BY 1`,
      [fromDate, toDate]
    ),
    pool.query(
      `SELECT date_trunc('month', sale_date)::date AS month, COUNT(*)::int AS total
       FROM ${SCHEMA}.finance_enrollments WHERE sale_date >= $1 AND sale_date < $2 GROUP BY 1`,
      [fromDate, toDate]
    ),
  ]);

  const byMonth = new Map<string, FinanceMonthTotals>();
  let cursor = from;
  while (cursor <= to) {
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
    t.revenue = num(r.revenue);
    t.revenueForecast = num(r.forecast);
    t.cardFees = num(r.fees);
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
  });

  for (const totals of byMonth.values()) {
    // Comissões alimentam os gastos fixos do mês (linha calculada, não gravada).
    totals.totalExpenses = round2(totals.fixedExpenses + totals.commissions + totals.variableExpenses);
    totals.profit = round2(totals.revenue - totals.totalExpenses);
    totals.margin = totals.revenue > 0 ? round2((totals.profit / totals.revenue) * 100) : 0;
  }

  return Array.from(byMonth.values());
}

/** Saldo em caixa: saldo inicial + tudo que foi efetivamente recebido − pago. */
export async function getCashBalance(): Promise<number> {
  await ensureFinanceSchema();
  const pool = getPool();
  const [settings, received, fixedPaid, variableTotal, commissionsPaid, branchPaid] = await Promise.all([
    pool.query(`SELECT value FROM ${SCHEMA}.finance_settings WHERE key = 'saldo_inicial'`),
    pool.query(`SELECT COALESCE(SUM(amount - fee_amount), 0) AS total FROM ${SCHEMA}.finance_revenues WHERE status = 'recebido'`),
    pool.query(`SELECT COALESCE(SUM(amount + COALESCE(benefits_amount, 0)), 0) AS total FROM ${SCHEMA}.finance_fixed_expenses WHERE status = 'pago'`),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_variable_expenses`),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_commission_installments WHERE status = 'pago'`),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM ${SCHEMA}.finance_branch_items WHERE status = 'pago'`),
  ]);
  return round2(
    num(settings.rows[0]?.value) +
      num(received.rows[0]?.total) -
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
  }

  totals.totalExpenses = round2(totals.fixedExpenses + totals.commissions + totals.variableExpenses);
  totals.profit = round2(totals.revenue - totals.totalExpenses);
  totals.margin = totals.revenue > 0 ? round2((totals.profit / totals.revenue) * 100) : 0;
  return totals;
}

export async function getFinanceDashboardSummary(
  month: string,
  filters: FinanceFilters = {}
): Promise<FinanceDashboardSummary> {
  await ensureFinanceSchema();
  const periodFrom = filters.from || month;
  const periodTo = filters.to || month;
  const span = countMonths(periodFrom, periodTo);
  const previousFrom = addMonths(periodFrom, -span);
  const previousTo = addMonths(periodTo, -span);

  let cursor = previousFrom;
  while (cursor <= periodTo) {
    await ensureFixedExpensesForMonth(cursor);
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
  const yearMonthly = await getMonthlyTotals(yearStart, month, filters);
  const yearRevenue = round2(yearMonthly.reduce((s, m) => s + m.revenue, 0));
  const prevYearRevenue = round2(yearRevenue - current.revenue);

  const fromDate = monthToDate(periodFrom);
  const toDate = monthToDate(addMonths(periodTo, 1));
  const previousFromDate = monthToDate(previousFrom);
  const previousToDate = monthToDate(addMonths(previousTo, 1));
  const distributionValues: unknown[] = [fromDate, toDate];
  const revenueFilterSql = buildRevenueFilterSql(filters, distributionValues);

  const [expenseDistribution, revenueByCourse, revenueByBranch, commissionBySeller, paidCommissions, cashBalance] =
    await Promise.all([
      getDistribution(
        `SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(f.amount + COALESCE(f.benefits_amount, 0)) AS value
         FROM ${SCHEMA}.finance_fixed_expenses f
         LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = f.category_id
         WHERE f.month >= $1 AND f.month < $2
         GROUP BY 1
         UNION ALL
         SELECT '${COMMISSION_EXPENSE_LABEL}' AS name, COALESCE(SUM(amount), 0) AS value
         FROM ${SCHEMA}.finance_commission_installments WHERE month >= $1 AND month < $2
         UNION ALL
         SELECT COALESCE(c.name, 'Variáveis') AS name, SUM(v.amount) AS value
         FROM ${SCHEMA}.finance_variable_expenses v
         LEFT JOIN ${SCHEMA}.finance_categories c ON c.id = v.category_id
         WHERE v.date >= $1 AND v.date < $2 GROUP BY 1`,
        [fromDate, toDate]
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
      getPool().query(
        `SELECT COALESCE(SUM(amount), 0) AS total,
                (SELECT COALESCE(SUM(amount), 0) FROM ${SCHEMA}.finance_commission_installments WHERE month >= $3 AND month < $4 AND status = 'pago') AS prev_total
         FROM ${SCHEMA}.finance_commission_installments WHERE month >= $1 AND month < $2 AND status = 'pago'`,
        [fromDate, toDate, previousFromDate, previousToDate]
      ),
      getCashBalance(),
    ]);

  const paidNow = num(paidCommissions.rows[0]?.total);
  const paidPrev = num(paidCommissions.rows[0]?.prev_total);
  const ticket = current.enrollmentsCount > 0 ? round2(current.revenue / current.enrollmentsCount) : 0;
  const prevTicket =
    previous && previous.enrollmentsCount > 0 ? round2(previous.revenue / previous.enrollmentsCount) : null;

  const kpis: FinanceKpi[] = [
    { key: "receita_mes", label: "Receita do Mês", value: current.revenue, previous: previous?.revenue ?? null, deltaPct: deltaPct(current.revenue, previous?.revenue ?? null), format: "currency" },
    { key: "receita_anual", label: "Receita Anual", value: yearRevenue, previous: prevYearRevenue, deltaPct: deltaPct(yearRevenue, prevYearRevenue), format: "currency" },
    { key: "gastos_fixos", label: "Despesas Fixas", value: round2(current.fixedExpenses + current.commissions), previous: previous ? round2(previous.fixedExpenses + previous.commissions) : null, deltaPct: deltaPct(round2(current.fixedExpenses + current.commissions), previous ? round2(previous.fixedExpenses + previous.commissions) : null), format: "currency" },
    { key: "gastos_variaveis", label: "Despesas Variáveis", value: current.variableExpenses, previous: previous?.variableExpenses ?? null, deltaPct: deltaPct(current.variableExpenses, previous?.variableExpenses ?? null), format: "currency" },
    { key: "lucro", label: "Lucro Líquido", value: current.profit, previous: previous?.profit ?? null, deltaPct: deltaPct(current.profit, previous?.profit ?? null), format: "currency" },
    { key: "saldo", label: "Saldo em Caixa", value: cashBalance, previous: null, deltaPct: null, format: "currency" },
    { key: "margem", label: "Margem de Lucro", value: current.margin, previous: previous?.margin ?? null, deltaPct: deltaPct(current.margin, previous?.margin ?? null), format: "percent" },
    { key: "comissoes_pagas", label: "Comissões Pagas", value: paidNow, previous: paidPrev, deltaPct: deltaPct(paidNow, paidPrev), format: "currency" },
    { key: "implantacao", label: "Custo de Implantação", value: current.branchSetup, previous: previous?.branchSetup ?? null, deltaPct: deltaPct(current.branchSetup, previous?.branchSetup ?? null), format: "currency" },
    { key: "matriculas", label: "Matrículas", value: current.enrollmentsCount, previous: previous?.enrollmentsCount ?? null, deltaPct: deltaPct(current.enrollmentsCount, previous?.enrollmentsCount ?? null), format: "number" },
    { key: "ticket", label: "Ticket Médio", value: ticket, previous: prevTicket, deltaPct: deltaPct(ticket, prevTicket), format: "currency" },
    { key: "receita_prevista", label: "Receita Prevista", value: current.revenueForecast, previous: previous?.revenueForecast ?? null, deltaPct: deltaPct(current.revenueForecast, previous?.revenueForecast ?? null), format: "currency" },
  ];

  return {
    month,
    kpis,
    monthly,
    expenseDistribution,
    revenueByCourse,
    revenueByBranch,
    commissionBySeller,
    quarterly: toQuarterTotals(monthly),
    cashBalance,
  };
}
