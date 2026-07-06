// Tipos compartilhados do módulo de Gestão Financeira (VozUP).
// Valores monetários sempre em reais (number); meses como "YYYY-MM".

export type FinanceCategoryKind = "receita" | "gasto_fixo" | "gasto_variavel";
export type RevenueStatus = "previsto" | "recebido" | "atrasado" | "cancelado";
export type ExpenseStatus = "pendente" | "pago" | "atrasado";
export type InstallmentStatus = "pendente" | "pago";
export type BranchItemCostKind = "fixo" | "variavel";
export type PaymentMethodKind = "avista" | "parcelado";

export interface FinanceCategory {
  id: number;
  kind: FinanceCategoryKind;
  name: string;
  active: boolean;
}

export interface FinancePaymentMethod {
  id: number;
  name: string;
  kind: PaymentMethodKind;
  active: boolean;
}

export interface FinanceCourse {
  id: number;
  name: string;
  defaultPrice: number | null;
  active: boolean;
}

export interface FinanceBranch {
  id: number;
  name: string;
  city: string | null;
  active: boolean;
}

export interface FinanceEmployee {
  id: number;
  name: string;
  role: string | null;
  salary: number;
  benefits: number;
  active: boolean;
}

export interface FinanceSeller {
  id: number;
  name: string;
  defaultPct: number;
  active: boolean;
}

export interface FinanceInstallmentRate {
  installments: number;
  ratePct: number;
}

/** Catálogos usados pelos formulários do módulo inteiro. */
export interface FinanceCatalog {
  categories: FinanceCategory[];
  paymentMethods: FinancePaymentMethod[];
  courses: FinanceCourse[];
  branches: FinanceBranch[];
  employees: FinanceEmployee[];
  sellers: FinanceSeller[];
  installmentRates: FinanceInstallmentRate[];
  initialBalance: number;
}

export interface FinanceRevenue {
  id: number;
  date: string; // YYYY-MM-DD
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  origin: string | null;
  student: string | null;
  courseId: number | null;
  courseName: string | null;
  branchId: number | null;
  branchName: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  sellerId: number | null;
  sellerName: string | null;
  amount: number;
  feeAmount: number;
  status: RevenueStatus;
  enrollmentId: number | null;
  installmentNumber: number | null;
  notes: string | null;
}

export interface FinanceFixedExpense {
  id: number;
  month: string; // YYYY-MM
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  dueDate: string | null;
  amount: number;
  /** Benefícios (apenas linhas de folha de pagamento). */
  benefitsAmount: number | null;
  status: ExpenseStatus;
  paidAt: string | null;
  notes: string | null;
  invoiceUrl: string | null;
  hasInvoiceFile: boolean;
  invoiceFilename: string | null;
  employeeId: number | null;
  employeeName: string | null;
  kind: "geral" | "folha";
}

export interface FinanceVariableExpense {
  id: number;
  date: string;
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  branchId: number | null;
  branchName: string | null;
  amount: number;
  notes: string | null;
  invoiceUrl: string | null;
  hasInvoiceFile: boolean;
  invoiceFilename: string | null;
}

export interface FinanceEnrollment {
  id: number;
  student: string;
  courseId: number | null;
  courseName: string | null;
  totalAmount: number;
  installments: number;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  firstMonth: string; // YYYY-MM
  saleDate: string;
  sellerId: number | null;
  sellerName: string | null;
  branchId: number | null;
  branchName: string | null;
  ratePct: number;
  feeTotal: number;
  netTotal: number;
  notes: string | null;
}

export interface FinanceCommissionInstallment {
  id: number;
  commissionId: number;
  month: string; // YYYY-MM
  amount: number;
  status: InstallmentStatus;
  paidAt: string | null;
}

export interface FinanceCommission {
  id: number;
  date: string;
  sellerId: number;
  sellerName: string;
  student: string;
  courseId: number | null;
  courseName: string | null;
  saleAmount: number;
  percent: number;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  installments: number;
  totalCommission: number;
  enrollmentId: number | null;
  notes: string | null;
  installmentsDetail: FinanceCommissionInstallment[];
}

export interface FinanceBranchItem {
  id: number;
  branchId: number;
  branchName: string;
  item: string;
  category: string;
  supplier: string | null;
  amount: number;
  date: string | null;
  status: ExpenseStatus;
  costKind: BranchItemCostKind;
  invoiceUrl: string | null;
  hasInvoiceFile: boolean;
  invoiceFilename: string | null;
  notes: string | null;
}

// ── Resumos / dashboards ─────────────────────────────────────────

export interface FinanceMonthTotals {
  month: string; // YYYY-MM
  revenue: number;
  revenueForecast: number;
  fixedExpenses: number;
  variableExpenses: number;
  commissions: number;
  branchSetup: number;
  totalExpenses: number;
  profit: number;
  margin: number; // 0-100
  enrollmentsCount: number;
  cardFees: number;
}

export interface FinanceKpi {
  key: string;
  label: string;
  value: number;
  previous: number | null;
  /** Variação % vs mês anterior (null quando não há base de comparação). */
  deltaPct: number | null;
  format: "currency" | "number" | "percent";
}

export interface FinanceDistributionSlice {
  name: string;
  value: number;
}

export interface FinanceDashboardSummary {
  month: string;
  kpis: FinanceKpi[];
  monthly: FinanceMonthTotals[]; // últimos 12 meses (para gráficos)
  expenseDistribution: FinanceDistributionSlice[];
  revenueByCourse: FinanceDistributionSlice[];
  revenueByBranch: FinanceDistributionSlice[];
  commissionBySeller: FinanceDistributionSlice[];
  quarterly: FinanceQuarterTotals[];
  cashBalance: number;
}

export interface FinanceQuarterTotals {
  year: number;
  quarter: number; // 1-4
  label: string; // "Q1 2026"
  revenue: number;
  fixedExpenses: number;
  variableExpenses: number;
  totalExpenses: number;
  profit: number;
  margin: number;
}

export interface FinanceCommissionPanel {
  sellers: Array<{
    sellerId: number;
    sellerName: string;
    monthTotal: number;
    yearTotal: number;
    paidTotal: number;
    pendingTotal: number;
  }>;
  monthTotal: number;
  yearTotal: number;
  paidTotal: number;
  pendingTotal: number;
}

/** Filtros globais aceitos pelos resumos e exportações. */
export interface FinanceFilters {
  from?: string; // YYYY-MM
  to?: string; // YYYY-MM
  branchId?: number;
  courseId?: number;
  categoryId?: number;
  sellerId?: number;
  paymentMethodId?: number;
}
