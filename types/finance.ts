// Tipos compartilhados do módulo de Gestão Financeira (VozUP).
// Valores monetários sempre em reais (number); meses como "YYYY-MM".

export type FinanceCategoryKind = "receita" | "gasto_fixo" | "gasto_variavel";
export type RevenueStatus = "previsto" | "recebido" | "atrasado" | "cancelado" | "parcial";
export type ExpenseStatus = "pendente" | "pago" | "atrasado";
export type InstallmentStatus = "pendente" | "pago";
export type BranchItemCostKind = "fixo" | "variavel";
export type BranchItemPhase = "implementacao" | "pre_operacional";
export type PaymentMethodKind = "avista" | "parcelado";
/** Origem da receita: "legacy" = matrícula/lançamento antigo (status manual, intocado); "avulso" = novo fluxo de pagamentos parciais (status automático). */
export type RevenueMode = "legacy" | "avulso";
export type RevenuePaymentMethod =
  | "pix"
  | "dinheiro"
  | "transferencia"
  | "debito"
  | "credito"
  | "boleto"
  | "outros";
export type CommissionStatus = "disponivel" | "paga";

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

export interface FinanceCardBrand {
  id: number;
  name: string;
  active: boolean;
}

export interface FinanceInstallmentRate {
  installments: number;
  /** null = taxa padrão (sem bandeira específica). */
  brandId: number | null;
  brandName: string | null;
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
  cardBrands: FinanceCardBrand[];
  installmentRates: FinanceInstallmentRate[];
  initialBalance: number;
  /** Taxa fixa (R$) de emissão de boleto, aplicada a cada pagamento avulso em boleto. */
  boletoFee: number;
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
  /** "legacy" (matrícula/lançamento antigo, status manual) ou "avulso" (novo fluxo, status automático). */
  revenueMode: RevenueMode;
  dueDate: string | null;
  leadInscricaoId: number | null;
  leadName: string | null;
  leadPhone: string | null;
  /** % de comissão do vendedor sobre esta venda — só usado por linhas "avulso". */
  commissionPct: number;
  hasInvoiceFile: boolean;
  invoiceFilename: string | null;
  // Agregados somente-leitura, calculados a partir de finance_revenue_payments
  // (só têm sentido para revenueMode "avulso"; vêm 0 para linhas "legacy").
  paidAmount: number;
  balanceRemaining: number;
  paymentsFeeTotal: number;
  paymentsCommissionTotal: number;
  netReceived: number;
  /** "Líquido previsto" = amount - paymentsFeeTotal (taxas futuras são imprevisíveis). */
  netExpected: number;
}

export interface RevenuePayment {
  id: number;
  revenueId: number;
  amount: number;
  paymentDate: string;
  paymentMethod: RevenuePaymentMethod;
  installments: number | null;
  cardBrandId: number | null;
  cardBrandName: string | null;
  feePct: number | null;
  feeAmount: number;
  netAmount: number;
  commissionPct: number;
  commissionAmount: number;
  commissionStatus: CommissionStatus;
  commissionPaidAt: string | null;
  notes: string | null;
  createdByUserId: number | null;
  createdByName: string | null;
  createdAt: string;
  hasInvoiceFile: boolean;
  invoiceFilename: string | null;
}

export interface RealCommissionRow {
  paymentId: number;
  revenueId: number;
  sellerId: number;
  sellerName: string;
  revenueDescription: string;
  leadName: string | null;
  saleAmount: number;
  paymentAmount: number;
  commissionPct: number;
  commissionAmount: number;
  date: string;
  status: CommissionStatus;
}

export interface ProjectedCommissionRow {
  revenueId: number;
  sellerId: number;
  sellerName: string;
  revenueDescription: string;
  leadName: string | null;
  saleAmount: number;
  balanceRemaining: number;
  commissionPct: number;
  projectedCommissionAmount: number;
  status: "aguardando_pagamento";
}

export interface CommissionsOverview {
  real: RealCommissionRow[];
  projected: ProjectedCommissionRow[];
  totals: {
    realGenerated: number;
    realPaid: number;
    projected: number;
  };
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
  recurringLocked: boolean;
  recurringDueDay: number | null;
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
  cardBrandId: number | null;
  cardBrandName: string | null;
  firstMonth: string; // YYYY-MM
  saleDate: string;
  sellerId: number | null;
  sellerName: string | null;
  commissionPct: number;
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
  phase: BranchItemPhase;
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

export interface FinanceCashOverview {
  received: number;
  paid: number;
  realizedNet: number;
  toReceive: number;
  toPay: number;
  forecastNet: number;
  competenceRevenue: number;
  competenceExpenses: number;
  monthProfit: number;
}

export interface FinanceAlertItem {
  id: string;
  label: string;
  amount: number;
  date: string | null;
  detail: string | null;
}

export interface FinanceAlertGroup {
  count: number;
  total: number;
  items: FinanceAlertItem[];
}

export interface FinanceAlertsSummary {
  dueSoonBills: FinanceAlertGroup;
  overdueBills: FinanceAlertGroup;
  overdueRevenues: FinanceAlertGroup;
  pendingCommissions: FinanceAlertGroup;
}

export interface FinanceDashboardSummary {
  month: string;
  kpis: FinanceKpi[];
  monthly: FinanceMonthTotals[]; // últimos 12 meses (para gráficos)
  cashOverview: FinanceCashOverview;
  alerts: FinanceAlertsSummary;
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
