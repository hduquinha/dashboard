"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BellRing,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FileUp,
  Filter,
  LineChart as LineChartIcon,
  LockKeyhole,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UnlockKeyhole,
  WalletCards,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BranchItemPhase,
  CommissionStatus,
  CommissionsOverview,
  ExpenseStatus,
  FinanceAlertGroup,
  FinanceAllTimeSpend,
  FinanceAgendaClass,
  FinanceAgendaParticipant,
  FinanceBranchItem,
  FinanceCatalog,
  FinanceCategoryKind,
  FinanceCommission,
  FinanceCommissionPanel,
  FinanceDashboardSummary,
  FinanceEnrollment,
  FinanceFilters,
  FinanceFixedExpense,
  FinanceInstallmentRate,
  FinanceKpi,
  FinanceMonthTotals,
  FinanceRevenue,
  FinanceVariableExpense,
  RevenueStatus,
} from "@/types/finance";
import FinanceAuditPanel from "@/components/FinanceAuditPanel";
import EnrollmentPaymentsPanel from "./EnrollmentPaymentsPanel";

type TabKey =
  | "dashboard"
  | "fluxo"
  | "receitas"
  | "gastos"
  | "filiais"
  | "matriculas"
  | "agenda"
  | "comissoes"
  | "trimestral"
  | "configuracoes"
  | "auditoria";

type ModalState =
  | { type: "revenue"; mode: "create" | "edit"; record?: FinanceRevenue }
  | { type: "fixed"; mode: "create" | "edit"; record?: FinanceFixedExpense }
  | { type: "variable"; mode: "create" | "edit"; record?: FinanceVariableExpense }
  | { type: "branch"; mode: "create" | "edit"; record?: FinanceBranchItem }
  | { type: "enrollment"; mode: "create" | "edit"; record?: FinanceEnrollment }
  | { type: "commission"; mode: "create" }
  | null;

interface FinanceiroClientProps {
  catalog: FinanceCatalog;
  summary: FinanceDashboardSummary;
  revenues: FinanceRevenue[];
  fixedExpenses: FinanceFixedExpense[];
  fixedExpensesLocked: boolean;
  variableExpenses: FinanceVariableExpense[];
  enrollments: FinanceEnrollment[];
  agenda: FinanceAgendaClass[];
  commissions: FinanceCommission[];
  branchItems: FinanceBranchItem[];
  commissionPanel: FinanceCommissionPanel;
  filters: FinanceFilters;
  month: string;
  periodMode: PeriodMode;
  receitasVisao: "mes" | "todos";
  fluxoVisao: "mes" | "todos";
  matriculasVisao: "mes" | "todos";
  comissoesVisao: "mes" | "todos";
  allMonthlyTotals: FinanceMonthTotals[] | null;
  commissionsOverview: CommissionsOverview;
  /** Pode remover eventos do Registro de Auditoria (permissão admin.audit). */
  canDeleteAuditEvents: boolean;
}

type VisaoKey = "receitasVisao" | "fluxoVisao" | "matriculasVisao" | "comissoesVisao";

/** Recorte do filtro do topo: um mês, um intervalo escolhido, ou todo o histórico. */
type PeriodMode = "month" | "custom" | "all";

interface Column<T> {
  key: string;
  label: string;
  render: (item: T) => ReactNode;
  value: (item: T) => string | number | null | undefined;
  className?: string;
}

type ChartMonthlyPoint = {
  mes: string;
  receitas: number;
  despesas: number;
  lucro: number;
  fixos: number;
  variaveis: number;
  saldo: number;
};

const tabs: Array<{ key: TabKey; label: string; icon: typeof LineChartIcon }> = [
  { key: "dashboard", label: "Dashboard Financeiro", icon: LineChartIcon },
  { key: "fluxo", label: "Fluxo de Caixa", icon: WalletCards },
  { key: "receitas", label: "Receitas", icon: BadgeDollarSign },
  { key: "gastos", label: "Despesas", icon: ReceiptText },
  { key: "filiais", label: "Unidade Tatuapé", icon: Building2 },
  { key: "matriculas", label: "Matrículas", icon: CalendarDays },
  { key: "agenda", label: "Agenda de Turmas", icon: CalendarDays },
  { key: "comissoes", label: "Comissões", icon: Banknote },
  { key: "trimestral", label: "Consolidação Trimestral", icon: FileDown },
  { key: "configuracoes", label: "Configurações Financeiras", icon: Settings2 },
  { key: "auditoria", label: "Registro de Auditoria", icon: ShieldCheck },
];

const COLORS = ["#06a8d8", "#12a594", "#f59e0b", "#e54666", "#6366f1", "#14b8a6", "#8b5cf6", "#0f766e"];

export const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100";
export const labelClass = "text-[11px] font-black uppercase tracking-[0.14em] text-slate-500";

/** Campos dos formulários de Configurações que são colunas numéricas no banco — precisam passar por parseDecimal antes de ir pra API. */
const CATALOG_DECIMAL_FIELDS = new Set(["salary", "benefits", "defaultPrice", "defaultPct"]);

function splitInstallmentsClient(total: number, count: number): number[] {
  const n = Math.max(1, Math.trunc(count));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, index) => (base + (index === n - 1 ? remainder : 0)) / 100);
}

export function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);
}

function number(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR").format(value ?? 0);
}

export function percent(value: number | null | undefined): string {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value ?? 0)}%`;
}

function compactMoney(value: number | null | undefined): string {
  const amount = value ?? 0;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(amount / 1_000_000)} mi`;
  }
  if (abs >= 1_000) {
    return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(amount / 1_000)} mil`;
  }
  return money(amount);
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year, monthNumber - 1, 1)
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function chartTick(value: number | string): string {
  return compactMoney(Number(value)).replace("R$ ", "");
}

function dayFromDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.slice(8, 10), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function lockedDayLabel(day: number | null): string {
  return day ? `dia ${String(day).padStart(2, "0")}` : "valor fixo";
}

function sumClientTotals(monthly: FinanceMonthTotals[]): FinanceMonthTotals {
  const totals: FinanceMonthTotals = {
    month: monthly.length === 1 ? monthly[0].month : "periodo",
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
  for (const item of monthly) {
    totals.revenue += item.revenue;
    totals.revenueForecast += item.revenueForecast;
    totals.fixedExpenses += item.fixedExpenses;
    totals.variableExpenses += item.variableExpenses;
    totals.commissions += item.commissions;
    totals.branchSetup += item.branchSetup;
    totals.totalExpenses += item.totalExpenses;
    totals.profit += item.profit;
    totals.enrollmentsCount += item.enrollmentsCount;
    totals.enrollmentsAmount += item.enrollmentsAmount;
    totals.cardFees += item.cardFees;
  }
  totals.margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  return totals;
}

function formatKpiValue(kpi: FinanceKpi): string {
  if (kpi.format === "currency") return money(kpi.value);
  if (kpi.format === "percent") return percent(kpi.value);
  return number(kpi.value);
}

export function toInputDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysUntil(date: string | null | undefined): number | null {
  const target = parseDateOnly(date);
  if (!target) return null;
  return Math.round((target.getTime() - startOfToday().getTime()) / 86_400_000);
}

function dueLabel(days: number): string {
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}

function valueOrEmpty(value: string | number | null | undefined): string | number {
  return value ?? "";
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseDecimal(value: string): number {
  const normalized = value.trim().replace(/\s/g, "");
  const decimalSeparator = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
  const withoutThousands =
    decimalSeparator === ","
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  const parsed = Number(withoutThousands);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formNumber(form: FormData, key: string): number {
  const value = formString(form, key);
  return parseDecimal(value);
}

export function formOptionalNumber(form: FormData, key: string): number | null {
  const value = formString(form, key);
  if (!value) return null;
  return parseDecimal(value);
}

export function formOptionalDate(form: FormData, key: string): string | null {
  return formString(form, key) || null;
}

export function StatusBadge({
  status,
  label,
}: {
  status: RevenueStatus | ExpenseStatus | "pago" | "pendente";
  /** Texto exibido no lugar do valor cru do status (ex.: "Parcialmente Pago" em vez de "parcial"). */
  label?: string;
}) {
  const tone =
    status === "recebido" || status === "pago"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : status === "atrasado" || status === "cancelado"
        ? "bg-rose-50 text-rose-700 ring-rose-100"
        : "bg-amber-50 text-amber-700 ring-amber-100";
  return (
    <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-bold ring-1", tone)}>
      {label ?? status}
    </span>
  );
}

const AVULSO_STATUS_LABELS: Record<RevenueStatus, string> = {
  previsto: "Pendente",
  parcial: "Parcialmente Pago",
  recebido: "Pago",
  cancelado: "Cancelado",
  atrasado: "Atrasado",
};

function RecurringLockBadge({ record }: { record: FinanceFixedExpense }) {
  const lockedDay = record.recurringDueDay ?? dayFromDate(record.dueDate);
  const Icon = record.recurringLocked ? LockKeyhole : UnlockKeyhole;
  return (
    <span
      title={record.recurringLocked ? "Valor e vencimento travados para os próximos meses" : "Sem trava mensal"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-black ring-1",
        record.recurringLocked
          ? "bg-cyan-50 text-cyan-800 ring-cyan-100"
          : "bg-slate-50 text-slate-500 ring-slate-200"
      )}
    >
      <Icon size={13} />
      {record.recurringLocked ? lockedDayLabel(lockedDay) : "Livre"}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export function InvoiceLinks({
  fileHref,
  invoiceUrl,
  filename,
}: {
  fileHref?: string | null;
  invoiceUrl?: string | null;
  filename?: string | null;
}) {
  if (!fileHref && !invoiceUrl) return "-";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fileHref ? (
        <a className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-700 hover:bg-cyan-100" href={fileHref}>
          <FileDown size={13} />
          {filename ? "Arquivo" : "Nota"}
        </a>
      ) : null}
      {invoiceUrl ? (
        <a className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-200" href={invoiceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={13} />
          Link
        </a>
      ) : null}
    </div>
  );
}

export function InvoiceFileInput({
  currentFilename,
  label = "Anexar nota",
  fieldName = "invoiceFile",
  accept,
}: {
  currentFilename?: string | null;
  label?: string;
  fieldName?: string;
  accept?: string;
}) {
  const [selectedName, setSelectedName] = useState("");
  return (
    <div className="grid gap-1.5">
      <span className={labelClass}>{label}</span>
      <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-300 bg-cyan-50 px-3 text-sm font-black text-cyan-800 transition hover:bg-cyan-100">
        <FileUp size={16} />
        {label}
        <input
          type="file"
          name={fieldName}
          accept={accept}
          className="sr-only"
          onChange={(event) => setSelectedName(event.target.files?.[0]?.name ?? "")}
        />
      </label>
      {selectedName || currentFilename ? (
        <p className="truncate text-xs font-semibold text-slate-500">
          {selectedName ? `Selecionado: ${selectedName}` : `Arquivo atual: ${currentFilename}`}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={valueOrEmpty(defaultValue)}
        className={inputClass}
      />
    </Field>
  );
}

export function DecimalInput({
  label,
  name,
  defaultValue,
  required = false,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        required={required}
        defaultValue={valueOrEmpty(defaultValue)}
        className={inputClass}
      />
    </Field>
  );
}

function LockCheckbox({
  defaultChecked = false,
}: {
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-black text-cyan-900">
      <input
        type="checkbox"
        name="recurringLocked"
        defaultChecked={defaultChecked}
        className="size-4 rounded border-cyan-300 text-cyan-700 accent-cyan-700"
      />
      <LockKeyhole size={16} className="text-cyan-700" />
      <span>Travar valor e vencimento nos próximos meses</span>
    </label>
  );
}

export function SelectInput({
  label,
  name,
  defaultValue,
  children,
  required = false,
  onChange,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  children: ReactNode;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        name={name}
        required={required}
        defaultValue={valueOrEmpty(defaultValue)}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={inputClass}
      >
        {children}
      </select>
    </Field>
  );
}

export function TextAreaInput({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | null }) {
  return (
    <Field label={label}>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={3}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
      />
    </Field>
  );
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border border-slate-200 bg-white shadow-[var(--dashboard-card-shadow)]", className)}>{children}</section>;
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-black text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function subscribeHydration() {
  return () => undefined;
}

function useHydrated() {
  return useSyncExternalStore(subscribeHydration, () => true, () => false);
}

function KpiCard({ kpi }: { kpi: FinanceKpi }) {
  const isExpense = kpi.key.includes("gastos") || kpi.key.includes("implantacao");
  const isPositive = kpi.deltaPct === null ? null : isExpense ? kpi.deltaPct <= 0 : kpi.deltaPct >= 0;
  const DeltaIcon = isPositive === false ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--dashboard-card-shadow)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{kpi.label}</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-black",
            isPositive === null
              ? "bg-slate-100 text-slate-500"
              : isPositive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
          )}
        >
          {kpi.deltaPct === null ? "novo" : <><DeltaIcon size={13} />{percent(Math.abs(kpi.deltaPct))}</>}
        </span>
      </div>
      <p className="mt-4 text-2xl font-black tracking-tight text-slate-950">{formatKpiValue(kpi)}</p>
      <p className="mt-1 text-xs text-slate-400">
        Mês anterior: {kpi.previous === null ? "sem base" : kpi.format === "currency" ? money(kpi.previous) : kpi.format === "percent" ? percent(kpi.previous) : number(kpi.previous)}
      </p>
      {kpi.hint ? <p className="mt-2 text-[11px] font-semibold leading-snug text-slate-500">{kpi.hint}</p> : null}
    </div>
  );
}

function ChartCard({ title, children, heightClass = "h-72" }: { title: string; children: ReactNode; heightClass?: string }) {
  const hydrated = useHydrated();
  return (
    <Section>
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-black text-slate-950">{title}</h3>
      </div>
      <div className={cn(heightClass, "px-3 py-4")}>{hydrated ? children : <EmptyChart />}</div>
    </Section>
  );
}

function EmptyChart() {
  return (
    <div className="grid h-full place-content-center text-center">
      <p className="text-sm font-bold text-slate-400">Sem dados no período</p>
    </div>
  );
}

export function SmartTable<T>({
  rows,
  columns,
  searchPlaceholder = "Pesquisar",
  actions,
  defaultSortDir = "desc",
  defaultSortKey,
}: {
  rows: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  actions?: (item: T) => ReactNode;
  defaultSortDir?: "asc" | "desc";
  defaultSortKey?: string;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) =>
          columns.some((column) => String(column.value(row) ?? column.render(row) ?? "").toLowerCase().includes(needle))
        )
      : rows;
    const column = columns.find((item) => item.key === sortKey);
    if (!column) return filtered;
    return [...filtered].sort((a, b) => {
      const av = column.value(a);
      const bv = column.value(b);
      const left = typeof av === "number" ? av : String(av ?? "");
      const right = typeof bv === "number" ? bv : String(bv ?? "");
      if (left < right) return sortDir === "asc" ? -1 : 1;
      if (left > right) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [columns, query, rows, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = visibleRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstItem = visibleRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, visibleRows.length);

  function toggleSort(key: string) {
    setPage(1);
    if (sortKey === key) {
      setSortDir((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
            {visibleRows.length} registros
          </span>
          <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">
            Linhas
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="bg-transparent text-sm font-black text-slate-800 outline-none"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                  <button type="button" onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1">
                    {column.label}
                    {sortKey === column.key ? <span>{sortDir === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
              ))}
              {actions ? <th className="px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Ações</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                  Sem registros para exibir
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, index) => (
                <tr key={index} className="hover:bg-cyan-50/40">
                  {columns.map((column) => (
                    <td key={column.key} className={cn("whitespace-nowrap px-3 py-3 text-slate-700", column.className)}>
                      {column.render(row)}
                    </td>
                  ))}
                  {actions ? <td className="whitespace-nowrap px-3 py-3 text-right">{actions(row)}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold text-slate-500">
          Exibindo {firstItem}-{lastItem} de {visibleRows.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="min-w-16 text-center text-xs font-black text-slate-600">
            {currentPage}/{totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}

export function IconButton({
  title,
  onClick,
  children,
  danger = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg border transition",
        danger
          ? "border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100"
          : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700"
      )}
    >
      {children}
    </button>
  );
}

function ExportCenter({ month, filters }: { month: string; filters: FinanceFilters }) {
  const sectionOptions = [
    ["dashboard", "Dashboard Financeiro"],
    ["fluxo", "Fluxo de Caixa"],
    ["receitas", "Receitas"],
    ["gastos-fixos", "Despesas Fixas"],
    ["gastos-variaveis", "Despesas Variáveis"],
    ["filiais", "Unidade Tatuapé"],
    ["matriculas", "Matrículas"],
    ["comissoes", "Comissões"],
    ["trimestral", "Consolidação Trimestral"],
    ["funcionarios", "Funcionários"],
    ["folha", "Folha de Pagamento"],
    ["configuracoes", "Configurações Financeiras"],
  ] as const;

  const [selectedMonths, setSelectedMonths] = useState<string[]>(() => [month]);
  const [selectedSections, setSelectedSections] = useState<string[]>(["dashboard", "fluxo", "receitas"]);

  const selectedSectionCount = selectedSections.length;
  const selectedMonthCount = selectedMonths.filter(Boolean).length;

  function singleHref(section: string, format: "xlsx" | "csv" | "pdf") {
    const params = new URLSearchParams({ section, format, month });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    return `/api/finance/export?${params.toString()}`;
  }

  function selectedHref(format: "xlsx" | "csv" | "pdf") {
    const months = Array.from(new Set(selectedMonths.filter(Boolean)));
    const sections = Array.from(new Set(selectedSections));
    const params = new URLSearchParams({
      format,
      months: months.join(","),
      sections: sections.join(","),
    });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    return `/api/finance/export?${params.toString()}`;
  }

  function toggleSection(section: string) {
    setSelectedSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section]);
  }

  function updateMonth(index: number, value: string) {
    setSelectedMonths((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function addMonth() {
    const lastMonth = selectedMonths[selectedMonths.length - 1] || month;
    const [year, monthNumber] = lastMonth.split("-").map(Number);
    const next = year && monthNumber ? new Date(year, monthNumber, 1) : new Date();
    const nextValue = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setSelectedMonths((current) => [...current, nextValue]);
  }

  function removeMonth(index: number) {
    setSelectedMonths((current) => current.length <= 1 ? current : current.filter((_, itemIndex) => itemIndex !== index));
  }

  function selectAllSections() {
    setSelectedSections(sectionOptions.map(([section]) => section));
  }

  function clearSections() {
    setSelectedSections([]);
  }

  return (
    <Section>
      <SectionHeader
        title="Central de exportação"
        subtitle="Escolha os meses e as partes do financeiro para gerar um único pacote de exportação."
        action={
          <div className="flex flex-wrap gap-2">
            <a href={selectedSectionCount > 0 && selectedMonthCount > 0 ? selectedHref("xlsx") : undefined} className={cn("inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black", selectedSectionCount > 0 && selectedMonthCount > 0 ? "bg-slate-950 text-white hover:bg-slate-800" : "cursor-not-allowed bg-slate-200 text-slate-400")} aria-disabled={selectedSectionCount === 0 || selectedMonthCount === 0}>
              <FileSpreadsheet size={16} />Excel selecionado
            </a>
          </div>
        }
      />
      <div className="grid gap-5 border-b border-slate-100 p-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-lg border border-cyan-100 bg-cyan-50/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-950">Meses da exportação</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">Cada mês selecionado vira um conjunto de abas no Excel.</p>
            </div>
            <button type="button" onClick={addMonth} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-800 hover:bg-cyan-50"><Plus size={13} />Adicionar</button>
          </div>
          <div className="mt-3 grid gap-2">
            {selectedMonths.map((value, index) => (
              <div key={`${index}-${value}`} className="flex items-center gap-2">
                <input type="month" value={value} onChange={(event) => updateMonth(index, event.target.value)} className={inputClass} aria-label={`Mês ${index + 1}`} />
                <button type="button" onClick={() => removeMonth(index)} disabled={selectedMonths.length <= 1} className="inline-flex size-10 flex-none items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40" title="Remover mês" aria-label="Remover mês"><X size={16} /></button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-black text-cyan-900">{selectedMonthCount} mês{selectedMonthCount === 1 ? "" : "es"} selecionado{selectedMonthCount === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-950">Seções do pacote</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Selecione uma ou várias áreas para reunir no mesmo arquivo.</p>
            </div>
            <div className="flex gap-2 text-xs font-black">
              <button type="button" onClick={selectAllSections} className="text-cyan-700 hover:text-cyan-900">Todas</button>
              <span className="text-slate-300">·</span>
              <button type="button" onClick={clearSections} className="text-slate-500 hover:text-slate-800">Limpar</button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sectionOptions.map(([section, label]) => (
              <label key={section} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold transition", selectedSections.includes(section) ? "border-cyan-200 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200")}>
                <input type="checkbox" checked={selectedSections.includes(section)} onChange={() => toggleSection(section)} className="size-4 rounded border-slate-300 accent-cyan-700" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs font-black text-slate-600">{selectedSectionCount} seção{selectedSectionCount === 1 ? "" : "ões"} selecionada{selectedSectionCount === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
        <p className="text-xs font-semibold text-slate-600">Excel cria uma aba por combinação de mês e seção. CSV reúne tudo em uma tabela; PDF cria uma página por combinação.</p>
        <div className="flex flex-wrap gap-2">
          <a href={selectedSectionCount > 0 && selectedMonthCount > 0 ? selectedHref("csv") : undefined} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-black", selectedSectionCount > 0 && selectedMonthCount > 0 ? "bg-slate-200 text-slate-700 hover:bg-slate-300" : "cursor-not-allowed bg-slate-200 text-slate-400")} aria-disabled={selectedSectionCount === 0 || selectedMonthCount === 0}><Download size={14} />CSV selecionado</a>
          <a href={selectedSectionCount > 0 && selectedMonthCount > 0 ? selectedHref("pdf") : undefined} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-black", selectedSectionCount > 0 && selectedMonthCount > 0 ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : "cursor-not-allowed bg-slate-200 text-slate-400")} aria-disabled={selectedSectionCount === 0 || selectedMonthCount === 0}><FileDown size={14} />PDF selecionado</a>
        </div>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
        {sectionOptions.map(([section, label]) => (
          <div key={section} className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm font-black text-slate-950">{label}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-50 px-3 text-xs font-bold text-emerald-700" href={singleHref(section, "xlsx")}>
                <Download size={13} /> Excel
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-100 px-3 text-xs font-bold text-slate-700" href={singleHref(section, "csv")}>
                <Download size={13} /> CSV
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-md bg-rose-50 px-3 text-xs font-bold text-rose-700" href={singleHref(section, "pdf")}>
                <Download size={13} /> PDF
              </a>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FinanceOverviewPanel({ summary }: { summary: FinanceDashboardSummary }) {
  const overview = summary.cashOverview;
  return (
    <Section>
      <SectionHeader title="Realizado, Previsto e Lucro" subtitle="Separação rápida do dinheiro que entrou/saiu, valores previstos e resultado do período." />
      <div className="grid divide-y divide-slate-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <div className="grid content-start gap-3 p-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Dinheiro realizado</p>
            <p className={cn("mt-2 text-2xl font-black", overview.realizedNet >= 0 ? "text-emerald-700" : "text-rose-700")}>
              {money(overview.realizedNet)}
            </p>
          </div>
          <MetricRow label="Entrou" value={money(overview.received)} tone="good" />
          <MetricRow label="Saiu" value={money(overview.paid)} tone="bad" />
        </div>

        <div className="grid content-start gap-3 p-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-700">Dinheiro previsto</p>
            <p className={cn("mt-2 text-2xl font-black", overview.forecastNet >= 0 ? "text-cyan-800" : "text-rose-700")}>
              {money(overview.forecastNet)}
            </p>
          </div>
          <MetricRow label="A receber" value={money(overview.toReceive)} />
          <MetricRow label="A pagar" value={money(overview.toPay)} tone="bad" />
        </div>

        <div className="grid content-start gap-3 p-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Lucro do mês</p>
            <p className={cn("mt-2 text-2xl font-black", overview.monthProfit >= 0 ? "text-slate-950" : "text-rose-700")}>
              {money(overview.monthProfit)}
            </p>
          </div>
          <MetricRow label="Receitas" value={money(overview.competenceRevenue)} />
          <MetricRow label="Despesas" value={money(overview.competenceExpenses)} tone="bad" />
        </div>
      </div>
    </Section>
  );
}

/**
 * Sem este aviso, selecionar setembro mostraria tudo zerado enquanto a aba
 * Despesas lista a folha de setembro — parece bug, mas é a regra: mês que ainda
 * não aconteceu não entra em cálculo.
 */
function FuturePeriodNotice({ period }: { period: FinanceDashboardSummary["effectivePeriod"] }) {
  if (!period.clamped && !period.empty) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
      {period.empty ? (
        <>
          O período selecionado ainda não aconteceu, então não há valores para somar. Indicadores e gráficos consideram
          no máximo {monthLabel(period.to)}.
        </>
      ) : (
        <>
          Você pediu até {monthLabel(period.requestedTo)}, mas os cálculos vão só até {monthLabel(period.to)}. Despesa
          fixa já provisionada para os meses seguintes não entra em KPI, lucro nem gráfico — só aparece na lista da aba
          Despesas.
        </>
      )}
    </div>
  );
}

/**
 * Gasto acumulado da empresa — soma de tudo que saiu, sem descontar receita.
 * De propósito NÃO reage ao filtro de período do topo; o aviso no rodapé diz
 * isso, senão o número parece quebrado quando o usuário troca o mês.
 */
function TotalSpendPanel({ spend }: { spend: FinanceAllTimeSpend }) {
  const linhas = [
    { label: "Implementação", value: spend.implementation, color: "bg-violet-500" },
    { label: "Pré-operacional", value: spend.preOperational, color: "bg-sky-500" },
    { label: "Despesas Fixas", value: spend.fixedExpenses, color: "bg-rose-500" },
    { label: "Despesas Variáveis", value: spend.variableExpenses, color: "bg-amber-500" },
  ];
  const desde = spend.firstMovement
    ? new Date(`${spend.firstMovement}T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : null;

  return (
    <Section>
      <SectionHeader
        title="Gasto Total Acumulado"
        subtitle="Tudo que saiu desde o início, somando todos os meses. Não desconta receita."
      />
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,260px)_1fr] lg:items-start">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Total geral</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-rose-700">{money(spend.total)}</p>
          {desde ? <p className="mt-1 text-xs font-semibold text-slate-500">Desde {desde}</p> : null}
        </div>

        <div className="grid gap-2.5">
          {linhas.map((linha) => {
            const share = spend.total > 0 ? (linha.value / spend.total) * 100 : 0;
            return (
              <div key={linha.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-600">{linha.label}</span>
                  <span className="text-sm font-black text-slate-950">
                    {money(linha.value)}
                    <span className="ml-2 text-[11px] font-bold text-slate-400">{percent(share)}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn("h-full rounded-full", linha.color)} style={{ width: `${Math.min(share, 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] font-semibold leading-relaxed text-slate-500">
        Não entra no total:{" "}
        <strong className="text-slate-700">{money(spend.futureProvisioned)}</strong> já lançados para meses futuros
        {spend.commissionsProvisioned > 0 ? (
          <> e <strong className="text-slate-700">{money(spend.commissionsProvisioned)}</strong> de comissões provisionadas</>
        ) : null}
        . Despesas fixas contam a partir de {spend.fixedFrom} (antes disso os meses foram semeados automaticamente e não
        representam gasto real). Este card mostra a empresa inteira — não muda com o filtro de período do topo.
      </div>
    </Section>
  );
}

function FinanceAlertsPanel({ alerts }: { alerts: FinanceDashboardSummary["alerts"] }) {
  return (
    <Section>
      <SectionHeader title="Alertas Financeiros" subtitle="Pendências que precisam de acompanhamento." />
      <div className="grid divide-y divide-slate-100 xl:grid-cols-4 xl:divide-x xl:divide-y-0">
        <AlertGroupBlock title="Contas vencendo" group={alerts.dueSoonBills} tone="amber" emptyText="Nenhuma conta vencendo nos próximos 7 dias." />
        <AlertGroupBlock title="Contas atrasadas" group={alerts.overdueBills} tone="rose" emptyText="Nenhuma conta atrasada." />
        <AlertGroupBlock title="Receitas atrasadas" group={alerts.overdueRevenues} tone="rose" emptyText="Nenhuma receita atrasada." />
        <AlertGroupBlock title="Comissões pendentes" group={alerts.pendingCommissions} tone="cyan" emptyText="Nenhuma comissão pendente no período." />
      </div>
    </Section>
  );
}

function AlertGroupBlock({
  title,
  group,
  tone,
  emptyText,
}: {
  title: string;
  group: FinanceAlertGroup;
  tone: "amber" | "rose" | "cyan";
  emptyText: string;
}) {
  const toneClasses = {
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    cyan: "bg-cyan-50 text-cyan-800 ring-cyan-100",
  }[tone];

  return (
    <div className="grid min-w-0 content-start gap-3 overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-slate-950">{title}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">{group.count} registro{group.count === 1 ? "" : "s"}</p>
        </div>
        <span className={cn("inline-flex shrink-0 rounded-md px-2 py-1 text-xs font-black ring-1", toneClasses)}>
          {money(group.total)}
        </span>
      </div>

      {group.items.length > 0 ? (
        <div className="grid gap-2">
          {group.items.map((item) => (
            <div key={item.id} className="grid gap-1 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{item.label}</p>
                <p className="shrink-0 whitespace-nowrap text-sm font-black text-slate-950">{money(item.amount)}</p>
              </div>
              <p className="truncate text-xs font-semibold text-slate-500">
                {dateLabel(item.date)}{item.detail ? ` · ${item.detail}` : ""}
              </p>
            </div>
          ))}
          {group.count > group.items.length ? (
            <p className="text-xs font-bold text-slate-400">+{group.count - group.items.length} outros registros</p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500">
          <CheckCircle2 size={16} className="text-emerald-600" />
          {emptyText}
        </div>
      )}
    </div>
  );
}

export default function FinanceiroClient({
  catalog,
  summary,
  revenues,
  fixedExpenses,
  fixedExpensesLocked,
  variableExpenses,
  enrollments,
  agenda,
  commissions,
  branchItems,
  commissionPanel,
  filters,
  month,
  periodMode,
  receitasVisao,
  fluxoVisao,
  matriculasVisao,
  comissoesVisao,
  allMonthlyTotals,
  commissionsOverview,
  canDeleteAuditEvents,
}: FinanceiroClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [modal, setModal] = useState<ModalState>(null);
  const [paymentsPanelEnrollment, setPaymentsPanelEnrollment] = useState<{ id: number; readOnly: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localFilters, setLocalFilters] = useState({
    periodMode,
    month,
    from: filters.from ?? month,
    to: filters.to ?? month,
    branchId: filters.branchId ? String(filters.branchId) : "",
    courseId: filters.courseId ? String(filters.courseId) : "",
    categoryId: filters.categoryId ? String(filters.categoryId) : "",
    sellerId: filters.sellerId ? String(filters.sellerId) : "",
    paymentMethodId: filters.paymentMethodId ? String(filters.paymentMethodId) : "",
    receitasVisao,
    fluxoVisao,
    matriculasVisao,
    comissoesVisao,
  });

  const revenueCategories = catalog.categories.filter((item) => item.kind === "receita" && item.active);
  const fixedCategories = catalog.categories.filter((item) => item.kind === "gasto_fixo" && item.active);
  const variableCategories = catalog.categories.filter((item) => item.kind === "gasto_variavel" && item.active);
  const activeCourses = catalog.courses.filter((item) => item.active);
  const activeBranches = catalog.branches.filter((item) => item.active);
  const activeSellers = catalog.sellers.filter((item) => item.active);
  const activePaymentMethods = catalog.paymentMethods.filter((item) => item.active);

  const currentTotals = summary.monthly.length > 0 ? sumClientTotals(summary.monthly) : {
    revenue: 0,
    fixedExpenses: 0,
    variableExpenses: 0,
    commissions: 0,
    totalExpenses: 0,
    profit: 0,
    margin: 0,
    cashBalance: 0,
  };

  function refresh(messageText?: string) {
    if (messageText) setMessage(messageText);
    router.refresh();
  }

  function applyFilters() {
    // Em "Período", o mês base passa a ser o início do intervalo: é ele que
    // rotula os cards e alimenta o painel de comissões do mês. Em "Tudo" quem
    // resolve o intervalo é o servidor, a partir do primeiro movimento.
    const selectedFrom = localFilters.from || localFilters.month;
    const selectedTo = localFilters.to || selectedFrom;
    const baseMonth = localFilters.periodMode === "custom" ? selectedFrom : localFilters.month;
    const params = new URLSearchParams(localFilters.periodMode === "all" ? {} : { month: baseMonth });
    if (localFilters.periodMode === "custom") {
      params.set("periodo", "custom");
      params.set("from", selectedFrom);
      params.set("to", selectedTo);
    }
    if (localFilters.periodMode === "all") params.set("periodo", "all");
    for (const key of ["branchId", "courseId", "categoryId", "sellerId", "paymentMethodId"] as const) {
      const value = localFilters[key];
      if (value) params.set(key, value);
    }
    for (const key of ["receitasVisao", "fluxoVisao", "matriculasVisao", "comissoesVisao"] as const) {
      if (localFilters[key] === "todos") params.set(key, "todos");
    }
    router.push(`/financeiro?${params.toString()}`);
  }

  /** Addon "ver todos os meses" (Despesas, Receitas, Fluxo, Matrículas, Comissões) — aplica na hora, sem precisar clicar em Filtrar. */
  function setVisao(key: VisaoKey, next: "mes" | "todos") {
    const params = new URLSearchParams(window.location.search);
    if (next === "todos") params.set(key, "todos");
    else params.delete(key);
    setLocalFilters((current) => ({ ...current, [key]: next }));
    router.push(`/financeiro?${params.toString()}`);
  }

  async function apiJson(endpoint: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Falha ao salvar.");
    }
    return data as { id?: number; ok?: boolean };
  }

  async function createCategory(kind: FinanceCategoryKind, name: string): Promise<number | undefined> {
    const result = await apiJson("/api/finance/catalog/categories", "POST", { kind, name });
    refresh("Categoria criada.");
    return result.id;
  }

  async function uploadInvoiceFile(endpoint: string, form: FormData) {
    const file = form.get("invoiceFile");
    if (!(file instanceof File) || file.size === 0) return;
    const upload = new FormData();
    upload.set("file", file);
    const response = await fetch(endpoint, { method: "POST", body: upload });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Registro salvo, mas a nota fiscal não foi enviada.");
    }
  }

  async function destroy(endpoint: string, label: string) {
    if (!window.confirm(`Excluir ${label}?`)) return;
    try {
      await apiJson(endpoint, "DELETE");
      refresh("Registro excluído.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao excluir.");
    }
  }

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;

    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage(null);
    try {
      if (modal.type === "revenue") {
        const isLegacy = modal.mode === "edit" && modal.record?.revenueMode === "legacy";
        const body: Record<string, unknown> = isLegacy
          ? {
              date: formString(form, "date"),
              description: formString(form, "description"),
              categoryId: formOptionalNumber(form, "categoryId"),
              origin: formString(form, "origin") || null,
              student: formString(form, "student") || null,
              courseId: formOptionalNumber(form, "courseId"),
              branchId: formOptionalNumber(form, "branchId"),
              paymentMethodId: formOptionalNumber(form, "paymentMethodId"),
              sellerId: formOptionalNumber(form, "sellerId"),
              amount: formNumber(form, "amount"),
              feeAmount: formNumber(form, "feeAmount"),
              status: formString(form, "status") as RevenueStatus,
              notes: formString(form, "notes") || null,
            }
          : {
              date: formString(form, "date"),
              description: formString(form, "description"),
              categoryId: formOptionalNumber(form, "categoryId"),
              origin: formString(form, "origin") || null,
              courseId: formOptionalNumber(form, "courseId"),
              branchId: formOptionalNumber(form, "branchId"),
              sellerId: formOptionalNumber(form, "sellerId"),
              commissionPct: formNumber(form, "commissionPct"),
              amount: formNumber(form, "amount"),
              dueDate: formOptionalDate(form, "dueDate"),
              leadInscricaoId: formOptionalNumber(form, "leadInscricaoId"),
              leadName: formString(form, "leadName") || null,
              leadPhone: formString(form, "leadPhone") || null,
              notes: formString(form, "notes") || null,
              ...(form.get("cancelReceita") === "on" ? { status: "cancelado" as RevenueStatus } : {}),
            };
        const result = await apiJson(modal.mode === "edit" ? `/api/finance/revenues/${modal.record?.id}` : "/api/finance/revenues", modal.mode === "edit" ? "PATCH" : "POST", body);
        const targetId = modal.mode === "edit" ? modal.record?.id : result.id;
        if (targetId) await uploadInvoiceFile(`/api/finance/revenues/${targetId}/invoice`, form);
      }

      if (modal.type === "fixed") {
        const body: Record<string, unknown> = {
          month: formString(form, "monthDisplay") || month,
          description: formString(form, "description"),
          categoryId: formOptionalNumber(form, "categoryId"),
          dueDate: formOptionalDate(form, "dueDate"),
          amount: formNumber(form, "amount"),
          benefitsAmount: formOptionalNumber(form, "benefitsAmount"),
          status: formString(form, "status") as ExpenseStatus,
          paidAt: formOptionalDate(form, "paidAt"),
          notes: formString(form, "notes") || null,
          invoiceUrl: formString(form, "invoiceUrl") || null,
          recurringLocked: form.get("recurringLocked") === "on",
        };
        const result = await apiJson(modal.mode === "edit" ? `/api/finance/fixed-expenses/${modal.record?.id}` : "/api/finance/fixed-expenses", modal.mode === "edit" ? "PATCH" : "POST", body);
        const targetId = modal.mode === "edit" ? modal.record?.id : result.id;
        if (targetId) await uploadInvoiceFile(`/api/finance/fixed-expenses/${targetId}/invoice`, form);
      }

      if (modal.type === "variable") {
        const body = {
          date: formString(form, "date"),
          description: formString(form, "description"),
          categoryId: formOptionalNumber(form, "categoryId"),
          branchId: formOptionalNumber(form, "branchId"),
          amount: formNumber(form, "amount"),
          notes: formString(form, "notes") || null,
          invoiceUrl: formString(form, "invoiceUrl") || null,
        };
        const result = await apiJson(modal.mode === "edit" ? `/api/finance/variable-expenses/${modal.record?.id}` : "/api/finance/variable-expenses", modal.mode === "edit" ? "PATCH" : "POST", body);
        const targetId = modal.mode === "edit" ? modal.record?.id : result.id;
        if (targetId) await uploadInvoiceFile(`/api/finance/variable-expenses/${targetId}/invoice`, form);
      }

      if (modal.type === "branch") {
        const body = {
          branchId: formOptionalNumber(form, "branchId"),
          item: formString(form, "item"),
          category: formString(form, "category"),
          supplier: formString(form, "supplier") || null,
          amount: formNumber(form, "amount"),
          date: formOptionalDate(form, "date"),
          status: formString(form, "status") as ExpenseStatus,
          phase: formString(form, "phase") as BranchItemPhase,
          invoiceUrl: formString(form, "invoiceUrl") || null,
          notes: formString(form, "notes") || null,
        };
        const result = await apiJson(modal.mode === "edit" ? `/api/finance/branch-items/${modal.record?.id}` : "/api/finance/branch-items", modal.mode === "edit" ? "PATCH" : "POST", body);
        const targetId = modal.mode === "edit" ? modal.record?.id : result.id;
        if (targetId) await uploadInvoiceFile(`/api/finance/branch-items/${targetId}/invoice`, form);
      }

      if (modal.type === "enrollment") {
        const body = {
          student: formString(form, "student"),
          courseId: formOptionalNumber(form, "courseId"),
          totalAmount: formNumber(form, "totalAmount"),
          installments: formNumber(form, "installments"),
          paymentMethodId: formOptionalNumber(form, "paymentMethodId"),
          cardBrandId: formOptionalNumber(form, "cardBrandId"),
          commissionPct: formNumber(form, "commissionPct"),
          firstMonth: formString(form, "firstMonth"),
          saleDate: formString(form, "saleDate"),
          sellerId: formOptionalNumber(form, "sellerId"),
          branchId: formOptionalNumber(form, "branchId"),
          notes: formString(form, "notes") || null,
        };
        await apiJson(modal.mode === "edit" ? `/api/finance/enrollments/${modal.record?.id}` : "/api/finance/enrollments", modal.mode === "edit" ? "PATCH" : "POST", body);
      }

      if (modal.type === "commission") {
        await apiJson("/api/finance/commissions", "POST", {
          date: formString(form, "date"),
          sellerId: formOptionalNumber(form, "sellerId"),
          student: formString(form, "student"),
          courseId: formOptionalNumber(form, "courseId"),
          saleAmount: formNumber(form, "saleAmount"),
          percent: formNumber(form, "percent"),
          paymentMethodId: formOptionalNumber(form, "paymentMethodId"),
          installments: formNumber(form, "installments"),
          notes: formString(form, "notes") || null,
        });
      }

      setModal(null);
      refresh("Registro salvo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  // Recorte ativo do filtro do topo. Em "Mês" é um mês só; em "Período" é o
  // intervalo escolhido; em "Tudo" é todo o histórico resolvido no servidor.
  // As abas rotulam e filtram por ele, não pelo mês base.
  const periodFrom = filters.from || month;
  const periodTo = filters.to || month;
  const periodLabel =
    periodMode === "all"
      ? "todos os meses"
      : periodFrom === periodTo
        ? monthLabel(periodFrom)
        : `${monthLabel(periodFrom)} a ${monthLabel(periodTo)}`;
  // Em "Tudo" o addon por aba não tem o que alternar: o recorte global já é o
  // histórico inteiro.
  const showVisaoToggle = periodMode !== "all";

  // Dimensões que só existem em receita: filtrar por elas deixa o resultado do
  // período com 100% das despesas contra uma fatia da receita.
  const partialFilterLabels = [
    filters.courseId ? "curso" : null,
    filters.sellerId ? "vendedor" : null,
    filters.paymentMethodId ? "forma de pagamento" : null,
    filters.categoryId ? "categoria" : null,
  ].filter((item): item is string => item !== null);

  const chartMonthly = summary.monthly.map((item) => ({
    mes: item.month.slice(5),
    receitas: item.revenue,
    despesas: item.totalExpenses,
    lucro: item.profit,
    fixos: item.fixedExpenses + item.commissions,
    variaveis: item.variableExpenses,
    saldo: item.profit,
  }));

  return (
    <div className="min-h-full bg-[#f5f8fb]">
      <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md bg-cyan-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-cyan-700">
              <WalletCards size={14} />
              VozUP
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Gestão Financeira</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Dashboard, fluxo de caixa, receitas, despesas, implantação, matrículas, comissões e consolidação para investidores.
            </p>
          </div>
          <div className="grid w-full gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <Field label="Tipo de período">
              <div className="grid h-10 grid-cols-3 rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setLocalFilters((current) => ({ ...current, periodMode: "month", from: current.month, to: current.month }))}
                  className={cn(
                    "rounded-md text-xs font-black transition",
                    localFilters.periodMode === "month" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  Mês
                </button>
                <button
                  type="button"
                  onClick={() => setLocalFilters((current) => ({
                    ...current,
                    periodMode: "custom",
                    from: current.from || current.month,
                    to: current.to || current.month,
                  }))}
                  className={cn(
                    "rounded-md text-xs font-black transition",
                    localFilters.periodMode === "custom" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  Período
                </button>
                <button
                  type="button"
                  onClick={() => setLocalFilters((current) => ({ ...current, periodMode: "all" }))}
                  className={cn(
                    "rounded-md text-xs font-black transition",
                    localFilters.periodMode === "all" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  Tudo
                </button>
              </div>
            </Field>
            {/* Em "Período" o mês base é o próprio início do intervalo — manter os
                dois campos fazia o usuário escolher três datas para um recorte só. */}
            {localFilters.periodMode === "month" ? (
              <Field label="Mês">
                <input
                  type="month"
                  value={localFilters.month}
                  onChange={(event) => setLocalFilters((current) => ({
                    ...current,
                    month: event.target.value,
                    from: event.target.value,
                    to: event.target.value,
                  }))}
                  className={inputClass}
                />
              </Field>
            ) : null}
            {localFilters.periodMode === "custom" ? (
              <>
                <Field label="De mês">
                  <input
                    type="month"
                    value={localFilters.from}
                    onChange={(event) => setLocalFilters((current) => ({ ...current, from: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Até mês">
                  <input
                    type="month"
                    value={localFilters.to}
                    onChange={(event) => setLocalFilters((current) => ({ ...current, to: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
              </>
            ) : null}
            {periodMode === "all" && localFilters.periodMode === "all" ? (
              <Field label="Intervalo">
                <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600">
                  {monthLabel(periodFrom)} a {monthLabel(periodTo)}
                </div>
              </Field>
            ) : null}
            <Field label="Unidade">
              <select value={localFilters.branchId} onChange={(event) => setLocalFilters((current) => ({ ...current, branchId: event.target.value }))} className={inputClass}>
                <option value="">Todas</option>
                {catalog.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Curso">
              <select value={localFilters.courseId} onChange={(event) => setLocalFilters((current) => ({ ...current, courseId: event.target.value }))} className={inputClass}>
                <option value="">Todos</option>
                {catalog.courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Vendedor">
              <select value={localFilters.sellerId} onChange={(event) => setLocalFilters((current) => ({ ...current, sellerId: event.target.value }))} className={inputClass}>
                <option value="">Todos</option>
                {catalog.sellers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <button type="button" onClick={applyFilters} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800">
                <Filter size={16} /> Filtrar
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex gap-2 overflow-x-auto pb-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-black transition",
                  activeTab === tab.key
                    ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:text-cyan-700"
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {message ? (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-bold text-cyan-800">
            <span>{message}</span>
            <button type="button" onClick={() => setMessage(null)} aria-label="Fechar aviso">
              <X size={16} />
            </button>
          </div>
        ) : null}

        {partialFilterLabels.length > 0 ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-black">Filtro parcial:</span>{" "}
            {partialFilterLabels.join(" e ")} {partialFilterLabels.length === 1 ? "filtra" : "filtram"} apenas as receitas — despesas
            fixas, variáveis e comissões não têm essa informação e continuam inteiras. Lucro e margem ficam distorcidos neste recorte.
          </div>
        ) : null}

        {activeTab === "dashboard" ? (
          <DashboardTab summary={summary} chartMonthly={chartMonthly} month={month} filters={filters} />
        ) : null}

        {activeTab === "fluxo" ? (
          <FluxoTab
            monthly={localFilters.fluxoVisao === "todos" && allMonthlyTotals ? allMonthlyTotals : summary.monthly}
            cashBalance={summary.cashBalance}
            periodLabel={periodLabel}
            showVisaoToggle={showVisaoToggle}
            fluxoVisao={localFilters.fluxoVisao}
            onChangeFluxoVisao={(next) => setVisao("fluxoVisao", next)}
          />
        ) : null}

        {activeTab === "receitas" ? (
          <ReceitasTab
            rows={revenues}
            periodLabel={periodLabel}
            showVisaoToggle={showVisaoToggle}
            periodFrom={periodFrom}
            periodTo={periodTo}
            receitasVisao={localFilters.receitasVisao}
            onChangeReceitasVisao={(next) => setVisao("receitasVisao", next)}
            onOpenEnrollment={(enrollmentId) => setPaymentsPanelEnrollment({ id: enrollmentId, readOnly: true })}
          />
        ) : null}

        {activeTab === "gastos" ? (
          <GastosTab
            fixed={fixedExpenses}
            fixedExpensesLocked={fixedExpensesLocked}
            variable={variableExpenses}
            totals={currentTotals as FinanceMonthTotals}
            onAddFixed={() => setModal({ type: "fixed", mode: "create" })}
            onEditFixed={(record) => setModal({ type: "fixed", mode: "edit", record })}
            onDeleteFixed={(record) => destroy(`/api/finance/fixed-expenses/${record.id}`, "despesa fixa")}
            onAddVariable={() => setModal({ type: "variable", mode: "create" })}
            onEditVariable={(record) => setModal({ type: "variable", mode: "edit", record })}
            onDeleteVariable={(record) => destroy(`/api/finance/variable-expenses/${record.id}`, "despesa variável")}
          />
        ) : null}

        {activeTab === "filiais" ? (
          <FiliaisTab
            rows={branchItems}
            onAdd={() => setModal({ type: "branch", mode: "create" })}
            onEdit={(record) => setModal({ type: "branch", mode: "edit", record })}
            onDelete={(record) => destroy(`/api/finance/branch-items/${record.id}`, "item de filial")}
            onChangePhase={async (record, phase) => {
              try {
                await apiJson(`/api/finance/branch-items/${record.id}`, "PATCH", { phase });
                refresh("Fase atualizada.");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Falha ao mover item.");
              }
            }}
          />
        ) : null}

        {activeTab === "matriculas" ? (
          <MatriculasTab
            rows={enrollments}
            catalog={catalog}
            periodLabel={periodLabel}
            showVisaoToggle={showVisaoToggle}
            matriculasVisao={localFilters.matriculasVisao}
            onChangeMatriculasVisao={(next) => setVisao("matriculasVisao", next)}
            onAdd={() => setModal({ type: "enrollment", mode: "create" })}
            onEdit={(record) => setModal({ type: "enrollment", mode: "edit", record })}
            onDelete={(record) => destroy(`/api/finance/enrollments/${record.id}`, "matrícula")}
            onOpenPayments={(enrollmentId) => setPaymentsPanelEnrollment({ id: enrollmentId, readOnly: false })}
          />
        ) : null}

        {activeTab === "agenda" ? (
          <AgendaTab
            rows={agenda}
            month={localFilters.month}
            onSaveCapacity={async (trainingId, capacity) => {
              await apiJson("/api/finance/agenda/capacities", "POST", { trainingId, capacity });
              refresh("Capacidade da turma atualizada.");
            }}
            onSaveSchedule={async (trainingId, schedule) => {
              await apiJson("/api/finance/agenda/schedules", "POST", { trainingId, ...schedule });
              refresh("Calendário da turma atualizado.");
            }}
            onCreateClass={async (classInput) => {
              await apiJson("/api/finance/agenda/classes", "POST", classInput);
              refresh("Turma criada na agenda.");
            }}
            onDeleteClass={async (trainingId) => {
              await apiJson(`/api/finance/agenda/classes/${encodeURIComponent(trainingId)}`, "DELETE");
              refresh("Turma excluída da agenda.");
            }}
          />
        ) : null}

        {activeTab === "comissoes" ? (
          <ComissoesTab
            rows={commissions}
            panel={commissionPanel}
            overview={commissionsOverview}
            month={month}
            periodLabel={periodLabel}
            showVisaoToggle={showVisaoToggle}
            comissoesVisao={localFilters.comissoesVisao}
            onChangeComissoesVisao={(next) => setVisao("comissoesVisao", next)}
            onAdd={() => setModal({ type: "commission", mode: "create" })}
            onDelete={(record) => destroy(`/api/finance/commissions/${record.id}`, "comissão")}
            onStatus={async (id, status) => {
              await apiJson(`/api/finance/commission-installments/${id}`, "PATCH", { status });
              refresh("Parcela atualizada.");
            }}
            onToggleRealCommission={async (paymentId, status, source) => {
              const base = source === "matricula" ? "enrollment-payments" : "revenue-payments";
              await apiJson(`/api/finance/${base}/${paymentId}/commission-status`, "PATCH", { status });
              refresh("Comissão atualizada.");
            }}
          />
        ) : null}

        {activeTab === "trimestral" ? (
          <TrimestralTab summary={summary} month={month} filters={filters} />
        ) : null}

        {activeTab === "configuracoes" ? (
          <ConfiguracoesTab catalog={catalog} onSaved={() => refresh("Configuração salva.")} apiJson={apiJson} />
        ) : null}

        {activeTab === "auditoria" ? <FinanceAuditPanel canDelete={canDeleteAuditEvents} /> : null}
      </div>

      {modal ? (
        <FinanceModal
          modal={modal}
          catalog={catalog}
          month={month}
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={submitModal}
          revenueCategories={revenueCategories}
          fixedCategories={fixedCategories}
          variableCategories={variableCategories}
          courses={activeCourses}
          branches={activeBranches}
          sellers={activeSellers}
          paymentMethods={activePaymentMethods}
          onCreateCategory={createCategory}
        />
      ) : null}

      {paymentsPanelEnrollment ? (
        <EnrollmentPaymentsPanel
          enrollmentId={paymentsPanelEnrollment.id}
          cardBrands={catalog.cardBrands.filter((brand) => brand.active)}
          readOnly={paymentsPanelEnrollment.readOnly}
          onClose={() => setPaymentsPanelEnrollment(null)}
          onChanged={() => refresh()}
        />
      ) : null}
    </div>
  );
}

function DashboardTab({
  summary,
  chartMonthly,
  month,
  filters,
}: {
  summary: FinanceDashboardSummary;
  chartMonthly: ChartMonthlyPoint[];
  month: string;
  filters: FinanceFilters;
}) {
  return (
    <div className="space-y-5">
      <FuturePeriodNotice period={summary.effectivePeriod} />

      <FinanceOverviewPanel summary={summary} />

      <TotalSpendPanel spend={summary.allTimeSpend} />

      <FinanceAlertsPanel alerts={summary.alerts} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {summary.kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Fluxo de Caixa Mensal">
          <CashFlowMonthlyChart data={chartMonthly} />
        </ChartCard>

        <ChartCard title="Receitas x Despesas">
          <RevenueExpenseChart data={chartMonthly} />
        </ChartCard>

        <ChartCard title="Lucro Mensal">
          <ProfitMonthlyChart data={chartMonthly} />
        </ChartCard>

        <ChartCard title="Distribuição de Despesas">
          <ExpenseDistributionChart data={summary.expenseDistribution} />
        </ChartCard>

        <ChartCard title="Receita por Curso">
          <SimpleBarChart data={summary.revenueByCourse} />
        </ChartCard>

        <ChartCard title="Receita por Unidade">
          <SimpleBarChart data={summary.revenueByBranch} />
        </ChartCard>

        <ChartCard title="Comissão por Vendedor">
          <SimpleBarChart data={summary.commissionBySeller} />
        </ChartCard>

        <ChartCard title="Comparativo Trimestral">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.quarterly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} />
              <Tooltip formatter={(value) => money(Number(value))} />
              <Bar dataKey="revenue" fill="#06a8d8" radius={[6, 6, 0, 0]} />
              <Bar dataKey="profit" fill="#12a594" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ExportCenter month={month} filters={filters} />
    </div>
  );
}

function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function SingleMonthTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { name?: string; value?: number; color?: string } }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color ?? "#64748b" }} />
        <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{item.name}</span>
      </div>
      <p className="mt-1 text-sm font-black text-slate-950">{money(item.value)}</p>
    </div>
  );
}

function SingleMonthBars({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
        <YAxis tickFormatter={chartTick} width={62} tick={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="#94a3b8" />
        <Tooltip cursor={false} content={<SingleMonthTooltip />} />
        <Bar dataKey="value" maxBarSize={52} radius={[6, 6, 0, 0]}>
          {data.map((item) => <Cell key={item.name} fill={item.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function CashFlowMonthlyChart({ data }: { data: ChartMonthlyPoint[] }) {
  if (data.length === 0) return <EmptyChart />;
  const legend = [
    { label: "Receitas", color: "#06a8d8" },
    { label: "Despesas", color: "#e54666" },
    { label: "Lucro", color: "#12a594" },
  ];
  if (data.length === 1) {
    const point = data[0];
    return (
      <div className="h-full">
        <ChartLegend items={legend} />
        <div className="h-[calc(100%-1.75rem)]">
          <SingleMonthBars
            data={[
              { name: "Receitas", value: point.receitas, color: "#06a8d8" },
              { name: "Despesas", value: point.despesas, color: "#e54666" },
              { name: "Lucro", value: point.lucro, color: point.lucro >= 0 ? "#12a594" : "#e54666" },
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <ChartLegend items={legend} />
      <div className="h-[calc(100%-1.75rem)]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ right: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={chartTick} width={62} tick={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Tooltip formatter={(value) => money(Number(value))} />
            <Line type="monotone" dataKey="receitas" stroke="#06a8d8" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="despesas" stroke="#e54666" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="lucro" stroke="#12a594" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RevenueExpenseChart({ data }: { data: ChartMonthlyPoint[] }) {
  if (data.length === 0) return <EmptyChart />;
  const legend = [
    { label: "Receitas", color: "#06a8d8" },
    { label: "Despesas", color: "#e54666" },
  ];
  if (data.length === 1) {
    const point = data[0];
    return (
      <div className="h-full">
        <ChartLegend items={legend} />
        <div className="h-[calc(100%-1.75rem)]">
          <SingleMonthBars
            data={[
              { name: "Receitas", value: point.receitas, color: "#06a8d8" },
              { name: "Despesas", value: point.despesas, color: "#e54666" },
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <ChartLegend items={legend} />
      <div className="h-[calc(100%-1.75rem)]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="42%" margin={{ right: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={chartTick} width={62} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => money(Number(value))} />
            <Bar dataKey="receitas" fill="#06a8d8" radius={[6, 6, 0, 0]} maxBarSize={42} />
            <Bar dataKey="despesas" fill="#e54666" radius={[6, 6, 0, 0]} maxBarSize={42} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ProfitMonthlyChart({ data }: { data: ChartMonthlyPoint[] }) {
  if (data.length === 0) return <EmptyChart />;
  if (data.length === 1) {
    const point = data[0];
    const margin = point.receitas > 0 ? (point.lucro / point.receitas) * 100 : 0;
    return (
      <div className="grid h-full gap-4 md:grid-cols-[0.9fr_1.25fr]">
        <div className="grid content-center gap-3">
          <MetricRow label="Lucro líquido" value={money(point.lucro)} tone={point.lucro >= 0 ? "good" : "bad"} />
          <MetricRow label="Margem" value={percent(margin)} />
          <MetricRow label="Receitas" value={money(point.receitas)} />
          <MetricRow label="Despesas" value={money(point.despesas)} />
        </div>
        <div className="min-h-36 md:min-h-0">
          <SingleMonthBars data={[{ name: "Lucro", value: point.lucro, color: point.lucro >= 0 ? "#12a594" : "#e54666" }]} />
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ right: 18, left: 0 }}>
        <defs>
          <linearGradient id="profitGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#12a594" stopOpacity={0.32} />
            <stop offset="95%" stopColor="#12a594" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={chartTick} width={62} tick={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="#94a3b8" />
        <Tooltip formatter={(value) => money(Number(value))} />
        <Area type="monotone" dataKey="lucro" stroke="#12a594" strokeWidth={3} fill="url(#profitGradient)" dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MetricRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span
        className={cn(
          "text-sm font-black",
          tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-slate-950"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ExpenseDistributionChart({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) return <EmptyChart />;
  const ordered = [...data].sort((left, right) => right.value - left.value);
  const total = ordered.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="grid h-full gap-4 lg:grid-cols-[0.95fr_1.2fr]">
      <div className="min-h-36 lg:min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip formatter={(value) => money(Number(value))} />
            <Pie data={ordered} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={3}>
              {ordered.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-h-0 overflow-y-auto pr-1">
        <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Total</span>
          <span className="text-sm font-black text-slate-950">{money(total)}</span>
        </div>
        <div className="space-y-2">
          {ordered.map((item, index) => {
            const share = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <div key={item.name} className="grid gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-bold text-slate-700">
                    <span className="size-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="whitespace-nowrap text-sm font-black text-slate-950">{money(item.value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                </div>
                <p className="text-right text-[11px] font-bold text-slate-500">{percent(share)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SimpleBarChart({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 18, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" tickFormatter={chartTick} />
        <YAxis type="category" dataKey="name" width={116} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => money(Number(value))} />
        <Bar dataKey="value" fill="#06a8d8" radius={[0, 6, 6, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function FluxoTab({
  monthly,
  cashBalance,
  periodLabel,
  showVisaoToggle,
  fluxoVisao,
  onChangeFluxoVisao,
}: {
  monthly: FinanceMonthTotals[];
  cashBalance: number;
  periodLabel: string;
  showVisaoToggle: boolean;
  fluxoVisao: "mes" | "todos";
  onChangeFluxoVisao: (next: "mes" | "todos") => void;
}) {
  const current = monthly[monthly.length - 1];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <KpiMini label="Receitas" value={money(current?.revenue)} />
        <KpiMini label="Despesas Fixas" value={money((current?.fixedExpenses ?? 0) + (current?.commissions ?? 0))} />
        <KpiMini label="Despesas Variáveis" value={money(current?.variableExpenses)} />
        <KpiMini label="Total de Despesas" value={money(current?.totalExpenses)} />
        <KpiMini label="Lucro Líquido" value={money(current?.profit)} />
        <KpiMini label="Margem" value={percent(current?.margin)} />
        <KpiMini label="Saldo Final" value={money(cashBalance)} />
      </div>
      {showVisaoToggle ? <VisaoToggle visao={fluxoVisao} periodLabel={periodLabel} onChange={onChangeFluxoVisao} itemsLabel="Tabela mensal" /> : null}
      <Section>
        <SectionHeader title="Fluxo de caixa dinâmico" subtitle="Uma tela por período, atualizada pelo seletor de mês e ano." />
        <div className="p-5">
          <SmartTable
            rows={monthly}
            columns={[
              { key: "month", label: "Mês", render: (r) => r.month, value: (r) => r.month },
              { key: "revenue", label: "Receitas", render: (r) => money(r.revenue), value: (r) => r.revenue },
              { key: "fixed", label: "Despesas Fixas", render: (r) => money(r.fixedExpenses + r.commissions), value: (r) => r.fixedExpenses + r.commissions },
              { key: "variable", label: "Despesas Variáveis", render: (r) => money(r.variableExpenses), value: (r) => r.variableExpenses },
              { key: "total", label: "Total Despesas", render: (r) => money(r.totalExpenses), value: (r) => r.totalExpenses },
              { key: "profit", label: "Lucro", render: (r) => money(r.profit), value: (r) => r.profit },
              { key: "margin", label: "Margem", render: (r) => percent(r.margin), value: (r) => r.margin },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}

export function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--dashboard-card-shadow)]">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <div className="inline-flex items-center justify-end gap-1.5">{children}</div>;
}

function ReceitasTab({
  rows,
  periodLabel,
  showVisaoToggle,
  periodFrom,
  periodTo,
  receitasVisao,
  onChangeReceitasVisao,
  onOpenEnrollment,
}: {
  rows: FinanceRevenue[];
  periodLabel: string;
  showVisaoToggle: boolean;
  periodFrom: string;
  periodTo: string;
  receitasVisao: "mes" | "todos";
  onChangeReceitasVisao: (next: "mes" | "todos") => void;
  onOpenEnrollment: (enrollmentId: number) => void;
}) {
  const [scope, setScope] = useState<"todas" | "avulsas" | "parcelas">("todas");
  const visibleRows = rows.filter((item) => scope === "todas" || (scope === "avulsas" ? item.revenueMode === "avulso" : item.enrollmentId !== null));
  const activeRows = visibleRows.filter((item) => item.status !== "cancelado");
  // Mesmo com a lista em "todos os meses", os indicadores acima sempre
  // representam somente o recorte escolhido no filtro global (mês ou período).
  const monthRows = activeRows.filter((item) => {
    const itemMonth = item.date.slice(0, 7);
    return itemMonth >= periodFrom && itemMonth <= periodTo;
  });
  const total = monthRows.reduce((sum, item) => sum + item.amount, 0);
  // Matrículas nunca viram "recebidas" apenas pelo status legado: o valor só
  // entra no caixa depois de um pagamento real ser lançado e vinculado à parcela.
  const isTracked = (item: FinanceRevenue) => item.revenueMode === "avulso" || item.enrollmentId !== null;
  const receivedFor = (item: FinanceRevenue) => isTracked(item) ? item.paidAmount : item.status === "recebido" ? item.amount : 0;
  const balanceFor = (item: FinanceRevenue) => isTracked(item) ? item.balanceRemaining : item.status === "recebido" ? 0 : item.amount;
  const feesFor = (item: FinanceRevenue) => isTracked(item) ? item.paymentsFeeTotal : item.feeAmount;
  const netReceivedFor = (item: FinanceRevenue) => isTracked(item) ? item.netReceived : item.status === "recebido" ? item.amount - item.feeAmount : 0;
  const statusFor = (item: FinanceRevenue): RevenueStatus => {
    if (item.enrollmentId === null) return item.status;
    if (item.paidAmount >= item.amount) return "recebido";
    if (item.paidAmount > 0) return "parcial";
    return (item.dueDate ?? item.date) < new Date().toISOString().slice(0, 10) ? "atrasado" : "previsto";
  };
  const totalRecebido = monthRows.reduce((sum, item) => sum + receivedFor(item), 0);
  const totalSaldo = monthRows.reduce((sum, item) => sum + balanceFor(item), 0);
  const totalAtrasado = monthRows.filter((item) => statusFor(item) === "atrasado").reduce((sum, item) => sum + balanceFor(item), 0);
  const totalTaxas = monthRows.reduce((sum, item) => sum + feesFor(item), 0);
  const totalComissao = monthRows.reduce((sum, item) => sum + item.paymentsCommissionTotal, 0);
  const totalLiquidoRecebido = monthRows.reduce((sum, item) => sum + netReceivedFor(item), 0);
  const totalTaxasPrevistas = monthRows.reduce((sum, item) => sum + feesFor(item), 0);
  const totalLiquidoPrevisto = Math.max(0, total - totalTaxasPrevistas);
  return (
    <div className="space-y-5">
      {showVisaoToggle ? <VisaoToggle visao={receitasVisao} periodLabel={periodLabel} onChange={onChangeReceitasVisao} itemsLabel="Lista" /> : null}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950">
        <span className="font-black">Leitura financeira:</span>
        <span>Esta aba é somente para acompanhamento. Cadastre e receba valores em Matrículas; aqui cada parcela mostra o que foi previsto, recebido e ainda pode ser recebido.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["todas", "avulsas", "parcelas"] as const).map((item) => (
          <button key={item} type="button" onClick={() => setScope(item)} className={cn("rounded-lg border px-3 py-2 text-xs font-black", scope === item ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300") }>
            {item === "todas" ? "Todas" : item === "avulsas" ? "Receitas avulsas" : "Parcelas de matrículas"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiMini label={`Previsto em ${periodLabel}`} value={money(total)} />
        <KpiMini label="Recebido" value={money(totalRecebido)} />
        <KpiMini label="Saldo a receber" value={money(totalSaldo)} />
        <KpiMini label="Em atraso" value={money(totalAtrasado)} />
        <KpiMini label="Total de Taxas" value={money(totalTaxas)} />
        <KpiMini label="Total de Comissão" value={money(totalComissao)} />
        <KpiMini label="Líquido Recebido" value={money(totalLiquidoRecebido)} />
        <KpiMini label="Líquido Previsto" value={money(totalLiquidoPrevisto)} />
      </div>
      <Section>
        <SectionHeader
          title="Receitas e contas a receber"
          subtitle={`${monthRows.length} lançamento(s) no mês · previsto: ${money(total)} · recebido: ${money(totalRecebido)}`}
        />
        <div className="p-5">
          <SmartTable
            rows={visibleRows}
            columns={[
              { key: "date", label: "Data", render: (r) => r.date, value: (r) => r.date },
              { key: "description", label: "Descrição", render: (r) => r.description, value: (r) => r.description },
              { key: "category", label: "Categoria", render: (r) => r.categoryName ?? "Sem categoria", value: (r) => r.categoryName },
              { key: "dueDate", label: "Vencimento", render: (r) => (r.dueDate ? dateLabel(r.dueDate) : "-"), value: (r) => r.dueDate },
              { key: "student", label: "Aluno/Lead", render: (r) => r.leadName ?? r.student ?? "-", value: (r) => r.leadName ?? r.student },
              { key: "seller", label: "Vendedor", render: (r) => r.sellerName ?? "-", value: (r) => r.sellerName },
              { key: "amount", label: "Valor", render: (r) => money(r.amount), value: (r) => r.amount },
              {
                key: "paid",
                label: "Recebido",
                render: (r) => money(receivedFor(r)),
                value: (r) => receivedFor(r),
              },
              {
                key: "balance",
                label: "Saldo Restante",
                render: (r) => money(balanceFor(r)),
                value: (r) => balanceFor(r),
              },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <StatusBadge status={statusFor(r)} label={isTracked(r) ? AVULSO_STATUS_LABELS[statusFor(r)] : undefined} />
                ),
                value: (r) => statusFor(r),
              },
              {
                key: "invoice",
                label: "Comprovante",
                render: (r) => <InvoiceLinks fileHref={r.hasInvoiceFile ? `/api/finance/revenues/${r.id}/invoice` : null} filename={r.invoiceFilename} />,
                value: (r) => r.invoiceFilename,
              },
            ]}
            actions={(record) => (
              <RowActions>
                {record.enrollmentId !== null ? <IconButton title="Ver matrícula e recebimentos" onClick={() => onOpenEnrollment(record.enrollmentId!)}><WalletCards size={15} /></IconButton> : <span className="text-xs font-semibold text-slate-400">Somente leitura</span>}
              </RowActions>
            )}
          />
        </div>
      </Section>
    </div>
  );
}

/**
 * Ordem de exibição das despesas fixas dentro da mesma lista: logística
 * primeiro (bloco fixo, em ordem alfabética entre si), depois folha de
 * pagamento (bloco fixo), depois todas as demais categorias — incluindo
 * "Sem categoria" — em ordem alfabética pelo nome, cada uma formando seu
 * próprio bloco (um item nunca "fura a fila" para outro bloco só porque a
 * descrição dele viria antes no alfabeto). Dentro de cada bloco, ordem
 * alfabética pela descrição.
 */
const FIXED_LOGISTICS_CATEGORY_ORDER = ["Agência de Marketing", "Água", "Aluguel/IPTU", "Impressoras", "Internet", "Luz", "Seguro"];
const FIXED_PAYROLL_CATEGORY_NAME = "Folha de Pagamento";
const FIXED_UNCATEGORIZED_LABEL = "Sem categoria";

function fixedCategoryGroupRank(categoryName: string | null): number {
  const logisticsIndex = categoryName === null ? -1 : FIXED_LOGISTICS_CATEGORY_ORDER.indexOf(categoryName);
  if (logisticsIndex !== -1) return logisticsIndex;
  if (categoryName === FIXED_PAYROLL_CATEGORY_NAME) return FIXED_LOGISTICS_CATEGORY_ORDER.length;
  // Todas as demais categorias (e "Sem categoria") caem no mesmo nível e são
  // desempatadas abaixo pelo nome, então cada uma vira seu próprio bloco em
  // ordem alfabética — sem posição fixa reservada para "Sem categoria".
  return FIXED_LOGISTICS_CATEGORY_ORDER.length + 1;
}

/** Chave de ordenação (categoria → alfabética) usada só para ordenar; a célula continua mostrando a descrição normal. */
function fixedExpenseSortKey(row: FinanceFixedExpense): string {
  const rank = String(fixedCategoryGroupRank(row.categoryName)).padStart(2, "0");
  const category = (row.categoryName ?? FIXED_UNCATEGORIZED_LABEL).toLowerCase();
  return `${rank}|${category}|${row.description.toLowerCase()}`;
}

/** Addon "ver todos os meses" — reaproveitado nas abas Despesas, Receitas, Fluxo, Matrículas e Comissões. */
function VisaoToggle({
  visao,
  periodLabel,
  onChange,
  itemsLabel = "Cards e listas",
}: {
  visao: "mes" | "todos";
  /** "julho de 2026" ou "julho de 2026 a dezembro de 2026" — o recorte do filtro do topo. */
  periodLabel: string;
  onChange: (next: "mes" | "todos") => void;
  itemsLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div>
        <p className="text-sm font-black text-slate-900">
          {itemsLabel} exibindo: {visao === "todos" ? "todos os meses" : periodLabel}
        </p>
        <p className="text-xs text-slate-500">
          Por padrão mostra só o período selecionado no filtro do topo.
        </p>
      </div>
      <div className="grid h-10 grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => onChange("mes")}
          className={cn(
            "rounded-md px-3 text-xs font-black transition",
            visao === "mes" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          Mês selecionado
        </button>
        <button
          type="button"
          onClick={() => onChange("todos")}
          className={cn(
            "rounded-md px-3 text-xs font-black transition",
            visao === "todos" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          Todos os meses
        </button>
      </div>
    </div>
  );
}

function GastosTab({
  fixed,
  fixedExpensesLocked,
  variable,
  totals,
  onAddFixed,
  onEditFixed,
  onDeleteFixed,
  onAddVariable,
  onEditVariable,
  onDeleteVariable,
}: {
  fixed: FinanceFixedExpense[];
  fixedExpensesLocked: boolean;
  variable: FinanceVariableExpense[];
  totals: FinanceMonthTotals;
  onAddFixed: () => void;
  onEditFixed: (record: FinanceFixedExpense) => void;
  onDeleteFixed: (record: FinanceFixedExpense) => void;
  onAddVariable: () => void;
  onEditVariable: (record: FinanceVariableExpense) => void;
  onDeleteVariable: (record: FinanceVariableExpense) => void;
}) {
  const dueSoon = fixed
    .map((item) => ({ item, days: daysUntil(item.dueDate) }))
    .filter((entry): entry is { item: FinanceFixedExpense; days: number } =>
      entry.days !== null && entry.days >= 0 && entry.days <= 3 && entry.item.status !== "pago"
    )
    .sort((left, right) => left.days - right.days);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiMini label="Receitas" value={money(totals.revenue)} />
        <KpiMini label="Despesas Fixas" value={money(totals.fixedExpenses + totals.commissions)} />
        <KpiMini label="Despesas Variáveis" value={money(totals.variableExpenses)} />
        <KpiMini label="Total de Despesas" value={money(totals.totalExpenses)} />
        <KpiMini label="Lucro Líquido" value={money(totals.profit)} />
        <KpiMini label="Margem" value={percent(totals.margin)} />
      </div>

      <Section>
        <SectionHeader
          title="Notificações"
          subtitle={dueSoon.length > 0 ? `${dueSoon.length} conta${dueSoon.length === 1 ? "" : "s"} próxima${dueSoon.length === 1 ? "" : "s"} do vencimento` : undefined}
        />
        <div className="p-5">
          {dueSoon.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {dueSoon.map(({ item, days }) => (
                <div key={item.id} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="grid size-9 flex-shrink-0 place-content-center rounded-lg bg-amber-100 text-amber-700">
                    <BellRing size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-amber-950">{item.description}</p>
                      <span className="rounded-md bg-white px-2 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">
                        {dueLabel(days)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-amber-800">
                      {money(item.amount + (item.benefitsAmount ?? 0))} · vencimento {item.dueDate}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-600">
              <CheckCircle2 size={18} className="text-emerald-600" />
              Nenhuma conta vencendo nos próximos 3 dias.
            </div>
          )}
        </div>
      </Section>

      <Section>
        <SectionHeader title="Despesas Fixas" subtitle="Ordenadas por categoria — logística primeiro, depois folha de pagamento, depois as demais — e alfabeticamente dentro de cada categoria." action={<button type="button" onClick={onAddFixed} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar fixa</button>} />
        <div className="p-5">
          {fixedExpensesLocked ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-600">
              <LockKeyhole size={18} className="text-slate-500" />
              Despesas fixas passaram a existir apenas em junho de 2026.
            </div>
          ) : <SmartTable
            rows={fixed}
            defaultSortDir="asc"
            defaultSortKey={undefined}
            columns={[
              { key: "description", label: "Descrição", render: (r) => r.description, value: (r) => fixedExpenseSortKey(r) },
              {
                key: "category",
                label: "Categoria",
                render: (r) => r.categoryName ? r.categoryName : <span className="inline-flex items-center gap-1 font-black text-amber-700"><BellRing size={12} />{FIXED_UNCATEGORIZED_LABEL}</span>,
                value: (r) => r.categoryName,
              },
              { key: "due", label: "Vencimento", render: (r) => r.dueDate ?? "-", value: (r) => r.dueDate },
              { key: "lock", label: "Trava", render: (r) => <RecurringLockBadge record={r} />, value: (r) => r.recurringLocked ? `travado-${r.recurringDueDay ?? ""}` : "livre" },
              { key: "salary", label: "Salário", render: (r) => r.kind === "folha" ? money(r.amount) : "-", value: (r) => r.kind === "folha" ? r.amount : 0 },
              { key: "benefits", label: "Benefícios", render: (r) => r.kind === "folha" ? money(r.benefitsAmount) : "-", value: (r) => r.benefitsAmount ?? 0 },
              { key: "amount", label: "Total", render: (r) => money(r.amount + (r.benefitsAmount ?? 0)), value: (r) => r.amount + (r.benefitsAmount ?? 0) },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
              { key: "paid", label: "Pago em", render: (r) => r.paidAt ?? "-", value: (r) => r.paidAt },
              { key: "invoice", label: "Nota", render: (r) => <InvoiceLinks fileHref={r.hasInvoiceFile ? `/api/finance/fixed-expenses/${r.id}/invoice` : null} invoiceUrl={r.invoiceUrl} filename={r.invoiceFilename} />, value: (r) => r.invoiceFilename ?? r.invoiceUrl },
            ]}
            actions={(record) => (
              <RowActions>
                <IconButton title="Editar despesa fixa" onClick={() => onEditFixed(record)}><Edit3 size={15} /></IconButton>
                <IconButton title="Excluir despesa fixa" onClick={() => onDeleteFixed(record)} danger><Trash2 size={15} /></IconButton>
              </RowActions>
            )}
          />}
        </div>
      </Section>

      <Section>
        <SectionHeader title="Despesas Variáveis" subtitle="Categorias personalizadas e controle por unidade." action={<button type="button" onClick={onAddVariable} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar variável</button>} />
        <div className="p-5">
          <SmartTable
            rows={variable}
            defaultSortDir="asc"
            defaultSortKey="description"
            columns={[
              { key: "date", label: "Data", render: (r) => r.date, value: (r) => r.date },
              { key: "description", label: "Descrição", render: (r) => r.description, value: (r) => r.description },
              {
                key: "category",
                label: "Categoria",
                render: (r) => r.categoryName ?? "-",
                // Ordenar por esta coluna forma blocos por categoria (e, dentro de cada
                // categoria, ordem alfabética pela descrição) — fora isso a lista é plana.
                value: (r) => `${(r.categoryName ?? "Sem categoria").toLowerCase()}|${r.description.toLowerCase()}`,
              },
              { key: "branch", label: "Unidade", render: (r) => r.branchName ?? "-", value: (r) => r.branchName },
              { key: "amount", label: "Valor", render: (r) => money(r.amount), value: (r) => r.amount },
              { key: "invoice", label: "Nota", render: (r) => <InvoiceLinks fileHref={r.hasInvoiceFile ? `/api/finance/variable-expenses/${r.id}/invoice` : null} invoiceUrl={r.invoiceUrl} filename={r.invoiceFilename} />, value: (r) => r.invoiceFilename ?? r.invoiceUrl },
              { key: "notes", label: "Observação", render: (r) => r.notes ?? "-", value: (r) => r.notes },
            ]}
            actions={(record) => (
              <RowActions>
                <IconButton title="Editar despesa variável" onClick={() => onEditVariable(record)}><Edit3 size={15} /></IconButton>
                <IconButton title="Excluir despesa variável" onClick={() => onDeleteVariable(record)} danger><Trash2 size={15} /></IconButton>
              </RowActions>
            )}
          />
        </div>
      </Section>
    </div>
  );
}

function branchItemPhaseLabel(phase: BranchItemPhase): string {
  return phase === "pre_operacional" ? "Pré-operacional" : "Implementação";
}

type BranchCategorySummary = {
  name: string;
  value: number;
  count: number;
  implementation: number;
  preOperational: number;
};

function BranchCategoryBreakdown({
  data,
  selectedCategories,
  onToggleCategory,
}: {
  data: BranchCategorySummary[];
  selectedCategories: string[];
  onToggleCategory: (category: string) => void;
}) {
  if (data.length === 0) return null;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  const featured = data.slice(0, 4);

  return (
    <Section>
      <SectionHeader
        title="Resumo Visual por Categoria"
        subtitle={`Unidade Tatuapé · ${data.length} categorias · ${money(total)} no total`}
      />
      <div className="space-y-5 p-5 lg:p-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {featured.map((item, index) => {
            const share = total > 0 ? (item.value / total) * 100 : 0;
            const selected = selectedCategories.includes(item.name);
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => onToggleCategory(item.name)}
                className={cn(
                  "rounded-lg border p-4 text-left shadow-[var(--dashboard-card-shadow)] transition hover:border-cyan-200 hover:bg-cyan-50/50",
                  selected ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-7 place-content-center rounded-md bg-slate-950 text-xs font-black text-white">
                    {index + 1}
                  </span>
                  <span className="rounded-md bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-800 ring-1 ring-cyan-100">
                    {percent(share)}
                  </span>
                </div>
                <p className="mt-3 min-h-9 text-sm font-black leading-tight text-slate-950">{item.name}</p>
                <p className="mt-3 text-xl font-black text-slate-950">{money(item.value)}</p>
                <p className="mt-2 text-xs font-bold text-slate-500">
                  {item.count} {item.count === 1 ? "item" : "itens"}
                </p>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--dashboard-card-shadow)] lg:p-5">
          <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-950">Distribuição por gasto</h3>
            </div>
            <div className="flex flex-wrap gap-2.5 text-xs font-bold text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-cyan-500" />
                Implementação
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-amber-400" />
                Pré-operação
              </span>
            </div>
          </div>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
            {data.map((item, index) => {
              const share = total > 0 ? (item.value / total) * 100 : 0;
              const barWidth = Math.max(2, (item.value / maxValue) * 100);
              const implementationShare = item.value > 0 ? (item.implementation / item.value) * 100 : 0;
              const preOperationalShare = item.value > 0 ? (item.preOperational / item.value) * 100 : 0;
              const selected = selectedCategories.includes(item.name);
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onToggleCategory(item.name)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50/30 lg:p-4",
                    selected ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white"
                  )}
                >
                  <div className="grid gap-3 xl:grid-cols-[minmax(230px,340px)_1fr_minmax(150px,190px)] xl:items-center">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid size-6 flex-none place-content-center rounded-md bg-slate-100 text-[11px] font-black text-slate-700">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-black leading-snug text-slate-950">{item.name}</p>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            {item.count} {item.count === 1 ? "item" : "itens"} · {percent(share)} do total
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-2">
                      <div className="h-5 overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="flex h-full overflow-hidden rounded-md"
                          style={{ width: `${barWidth}%` }}
                        >
                          {item.implementation > 0 ? (
                            <div className="h-full bg-cyan-500" style={{ width: `${implementationShare}%` }} />
                          ) : null}
                          {item.preOperational > 0 ? (
                            <div className="h-full bg-amber-400" style={{ width: `${preOperationalShare}%` }} />
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-slate-500">
                        {item.implementation > 0 ? <span>Implementação {money(item.implementation)}</span> : null}
                        {item.preOperational > 0 ? <span>Pré-operação {money(item.preOperational)}</span> : null}
                      </div>
                    </div>

                    <div className="text-left lg:text-right">
                      <p className="text-base font-black text-slate-950">{money(item.value)}</p>
                      <p className="text-xs font-bold text-slate-500">
                        {selected ? "Filtro ativo" : "Clique para filtrar"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}

function BranchItemsPhaseGroup({
  phase,
  rows,
  onEdit,
  onDelete,
  onChangePhase,
}: {
  phase: BranchItemPhase;
  rows: FinanceBranchItem[];
  onEdit: (record: FinanceBranchItem) => void;
  onDelete: (record: FinanceBranchItem) => void;
  onChangePhase: (record: FinanceBranchItem, phase: BranchItemPhase) => void;
}) {
  const otherPhase: BranchItemPhase = phase === "pre_operacional" ? "implementacao" : "pre_operacional";
  const subtotal = rows.reduce((sum, item) => sum + item.amount, 0);
  return (
    <Section>
      <SectionHeader
        title={branchItemPhaseLabel(phase)}
        subtitle={`${rows.length} ${rows.length === 1 ? "item" : "itens"} · ${money(subtotal)}`}
      />
      <div className="p-5">
        <SmartTable
          rows={rows}
          searchPlaceholder={`Pesquisar em ${branchItemPhaseLabel(phase).toLowerCase()}`}
          columns={[
            { key: "branch", label: "Unidade", render: (r) => r.branchName, value: (r) => r.branchName },
            { key: "item", label: "Item", render: (r) => r.item, value: (r) => r.item },
            { key: "category", label: "Categoria", render: (r) => r.category, value: (r) => r.category },
            { key: "supplier", label: "Fornecedor", render: (r) => r.supplier ?? "-", value: (r) => r.supplier },
            { key: "amount", label: "Valor", render: (r) => money(r.amount), value: (r) => r.amount },
            { key: "date", label: "Data", render: (r) => r.date ?? "-", value: (r) => r.date },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
            { key: "invoice", label: "Nota", render: (r) => <InvoiceLinks fileHref={r.hasInvoiceFile ? `/api/finance/branch-items/${r.id}/invoice` : null} invoiceUrl={r.invoiceUrl} filename={r.invoiceFilename} />, value: (r) => r.invoiceFilename ?? r.invoiceUrl },
          ]}
          actions={(record) => (
            <RowActions>
              <IconButton title={`Mover para ${branchItemPhaseLabel(otherPhase)}`} onClick={() => onChangePhase(record, otherPhase)}><ArrowLeftRight size={15} /></IconButton>
              <IconButton title="Editar item" onClick={() => onEdit(record)}><Edit3 size={15} /></IconButton>
              <IconButton title="Excluir item" onClick={() => onDelete(record)} danger><Trash2 size={15} /></IconButton>
            </RowActions>
          )}
        />
      </div>
    </Section>
  );
}

function FiliaisTab({
  rows,
  onAdd,
  onEdit,
  onDelete,
  onChangePhase,
}: {
  rows: FinanceBranchItem[];
  onAdd: () => void;
  onEdit: (record: FinanceBranchItem) => void;
  onDelete: (record: FinanceBranchItem) => void;
  onChangePhase: (record: FinanceBranchItem, phase: BranchItemPhase) => void;
}) {
  const categories = useMemo(
    () => Array.from(new Set(rows.map((item) => item.category))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rows]
  );
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const visibleRows = selectedCategories.length === 0 ? rows : rows.filter((item) => selectedCategories.includes(item.category));
  const totalGeral = rows.reduce((sum, item) => sum + item.amount, 0);
  const totalImplementacao = rows.filter((item) => item.phase !== "pre_operacional").reduce((sum, item) => sum + item.amount, 0);
  const totalPreOperacional = rows.filter((item) => item.phase === "pre_operacional").reduce((sum, item) => sum + item.amount, 0);
  const byCategory = Object.values(rows.reduce<Record<string, BranchCategorySummary>>((acc, item) => {
    const current = acc[item.category] ?? { name: item.category, value: 0, count: 0, implementation: 0, preOperational: 0 };
    current.value += item.amount;
    current.count += 1;
    if (item.phase === "pre_operacional") {
      current.preOperational += item.amount;
    } else {
      current.implementation += item.amount;
    }
    acc[item.category] = current;
    return acc;
  }, {})).sort((left, right) => right.value - left.value);

  function toggleCategory(category: string) {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category]
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiMini label="Total Geral" value={money(totalGeral)} />
        <KpiMini label="Implementação" value={money(totalImplementacao)} />
        <KpiMini label="Pré-operacional" value={money(totalPreOperacional)} />
      </div>
      <BranchCategoryBreakdown
        data={byCategory}
        selectedCategories={selectedCategories}
        onToggleCategory={toggleCategory}
      />
      <Section>
        <SectionHeader
          title="Unidade Tatuapé"
          subtitle="Escolha a fase de cada item pelo formulário ou mova depois pelo botão de transição na tabela."
          action={<button type="button" onClick={onAdd} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar item</button>}
        />
        <div className="p-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-slate-500">
              {visibleRows.length} de {rows.length} itens exibidos
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategories([])}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-black transition",
                  selectedCategories.length === 0
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white"
                )}
              >
                Todas
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-black transition",
                    selectedCategories.includes(category)
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white"
                  )}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>
      <BranchItemsPhaseGroup
        phase="implementacao"
        rows={visibleRows.filter((item) => item.phase !== "pre_operacional")}
        onEdit={onEdit}
        onDelete={onDelete}
        onChangePhase={onChangePhase}
      />
      <BranchItemsPhaseGroup
        phase="pre_operacional"
        rows={visibleRows.filter((item) => item.phase === "pre_operacional")}
        onEdit={onEdit}
        onDelete={onDelete}
        onChangePhase={onChangePhase}
      />
    </div>
  );
}

function AgendaTab({
  rows,
  month,
  onSaveCapacity,
  onSaveSchedule,
  onCreateClass,
  onDeleteClass,
}: {
  rows: FinanceAgendaClass[];
  month: string;
  onSaveCapacity: (trainingId: string, capacity: number) => Promise<void>;
  onSaveSchedule: (trainingId: string, schedule: { startsAt: string; recurrence: "once" | "weekly"; durationMonths: number }) => Promise<void>;
  onCreateClass: (input: { label: string; trainingId: string | null; product: "online" | "up-day-plus" | "curso-oratoria" | null; startsAt: string; recurrence: "once" | "weekly"; durationMonths: number; daysPerMeeting: number; capacity: number }) => Promise<void>;
  onDeleteClass: (trainingId: string) => Promise<void>;
}) {
  const [editingTrainingId, setEditingTrainingId] = useState<string | null>(null);
  const [capacityDraft, setCapacityDraft] = useState(0);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({ startsAt: "", recurrence: "once" as "once" | "weekly", durationMonths: 1 });
  const [creatingClass, setCreatingClass] = useState(false);
  const [newClass, setNewClass] = useState({ label: "", trainingId: "", product: "online" as "online" | "up-day-plus" | "curso-oratoria", startsAt: `${month}-01`, recurrence: "weekly" as "once" | "weekly", durationMonths: 3, daysPerMeeting: 1, capacity: 20 });
  const [selectedTraining, setSelectedTraining] = useState<FinanceAgendaClass | null>(null);
  const [participants, setParticipants] = useState<FinanceAgendaParticipant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = new Map<string, FinanceAgendaClass[]>();
  for (const row of rows) {
    for (const date of row.sessionDates) {
      if (!date.startsWith(month)) continue;
      const entries = days.get(date) ?? [];
      entries.push(row);
      days.set(date, entries);
    }
  }
  const dayEntries = Array.from(days.entries()).sort(([left], [right]) => left.localeCompare(right));
  const visibleClasses = Array.from(new Map(dayEntries.flatMap(([, entries]) => entries).map((row) => [row.trainingId, row])).values());
  const fullCount = visibleClasses.filter((row) => row.isFull).length;
  const enrolledCount = visibleClasses.reduce((sum, row) => sum + row.enrolledCount, 0);
  const availableSeats = visibleClasses.reduce((sum, row) => sum + (row.seatsAvailable ?? 0), 0);

  async function saveCapacity(trainingId: string) {
    const capacity = Math.trunc(capacityDraft);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setError("Informe uma capacidade maior que zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaveCapacity(trainingId, capacity);
      setEditingTrainingId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao atualizar a capacidade.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedule(trainingId: string) {
    const durationMonths = Math.trunc(scheduleDraft.durationMonths);
    if (!scheduleDraft.startsAt || !Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 24) {
      setError("Informe a data inicial e uma duração entre 1 e 24 meses.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaveSchedule(trainingId, { ...scheduleDraft, durationMonths });
      setEditingScheduleId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao atualizar o calendário.");
    } finally {
      setSaving(false);
    }
  }

  async function openTraining(row: FinanceAgendaClass) {
    setSelectedTraining(row);
    setParticipants([]);
    setParticipantsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/agenda/participants/${encodeURIComponent(row.trainingId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Falha ao carregar pessoas da turma.");
      setParticipants(Array.isArray(data.participants) ? data.participants : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar pessoas da turma.");
    } finally {
      setParticipantsLoading(false);
    }
  }

  async function createClass() {
    if (!newClass.label.trim() || !newClass.startsAt) {
      setError("Informe o nome e a data inicial da turma.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreateClass({ ...newClass, trainingId: newClass.trainingId.trim() || null });
      setCreatingClass(false);
      setNewClass({ label: "", trainingId: "", product: "online", startsAt: `${month}-01`, recurrence: "weekly", durationMonths: 3, daysPerMeeting: 1, capacity: 20 });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Falha ao criar turma.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClass(row: FinanceAgendaClass) {
    if (!window.confirm(`Excluir a turma “${row.label}”? Esta ação remove o calendário e a capacidade dela da Agenda.`)) return;
    setSaving(true);
    setError(null);
    try {
      await onDeleteClass(row.trainingId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao excluir turma.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950">
        <CalendarDays size={17} className="shrink-0" />
        <span>Agenda conectada às turmas já existentes. Configure uma turma semanal para ela aparecer em cada aula e abra-a para ver todas as pessoas inscritas.</span>
      </div>
      <Section>
        <SectionHeader title="Turmas" subtitle="Crie a turma diretamente na Agenda; não é necessário cadastrá-la nas Configurações Financeiras." action={<button type="button" onClick={() => setCreatingClass((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />{creatingClass ? "Fechar" : "Criar turma"}</button>} />
        {creatingClass ? <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Nome da turma"><input value={newClass.label} onChange={(event) => setNewClass((current) => ({ ...current, label: event.target.value }))} className={inputClass} placeholder="Ex.: Oratória - Noite" /></Field>
          <Field label="Código da turma (opcional)"><input value={newClass.trainingId} onChange={(event) => setNewClass((current) => ({ ...current, trainingId: event.target.value }))} className={inputClass} placeholder="Use o mesmo nas inscrições" /></Field>
          <Field label="Tipo"><select value={newClass.product} onChange={(event) => setNewClass((current) => ({ ...current, product: event.target.value === "up-day-plus" ? "up-day-plus" : event.target.value === "curso-oratoria" ? "curso-oratoria" : "online" }))} className={inputClass}><option value="online">Encontro online</option><option value="up-day-plus">UP Day Plus</option><option value="curso-oratoria">Curso de Oratória</option></select></Field>
          <Field label="Primeira aula"><input type="date" value={newClass.startsAt} onChange={(event) => setNewClass((current) => ({ ...current, startsAt: event.target.value }))} className={inputClass} /></Field>
          <Field label="Frequência"><select value={newClass.recurrence} onChange={(event) => setNewClass((current) => ({ ...current, recurrence: event.target.value === "once" ? "once" : "weekly" }))} className={inputClass}><option value="weekly">Toda semana</option><option value="once">Aula única</option></select></Field>
          <Field label="Duração (meses)"><input type="number" min="1" max="24" disabled={newClass.recurrence === "once"} value={newClass.durationMonths} onChange={(event) => setNewClass((current) => ({ ...current, durationMonths: Number(event.target.value) }))} className={inputClass} /></Field>
          <Field label="Dias por encontro"><input type="number" min="1" max="7" value={newClass.daysPerMeeting} onChange={(event) => setNewClass((current) => ({ ...current, daysPerMeeting: Number(event.target.value) }))} className={inputClass} /></Field>
          <Field label="Capacidade"><input type="number" min="1" value={newClass.capacity} onChange={(event) => setNewClass((current) => ({ ...current, capacity: Number(event.target.value) }))} className={inputClass} /></Field>
          <div className="sm:col-span-2 xl:col-span-4"><p className="mb-3 text-xs text-slate-500">Para relacionar inscrições futuras à turma, use o mesmo código da turma no campo de treinamento do formulário. Sem código, a turma permanece como agenda interna.</p><button type="button" disabled={saving} onClick={() => void createClass()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-black text-white hover:bg-cyan-700 disabled:opacity-50"><Plus size={15} />{saving ? "Criando..." : "Criar turma e calendário"}</button></div>
        </div> : null}
      </Section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiMini label="Turmas no mês" value={number(visibleClasses.length)} />
        <KpiMini label="Inscritos" value={number(enrolledCount)} />
        <KpiMini label="Turmas lotadas" value={number(fullCount)} />
        <KpiMini label="Vagas disponíveis" value={number(availableSeats)} />
      </div>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p> : null}
      <Section>
        <SectionHeader title={`Agenda de turmas · ${monthLabel(month)}`} subtitle="Cursos organizados por dia, com inscrições, calendário recorrente e capacidade." />
        {dayEntries.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-400">Nenhuma turma com data cadastrada neste mês.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {dayEntries.map(([date, entries]) => (
              <div key={date} className="grid gap-3 p-5 lg:grid-cols-[150px_1fr]">
                <div>
                  <p className="text-sm font-black text-slate-950">{dateLabel(date)}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{entries.length} turma{entries.length === 1 ? "" : "s"}</p>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {entries.map((row) => (
                    <div key={row.trainingId} className={cn("rounded-lg border p-4", row.isFull ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900">{row.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.product === "up-day-plus" ? "UP Day Plus" : row.product === "curso-oratoria" ? "Curso de Oratória" : row.product === "online" ? "Encontro online" : "Turma"}{row.recurrence === "weekly" ? ` · semanal por ${row.durationMonths} ${row.durationMonths === 1 ? "mês" : "meses"}` : row.days > 1 ? ` · ${row.days} dias` : ""}</p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide", row.isFull ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                          {row.isFull ? "Lotada" : "Aberta"}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
                        <span className="rounded-md bg-slate-100 px-2 py-1">{number(row.enrolledCount)} inscrito{row.enrolledCount === 1 ? "" : "s"}</span>
                        {row.capacity !== null ? <span className="rounded-md bg-cyan-50 px-2 py-1 text-cyan-800">{number(row.seatsAvailable)} vaga{row.seatsAvailable === 1 ? "" : "s"} livre{row.seatsAvailable === 1 ? "" : "s"} de {number(row.capacity)}</span> : <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">Capacidade não definida</span>}
                      </div>
                      {editingTrainingId === row.trainingId ? (
                        <div className="mt-3 flex items-center gap-2">
                          <input type="number" min="1" value={capacityDraft || ""} onChange={(event) => setCapacityDraft(Number(event.target.value))} className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-sm" aria-label={`Capacidade de ${row.label}`} />
                          <button type="button" disabled={saving} onClick={() => void saveCapacity(row.trainingId)} className="h-9 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50">Salvar</button>
                          <button type="button" disabled={saving} onClick={() => setEditingTrainingId(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600">Cancelar</button>
                        </div>
                      ) : <button type="button" onClick={() => { setEditingTrainingId(row.trainingId); setCapacityDraft(row.capacity ?? Math.max(1, row.enrolledCount)); }} className="mt-3 text-xs font-black text-cyan-700 hover:underline">{row.capacity === null ? "Definir capacidade" : "Editar capacidade"}</button>}
                      {editingScheduleId === row.trainingId ? (
                        <div className="mt-3 grid gap-2 rounded-lg border border-cyan-100 bg-cyan-50/50 p-3 sm:grid-cols-2">
                          <label className="text-xs font-bold text-slate-600">Primeira aula<input type="date" value={scheduleDraft.startsAt} onChange={(event) => setScheduleDraft((current) => ({ ...current, startsAt: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label>
                          <label className="text-xs font-bold text-slate-600">Frequência<select value={scheduleDraft.recurrence} onChange={(event) => setScheduleDraft((current) => ({ ...current, recurrence: event.target.value === "weekly" ? "weekly" : "once" }))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="once">Aula única</option><option value="weekly">Toda semana</option></select></label>
                          {scheduleDraft.recurrence === "weekly" ? <label className="text-xs font-bold text-slate-600">Duração (meses)<input type="number" min="1" max="24" value={scheduleDraft.durationMonths} onChange={(event) => setScheduleDraft((current) => ({ ...current, durationMonths: Number(event.target.value) }))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label> : null}
                          <div className="flex items-end gap-2"><button type="button" disabled={saving} onClick={() => void saveSchedule(row.trainingId)} className="h-9 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50">Salvar calendário</button><button type="button" disabled={saving} onClick={() => setEditingScheduleId(null)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">Cancelar</button></div>
                        </div>
                      ) : <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => { setEditingScheduleId(row.trainingId); setScheduleDraft({ startsAt: row.startsAt, recurrence: row.recurrence, durationMonths: row.durationMonths }); }} className="text-xs font-black text-cyan-700 hover:underline">Configurar aulas</button><button type="button" onClick={() => void openTraining(row)} className="text-xs font-black text-slate-800 hover:text-cyan-700 hover:underline">Ver turma completa</button>{row.isManual ? <button type="button" disabled={saving} onClick={() => void deleteClass(row)} className="inline-flex items-center gap-1 text-xs font-black text-rose-700 hover:underline disabled:opacity-50"><Trash2 size={13} />Excluir turma</button> : null}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {selectedTraining ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Turma ${selectedTraining.label}`}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-lg font-black text-slate-950">{selectedTraining.label}</h2><p className="mt-1 text-sm text-slate-500">{selectedTraining.recurrence === "weekly" ? `Aulas semanais por ${selectedTraining.durationMonths} meses` : "Aula única"} · {selectedTraining.enrolledCount} inscrito{selectedTraining.enrolledCount === 1 ? "" : "s"}</p></div><button type="button" onClick={() => setSelectedTraining(null)} aria-label="Fechar" className="grid size-9 place-content-center rounded-lg hover:bg-slate-100"><X size={18} /></button></div>
            <div className="overflow-y-auto p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Calendário de aulas</p><div className="mt-2 flex flex-wrap gap-2">{selectedTraining.sessionDates.map((date) => <span key={date} className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{dateLabel(date)}</span>)}</div></div>
              <div className="mt-5 rounded-lg border border-slate-200"><div className="border-b border-slate-100 px-4 py-3"><p className="text-sm font-black text-slate-900">Pessoas da turma</p><p className="text-xs text-slate-500">Dados de todas as pessoas inscritas nesta turma.</p></div><div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100 text-sm"><thead className="bg-slate-50"><tr>{["Nome", "Telefone", "E-mail", "Cidade", "Profissão", "Perfil", "Status", "Recrutador", "Inscrição", "Presença"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 bg-white">{participantsLoading ? <tr><td colSpan={10} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">Carregando pessoas…</td></tr> : participants.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">Nenhuma pessoa encontrada nesta turma.</td></tr> : participants.map((person) => <tr key={person.id}><td className="whitespace-nowrap px-3 py-2 font-bold text-slate-900">{person.name ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.phone ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.email ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.city ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.profession ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.role ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.status ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.recruiterName ?? "-"}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{dateLabel(person.enrolledAt)}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{person.attendanceApproved ? "Aprovada" : person.attendanceValidated ? "Validada" : "Pendente"}</td></tr>)}</tbody></table></div></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MatriculasTab({
  rows,
  catalog,
  periodLabel,
  showVisaoToggle,
  matriculasVisao,
  onChangeMatriculasVisao,
  onAdd,
  onEdit,
  onDelete,
  onOpenPayments,
}: {
  rows: FinanceEnrollment[];
  catalog: FinanceCatalog;
  periodLabel: string;
  showVisaoToggle: boolean;
  matriculasVisao: "mes" | "todos";
  onChangeMatriculasVisao: (next: "mes" | "todos") => void;
  onAdd: () => void;
  onEdit: (record: FinanceEnrollment) => void;
  onDelete: (record: FinanceEnrollment) => void;
  onOpenPayments: (enrollmentId: number) => void;
}) {
  const [amount, setAmount] = useState(3000);
  const [installments, setInstallments] = useState(4);
  const [brandId, setBrandId] = useState<number | null>(null);
  const parts = splitInstallmentsClient(amount, installments);
  const rate = catalog.installmentRates.find((item) => item.installments === installments && item.brandId === brandId)?.ratePct ?? 0;
  return (
    <div className="space-y-5">
      <Section>
        <SectionHeader title="Simulador inteligente" subtitle="Parcelas, taxas de cartão, receita líquida e projeção mensal." action={<button type="button" onClick={onAdd} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Cadastrar matrícula</button>} />
        <div className="grid gap-5 p-5 lg:grid-cols-[320px_1fr]">
          <div className="grid gap-3">
            <Field label="Valor do Curso">
              <input
                defaultValue={amount}
                onChange={(event) => setAmount(parseDecimal(event.target.value))}
                type="text"
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
            <Field label="Bandeira do Cartão">
              <select
                value={brandId ?? ""}
                onChange={(event) => setBrandId(event.target.value ? Number(event.target.value) : null)}
                className={inputClass}
              >
                <option value="">Padrão (sem bandeira)</option>
                {catalog.cardBrands.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <input type="range" min={1} max={12} value={installments} onChange={(event) => setInstallments(Number(event.target.value))} />
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <span>{installments} parcelas</span>
              <span>Taxa {percent(rate)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAmount((value) => Math.max(0, value - 500))} className="h-10 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
                − R$ 500
              </button>
              <button type="button" onClick={() => setAmount((value) => value + 500)} className="h-10 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
                + R$ 500
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {parts.map((part, index) => (
              <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Parcela {index + 1}</p>
                <p className="mt-2 text-xl font-black text-slate-950">{money(part)}</p>
                <p className="mt-1 text-xs text-slate-500">Líquido {money(part - (part * rate) / 100)}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>
      {showVisaoToggle ? <VisaoToggle visao={matriculasVisao} periodLabel={periodLabel} onChange={onChangeMatriculasVisao} itemsLabel="Lista" /> : null}
      <Section>
        <SectionHeader title="Matrículas" subtitle="As parcelas mostram a previsão original; o botão de carteira registra os pagamentos reais e atualiza o saldo total." />
        <div className="p-5">
          <SmartTable
            rows={rows}
            columns={[
              { key: "student", label: "Aluno", render: (r) => r.student, value: (r) => r.student },
              { key: "course", label: "Curso", render: (r) => r.courseName ?? "-", value: (r) => r.courseName },
              { key: "amount", label: "Valor", render: (r) => money(r.totalAmount), value: (r) => r.totalAmount },
              { key: "paid", label: "Recebido", render: (r) => money(r.paidAmount), value: (r) => r.paidAmount },
              { key: "balance", label: "Saldo restante", render: (r) => money(r.balanceRemaining), value: (r) => r.balanceRemaining },
              { key: "installments", label: "Parcelas", render: (r) => `${r.installments}x`, value: (r) => r.installments },
              { key: "payment", label: "Pagamento", render: (r) => r.paymentMethodName ?? "-", value: (r) => r.paymentMethodName },
              { key: "brand", label: "Bandeira", render: (r) => r.cardBrandName ?? "-", value: (r) => r.cardBrandName },
              { key: "first", label: "Mês inicial", render: (r) => r.firstMonth, value: (r) => r.firstMonth },
              { key: "seller", label: "Vendedor", render: (r) => r.sellerName ?? "-", value: (r) => r.sellerName },
              { key: "commissionPct", label: "Comissão", render: (r) => r.sellerName ? percent(r.commissionPct) : "-", value: (r) => r.commissionPct },
              { key: "net", label: "Receita líquida", render: (r) => money(r.netTotal), value: (r) => r.netTotal },
            ]}
            actions={(record) => (
              <RowActions>
                <IconButton title="Histórico de pagamentos" onClick={() => onOpenPayments(record.id)}><WalletCards size={15} /></IconButton>
                <IconButton title="Editar matrícula" onClick={() => onEdit(record)}><Edit3 size={15} /></IconButton>
                <IconButton title="Excluir matrícula" onClick={() => onDelete(record)} danger><Trash2 size={15} /></IconButton>
              </RowActions>
            )}
          />
        </div>
      </Section>
    </div>
  );
}

function ComissoesTab({
  rows,
  panel,
  overview,
  month,
  periodLabel,
  showVisaoToggle,
  comissoesVisao,
  onChangeComissoesVisao,
  onAdd,
  onDelete,
  onStatus,
  onToggleRealCommission,
}: {
  rows: FinanceCommission[];
  panel: FinanceCommissionPanel;
  overview: CommissionsOverview;
  month: string;
  periodLabel: string;
  showVisaoToggle: boolean;
  comissoesVisao: "mes" | "todos";
  onChangeComissoesVisao: (next: "mes" | "todos") => void;
  onAdd: () => void;
  onDelete: (record: FinanceCommission) => void;
  onStatus: (id: number, status: "pago" | "pendente") => Promise<void>;
  onToggleRealCommission: (paymentId: number, status: CommissionStatus, source: "matricula" | "avulso") => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiMini label="Comissão mensal" value={money(panel.monthTotal)} />
        <KpiMini label="Comissão anual" value={money(panel.yearTotal)} />
        <KpiMini label="Total pago" value={money(panel.paidTotal)} />
        <KpiMini label="Total pendente" value={money(panel.pendingTotal)} />
        <button type="button" onClick={onAdd} className="inline-flex h-full min-h-20 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800">
          <Plus size={16} /> Nova comissão
        </button>
      </div>
      {showVisaoToggle ? <VisaoToggle visao={comissoesVisao} periodLabel={periodLabel} onChange={onChangeComissoesVisao} itemsLabel="Lista" /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiMini label="Comissões sobre valores recebidos" value={money(overview.totals.realGenerated)} />
        <KpiMini label="Dessas, já pagas ao vendedor" value={money(overview.totals.realPaid)} />
        <KpiMini label="Projetado (saldo a receber do cliente)" value={money(overview.totals.projected)} />
      </div>

      <Section>
        <SectionHeader title="Comissões Reais (Pagamentos)" subtitle="Uma linha por pagamento já recebido — de matrícula ou de receita avulsa. Os cards do topo mostram o provisionamento contábil; estes, a comissão sobre dinheiro que entrou." />
        <div className="p-5">
          <SmartTable
            rows={overview.real}
            columns={[
              { key: "date", label: "Data", render: (r) => dateLabel(r.date), value: (r) => r.date },
              { key: "seller", label: "Vendedor", render: (r) => r.sellerName, value: (r) => r.sellerName },
              { key: "revenue", label: "Receita", render: (r) => r.revenueDescription, value: (r) => r.revenueDescription },
              { key: "lead", label: "Lead", render: (r) => r.leadName ?? "-", value: (r) => r.leadName },
              { key: "sale", label: "Valor da Venda", render: (r) => money(r.saleAmount), value: (r) => r.saleAmount },
              { key: "payment", label: "Valor do Pagamento", render: (r) => money(r.paymentAmount), value: (r) => r.paymentAmount },
              { key: "percent", label: "%", render: (r) => percent(r.commissionPct), value: (r) => r.commissionPct },
              { key: "commission", label: "Comissão", render: (r) => money(r.commissionAmount), value: (r) => r.commissionAmount },
              {
                key: "status",
                label: "Status",
                render: (r) => <StatusBadge status={r.status === "paga" ? "pago" : "pendente"} label={r.status === "paga" ? "Comissão paga" : "Comissão disponível"} />,
                value: (r) => r.status,
              },
            ]}
            actions={(record) => (
              <RowActions>
                <IconButton
                  title={record.status === "paga" ? "Marcar como disponível" : "Marcar como paga"}
                  onClick={() => onToggleRealCommission(record.paymentId, record.status === "paga" ? "disponivel" : "paga", record.source)}
                >
                  <CheckCircle2 size={15} />
                </IconButton>
              </RowActions>
            )}
          />
        </div>
      </Section>

      <Section>
        <SectionHeader title="Comissões Projetadas (Aguardando Pagamento)" subtitle="Calculado a partir do saldo ainda não pago pelo cliente — nunca é liberado antecipadamente." />
        <div className="p-5">
          <SmartTable
            rows={overview.projected}
            columns={[
              { key: "seller", label: "Vendedor", render: (r) => r.sellerName, value: (r) => r.sellerName },
              { key: "revenue", label: "Receita", render: (r) => r.revenueDescription, value: (r) => r.revenueDescription },
              { key: "lead", label: "Lead", render: (r) => r.leadName ?? "-", value: (r) => r.leadName },
              { key: "sale", label: "Valor da Venda", render: (r) => money(r.saleAmount), value: (r) => r.saleAmount },
              { key: "balance", label: "Saldo em Aberto", render: (r) => money(r.balanceRemaining), value: (r) => r.balanceRemaining },
              { key: "percent", label: "%", render: (r) => percent(r.commissionPct), value: (r) => r.commissionPct },
              { key: "commission", label: "Comissão Projetada", render: (r) => money(r.projectedCommissionAmount), value: (r) => r.projectedCommissionAmount },
              {
                key: "status",
                label: "Status",
                render: () => <StatusBadge status="pendente" label="Aguardando pagamento do cliente" />,
                value: () => "aguardando_pagamento",
              },
            ]}
          />
        </div>
      </Section>

      {panel.sellers.map((seller) => {
        const sellerRows = rows.filter((row) => row.sellerId === seller.sellerId);
        return (
          <Section key={seller.sellerId}>
            <SectionHeader title={seller.sellerName} subtitle={`Mês: ${money(seller.monthTotal)} · Ano: ${money(seller.yearTotal)} · Pendente: ${money(seller.pendingTotal)}`} />
            <div className="p-5">
              <SmartTable
                rows={sellerRows}
                columns={[
                  { key: "date", label: "Data", render: (r) => r.date, value: (r) => r.date },
                  { key: "student", label: "Aluno", render: (r) => r.student, value: (r) => r.student },
                  { key: "course", label: "Curso", render: (r) => r.courseName ?? "-", value: (r) => r.courseName },
                  { key: "sale", label: "Venda", render: (r) => money(r.saleAmount), value: (r) => r.saleAmount },
                  { key: "percent", label: "%", render: (r) => percent(r.percent), value: (r) => r.percent },
                  { key: "payment", label: "Pagamento", render: (r) => r.paymentMethodName ?? "-", value: (r) => r.paymentMethodName },
                  { key: "installments", label: "Parcelas", render: (r) => `${r.installments}x`, value: (r) => r.installments },
                  { key: "commission", label: "Comissão", render: (r) => money(r.totalCommission), value: (r) => r.totalCommission },
                  { key: "month", label: month, render: (r) => money(r.installmentsDetail.filter((i) => i.month === month).reduce((sum, i) => sum + i.amount, 0)), value: (r) => r.installmentsDetail.filter((i) => i.month === month).reduce((sum, i) => sum + i.amount, 0) },
                ]}
                actions={(record) => (
                  <RowActions>
                    {record.installmentsDetail.map((installment) => installment.month === month ? (
                      <IconButton
                        key={installment.id}
                        title={installment.status === "pago" ? "Marcar pendente" : "Marcar pago"}
                        onClick={() => onStatus(installment.id, installment.status === "pago" ? "pendente" : "pago")}
                      >
                        <CheckCircle2 size={15} />
                      </IconButton>
                    ) : null)}
                    <IconButton title="Excluir comissão" onClick={() => onDelete(record)} danger><Trash2 size={15} /></IconButton>
                  </RowActions>
                )}
              />
            </div>
          </Section>
        );
      })}
    </div>
  );
}

function TrimestralTab({ summary, month, filters }: { summary: FinanceDashboardSummary; month: string; filters: FinanceFilters }) {
  return (
    <div className="space-y-5">
      <Section>
        <SectionHeader
          title="Consolidação Trimestral"
          subtitle={`Apresentação executiva para investidores. Trimestres fechados do ano de ${month.slice(0, 4)} — o trimestre corrente e os seguintes ainda incluem meses não realizados.`}
          action={<a href={`/api/finance/export?section=trimestral&format=pdf&month=${month}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Download size={16} />PDF</a>}
        />
        <div className="grid gap-5 p-5 xl:grid-cols-2">
          <ChartCard title="Receita e Lucro por Trimestre">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.quarterly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="revenue" fill="#06a8d8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="profit" fill="#12a594" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <div className="pt-0 xl:pt-16">
            <SmartTable
              rows={summary.quarterly}
              columns={[
                { key: "label", label: "Trimestre", render: (r) => r.label, value: (r) => r.label },
                { key: "revenue", label: "Receita", render: (r) => money(r.revenue), value: (r) => r.revenue },
                { key: "fixed", label: "Fixos", render: (r) => money(r.fixedExpenses), value: (r) => r.fixedExpenses },
                { key: "variable", label: "Variáveis", render: (r) => money(r.variableExpenses), value: (r) => r.variableExpenses },
                { key: "profit", label: "Lucro", render: (r) => money(r.profit), value: (r) => r.profit },
                { key: "margin", label: "Margem", render: (r) => percent(r.margin), value: (r) => r.margin },
              ]}
            />
          </div>
        </div>
      </Section>
      <ExportCenter month={month} filters={filters} />
    </div>
  );
}

/** Monta a grade completa (1x-12x) para "Padrão" + cada bandeira ativa, preenchendo com 0 onde ainda não existe taxa cadastrada. */
function buildInstallmentRateRows(catalog: FinanceCatalog): FinanceInstallmentRate[] {
  const tiers: Array<{ brandId: number | null; brandName: string | null }> = [
    { brandId: null, brandName: null },
    ...catalog.cardBrands.filter((brand) => brand.active).map((brand) => ({ brandId: brand.id, brandName: brand.name })),
  ];
  const rows: FinanceInstallmentRate[] = [];
  for (const tier of tiers) {
    for (let n = 1; n <= 12; n += 1) {
      const existing = catalog.installmentRates.find((item) => item.installments === n && item.brandId === tier.brandId);
      rows.push(existing ?? { installments: n, brandId: tier.brandId, brandName: tier.brandName, ratePct: 0 });
    }
  }
  return rows;
}

function ConfiguracoesTab({
  catalog,
  onSaved,
  apiJson,
}: {
  catalog: FinanceCatalog;
  onSaved: () => void;
  apiJson: (endpoint: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) => Promise<{ id?: number; ok?: boolean }>;
}) {
  const [rates, setRates] = useState(() => buildInstallmentRateRows(catalog));
  const [initialBalance, setInitialBalance] = useState(catalog.initialBalance);
  const [boletoFee, setBoletoFee] = useState(catalog.boletoFee);

  // Bandeira nova cadastrada: reconstrói a grade pra ela aparecer sem precisar recarregar a página.
  useEffect(() => {
    setRates(buildInstallmentRateRows(catalog));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.cardBrands.length]);

  function updateRate(brandId: number | null, installments: number, value: string) {
    setRates((current) =>
      current.map((item) =>
        item.installments === installments && item.brandId === brandId
          ? { ...item, ratePct: parseDecimal(value) }
          : item
      )
    );
  }

  const rateTiers = [
    { brandId: null as number | null, label: "Padrão (sem bandeira)" },
    ...catalog.cardBrands.filter((brand) => brand.active).map((brand) => ({ brandId: brand.id, label: brand.name })),
  ];
  const [selectedTierId, setSelectedTierId] = useState<number | null>(null);
  const selectedTier = rateTiers.find((tier) => tier.brandId === selectedTierId) ?? rateTiers[0];

  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  async function createBrand() {
    const name = newBrandName.trim();
    if (!name) return;
    setSavingBrand(true);
    setBrandError(null);
    try {
      const result = await apiJson("/api/finance/catalog/card-brands", "POST", { name });
      if (result.id) setSelectedTierId(result.id);
      setNewBrandName("");
      setAddingBrand(false);
      onSaved();
    } catch (error) {
      setBrandError(error instanceof Error ? error.message : "Falha ao criar bandeira.");
    } finally {
      setSavingBrand(false);
    }
  }

  async function submitCatalog(event: FormEvent<HTMLFormElement>, entity: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const [key, raw] of form.entries()) {
      const value = String(raw).trim();
      if (!value) continue; // campo em branco: deixa o banco usar o valor padrão da coluna
      body[key] = CATALOG_DECIMAL_FIELDS.has(key) ? parseDecimal(value) : value;
    }
    await apiJson(`/api/finance/catalog/${entity}`, "POST", body);
    event.currentTarget.reset();
    onSaved();
  }

  async function saveRates() {
    await apiJson("/api/finance/installment-rates", "PATCH", { rates });
    onSaved();
  }

  async function saveInitialBalance() {
    await apiJson("/api/finance/settings", "PATCH", { initialBalance });
    onSaved();
  }

  async function saveBoletoFee() {
    await apiJson("/api/finance/settings", "PATCH", { boletoFee });
    onSaved();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section>
        <SectionHeader title="Categorias de Receita e Despesas" />
        <div className="space-y-4 p-5">
          <form onSubmit={(event) => submitCatalog(event, "categories")} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <SelectInput label="Tipo" name="kind" defaultValue="receita">
              <option value="receita">Receita</option>
              <option value="gasto_fixo">Despesa fixa</option>
              <option value="gasto_variavel">Despesa variável</option>
            </SelectInput>
            <TextInput label="Nome" name="name" required />
            <button className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-black text-white">Adicionar</button>
          </form>
          <div className="grid gap-2 sm:grid-cols-3">
            {catalog.categories.map((item) => <span key={item.id} className="rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{item.name}</span>)}
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeader
          title="Taxas das Parcelas"
          subtitle="Uma grade de 1x a 12x por bandeira — a bandeira escolhida na matrícula define qual taxa é aplicada."
          action={<button type="button" onClick={saveRates} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white"><SlidersHorizontal size={16} />Salvar taxas</button>}
        />
        <div className="p-5">
          <div className="mb-5 flex items-end gap-2 sm:max-w-md">
            <div className="flex-1">
              <Field label="Bandeira">
                <select
                  value={selectedTier.brandId ?? ""}
                  onChange={(event) => setSelectedTierId(event.target.value ? Number(event.target.value) : null)}
                  className={inputClass}
                >
                  {rateTiers.map((tier) => (
                    <option key={tier.brandId ?? "default"} value={tier.brandId ?? ""}>{tier.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button
              type="button"
              title="Nova bandeira"
              onClick={() => setAddingBrand((value) => !value)}
              className={cn(
                "flex size-10 flex-none items-center justify-center rounded-lg border transition",
                addingBrand ? "border-cyan-300 bg-cyan-50 text-cyan-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <Plus size={16} />
            </button>
          </div>
          {addingBrand ? (
            <div className="mb-5 flex gap-2 sm:max-w-md">
              <input
                autoFocus
                value={newBrandName}
                onChange={(event) => setNewBrandName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createBrand();
                  }
                }}
                placeholder="Nome da nova bandeira"
                className={inputClass}
              />
              <button
                type="button"
                onClick={createBrand}
                disabled={savingBrand || !newBrandName.trim()}
                className="h-10 flex-none rounded-lg bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                {savingBrand ? "Criando..." : "Criar"}
              </button>
            </div>
          ) : null}
          {brandError ? <p className="mb-3 text-xs font-bold text-rose-600">{brandError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {rates
              .filter((rate) => rate.brandId === selectedTier.brandId)
              .map((rate) => (
                <Field key={`${selectedTier.brandId ?? "default"}-${rate.installments}`} label={`${rate.installments}x`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={rate.ratePct}
                    onChange={(event) => updateRate(selectedTier.brandId, rate.installments, event.target.value)}
                    className={inputClass}
                  />
                </Field>
              ))}
          </div>
        </div>
      </Section>

      <SettingsCatalogSection title="Funcionários" entity="employees" onSubmit={submitCatalog}>
        <TextInput label="Nome" name="name" required />
        <TextInput label="Cargo" name="role" />
        <DecimalInput label="Salário" name="salary" />
        <DecimalInput label="Benefícios" name="benefits" />
      </SettingsCatalogSection>

      <SettingsCatalogSection title="Vendedores" entity="sellers" onSubmit={submitCatalog}>
        <TextInput label="Nome" name="name" required />
        <DecimalInput label="Percentual padrão" name="defaultPct" defaultValue={10} />
      </SettingsCatalogSection>

      <SettingsCatalogSection title="Cursos" entity="courses" onSubmit={submitCatalog}>
        <TextInput label="Nome" name="name" required />
        <DecimalInput label="Valor padrão" name="defaultPrice" />
      </SettingsCatalogSection>

      <SettingsCatalogSection title="Unidades e Centros de Custo" entity="branches" onSubmit={submitCatalog}>
        <TextInput label="Nome" name="name" required />
        <TextInput label="Cidade" name="city" />
      </SettingsCatalogSection>

      <SettingsCatalogSection title="Formas de Pagamento" entity="payment-methods" onSubmit={submitCatalog}>
        <TextInput label="Nome" name="name" required />
        <SelectInput label="Tipo" name="kind" defaultValue="avista">
          <option value="avista">À vista</option>
          <option value="parcelado">Parcelado</option>
        </SelectInput>
      </SettingsCatalogSection>

      <Section>
        <SectionHeader title="Saldo em Caixa" action={<button type="button" onClick={saveInitialBalance} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white">Salvar</button>} />
        <div className="p-5">
          <Field label="Saldo inicial">
            <input defaultValue={initialBalance} onChange={(event) => setInitialBalance(parseDecimal(event.target.value))} type="text" inputMode="decimal" className={inputClass} />
          </Field>
        </div>
      </Section>

      <Section>
        <SectionHeader title="Taxa de Boleto" subtitle="Aplicada automaticamente a cada pagamento avulso em boleto (Receitas)." action={<button type="button" onClick={saveBoletoFee} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white">Salvar</button>} />
        <div className="p-5">
          <Field label="Taxa de emissão do boleto (R$)">
            <input defaultValue={boletoFee} onChange={(event) => setBoletoFee(parseDecimal(event.target.value))} type="text" inputMode="decimal" className={inputClass} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function SettingsCatalogSection({
  title,
  entity,
  onSubmit,
  children,
}: {
  title: string;
  entity: string;
  onSubmit: (event: FormEvent<HTMLFormElement>, entity: string) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <Section>
      <SectionHeader title={title} />
      <form onSubmit={(event) => onSubmit(event, entity)} className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
        {children}
        <button className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-black text-white">
          Adicionar
        </button>
      </form>
    </Section>
  );
}

function FinanceModal({
  modal,
  catalog,
  month,
  saving,
  onClose,
  onSubmit,
  revenueCategories,
  fixedCategories,
  variableCategories,
  courses,
  branches,
  sellers,
  paymentMethods,
  onCreateCategory,
}: {
  modal: NonNullable<ModalState>;
  catalog: FinanceCatalog;
  month: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  revenueCategories: FinanceCatalog["categories"];
  fixedCategories: FinanceCatalog["categories"];
  variableCategories: FinanceCatalog["categories"];
  courses: FinanceCatalog["courses"];
  branches: FinanceCatalog["branches"];
  sellers: FinanceCatalog["sellers"];
  paymentMethods: FinanceCatalog["paymentMethods"];
  onCreateCategory: (kind: FinanceCategoryKind, name: string) => Promise<number | undefined>;
}) {
  const titleByType: Record<NonNullable<ModalState>["type"], string> = {
    revenue: "Receita",
    fixed: "Despesa Fixa",
    variable: "Despesa Variável",
    branch: "Item da Unidade",
    enrollment: "Matrícula",
    commission: "Comissão",
  };
  const title = `${modal.mode === "edit" ? "Editar" : "Adicionar"} ${titleByType[modal.type]}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-content-center rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modal.type === "revenue" ? <RevenueForm record={modal.record} categories={revenueCategories} courses={courses} branches={branches} sellers={sellers} paymentMethods={paymentMethods} onCreateCategory={onCreateCategory} /> : null}
            {modal.type === "fixed" ? <FixedForm record={modal.record} categories={fixedCategories} month={month} onCreateCategory={onCreateCategory} /> : null}
            {modal.type === "variable" ? <VariableForm record={modal.record} categories={variableCategories} branches={branches} month={month} onCreateCategory={onCreateCategory} /> : null}
            {modal.type === "branch" ? <BranchForm record={modal.record} branches={branches} /> : null}
            {modal.type === "enrollment" ? <EnrollmentForm catalog={catalog} month={month} record={modal.record} /> : null}
            {modal.type === "commission" ? <CommissionForm catalog={catalog} /> : null}
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button disabled={saving} className="h-10 rounded-lg bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Options({
  items,
  emptyLabel = "Selecione",
}: {
  items: Array<{ id: number; name: string }>;
  emptyLabel?: string;
}) {
  return (
    <>
      <option value="">{emptyLabel}</option>
      {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </>
  );
}

function CategorySelectInput({
  label,
  name,
  kind,
  categories,
  defaultValue,
  onCreateCategory,
}: {
  label: string;
  name: string;
  kind: FinanceCategoryKind;
  categories: FinanceCatalog["categories"];
  defaultValue?: number | null;
  onCreateCategory: (kind: FinanceCategoryKind, name: string) => Promise<number | undefined>;
}) {
  const [selected, setSelected] = useState(defaultValue ? String(defaultValue) : "");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const id = await onCreateCategory(kind, trimmed);
      if (id) setSelected(String(id));
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar categoria.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <select name={name} value={selected} onChange={(event) => setSelected(event.target.value)} className={inputClass}>
          <Options items={categories} />
        </select>
        <button
          type="button"
          title="Nova categoria"
          onClick={() => setCreating((value) => !value)}
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-lg border transition hover:bg-slate-50",
            creating ? "border-cyan-300 bg-cyan-50 text-cyan-700" : "border-slate-200 bg-white text-slate-600"
          )}
        >
          <Plus size={16} />
        </button>
      </div>
      {creating ? (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Nome da nova categoria"
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
            className="h-10 flex-none rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50"
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs font-bold text-rose-600">{error}</p> : null}
    </Field>
  );
}

interface LeadSearchResult {
  id: number;
  nome: string | null;
  telefone: string | null;
  treinamento: string | null;
  criadoEm: string;
}

/** Autocomplete de lead (nome/telefone/whatsapp) reaproveitando /api/inscricoes/search — mesmo padrão do MergeLeadsModal. Vínculo opcional: sem seleção, a receita segue funcionando normalmente. */
function LeadAutocompleteField({
  defaultLeadId,
  defaultLeadName,
  defaultLeadPhone,
}: {
  defaultLeadId?: number | null;
  defaultLeadName?: string | null;
  defaultLeadPhone?: string | null;
}) {
  const [selected, setSelected] = useState<{ id: number; nome: string | null; telefone: string | null } | null>(
    defaultLeadId ? { id: defaultLeadId, nome: defaultLeadName ?? null, telefone: defaultLeadPhone ?? null } : null
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(value: string) {
    setQuery(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    timeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/inscricoes/search?q=${encodeURIComponent(value)}&limit=8`);
        if (!res.ok) return;
        const data = (await res.json()) as { results?: LeadSearchResult[] };
        setResults(data.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  return (
    <Field label="Lead (opcional)">
      <input type="hidden" name="leadInscricaoId" value={selected?.id ?? ""} />
      <input type="hidden" name="leadName" value={selected?.nome ?? ""} />
      <input type="hidden" name="leadPhone" value={selected?.telefone ?? ""} />
      {selected ? (
        <div className="flex h-10 items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-sm">
          <span className="truncate font-bold text-cyan-900">
            {selected.nome ?? "Sem nome"} <span className="font-normal text-cyan-700">{selected.telefone ?? ""}</span>
          </span>
          <button type="button" onClick={() => setSelected(null)} className="ml-2 text-cyan-700 hover:text-cyan-900" aria-label="Remover lead selecionado">
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(event) => handleSearch(event.target.value)}
            placeholder="Nome, telefone, WhatsApp…"
            className={inputClass}
          />
          {searching ? <p className="mt-1 text-xs text-slate-400">Buscando…</p> : null}
          {results.length > 0 ? (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => {
                    setSelected({ id: result.id, nome: result.nome, telefone: result.telefone });
                    setQuery("");
                    setResults([]);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                >
                  <span className="text-xs font-bold text-slate-900">{result.nome ?? "Sem nome"}</span>
                  <span className="text-[11px] text-slate-400">{result.telefone ?? "—"}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}

function RevenueForm({
  record,
  categories,
  courses,
  branches,
  sellers,
  paymentMethods,
  onCreateCategory,
}: {
  record?: FinanceRevenue;
  categories: FinanceCatalog["categories"];
  courses: FinanceCatalog["courses"];
  branches: FinanceCatalog["branches"];
  sellers: FinanceCatalog["sellers"];
  paymentMethods: FinanceCatalog["paymentMethods"];
  onCreateCategory: (kind: FinanceCategoryKind, name: string) => Promise<number | undefined>;
}) {
  // Registro novo (sem record) sempre entra no fluxo "avulso" (pagamentos
  // parciais, status automático); registros "legacy" (matrícula ou
  // lançamento manual anterior a esta feature) mantêm o formulário antigo,
  // intocado, para não alterar o comportamento de dados já existentes.
  const isLegacy = record?.revenueMode === "legacy";
  const [commissionPct, setCommissionPct] = useState<string>(String(record?.commissionPct ?? 0));

  if (isLegacy) {
    return (
      <>
        <TextInput label="Data" name="date" type="date" required defaultValue={toInputDate(record?.date) || new Date().toISOString().slice(0, 10)} />
        <TextInput label="Descrição" name="description" required defaultValue={record?.description} />
        <CategorySelectInput label="Categoria" name="categoryId" kind="receita" categories={categories} defaultValue={record?.categoryId} onCreateCategory={onCreateCategory} />
        <TextInput label="Origem" name="origin" defaultValue={record?.origin} />
        <TextInput label="Aluno" name="student" defaultValue={record?.student} />
        <SelectInput label="Curso" name="courseId" defaultValue={record?.courseId}><Options items={courses} emptyLabel="Sem curso" /></SelectInput>
        <SelectInput label="Unidade" name="branchId" defaultValue={record?.branchId}><Options items={branches} emptyLabel="Sem unidade" /></SelectInput>
        <SelectInput label="Pagamento" name="paymentMethodId" defaultValue={record?.paymentMethodId}><Options items={paymentMethods} emptyLabel="Sem forma" /></SelectInput>
        <SelectInput label="Vendedor" name="sellerId" defaultValue={record?.sellerId}><Options items={sellers} emptyLabel="Sem vendedor" /></SelectInput>
        <DecimalInput label="Valor" name="amount" required defaultValue={record?.amount} />
        <DecimalInput label="Taxa" name="feeAmount" defaultValue={record?.feeAmount ?? 0} />
        <SelectInput label="Status" name="status" defaultValue={record?.status ?? "previsto"}>
          <option value="previsto">Previsto</option>
          <option value="recebido">Recebido</option>
          <option value="atrasado">Atrasado</option>
          <option value="cancelado">Cancelado</option>
        </SelectInput>
        <InvoiceFileInput label="Anexar comprovante" accept="image/*,.pdf" currentFilename={record?.invoiceFilename} />
        <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
      </>
    );
  }

  return (
    <>
      <div className="md:col-span-2 xl:col-span-3 rounded-lg border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
        <p className="font-black">Este formulário cria uma receita avulsa.</p>
        <p className="mt-1">Para registrar uma matrícula, use o formulário de matrícula. Ele cria a venda e suas parcelas automaticamente quando a forma de pagamento permitir parcelamento.</p>
      </div>
      <TextInput label="Data da venda" name="date" type="date" required defaultValue={toInputDate(record?.date) || new Date().toISOString().slice(0, 10)} />
      <TextInput label="Nome da receita" name="description" required defaultValue={record?.description} />
      <CategorySelectInput label="Categoria" name="categoryId" kind="receita" categories={categories} defaultValue={record?.categoryId} onCreateCategory={onCreateCategory} />
      <TextInput label="Origem" name="origin" defaultValue={record?.origin} />
      <TextInput label="Vencimento" name="dueDate" type="date" defaultValue={toInputDate(record?.dueDate)} />
      <SelectInput label="Curso" name="courseId" defaultValue={record?.courseId}><Options items={courses} emptyLabel="Sem curso" /></SelectInput>
      <SelectInput label="Unidade" name="branchId" defaultValue={record?.branchId}><Options items={branches} emptyLabel="Sem unidade" /></SelectInput>
      <SelectInput
        label="Vendedor"
        name="sellerId"
        defaultValue={record?.sellerId}
        onChange={(value) => {
          const seller = sellers.find((item) => item.id === Number(value));
          if (seller) setCommissionPct(String(seller.defaultPct));
        }}
      >
        <Options items={sellers} emptyLabel="Sem vendedor" />
      </SelectInput>
      <Field label="Comissão do vendedor (%)">
        <input
          name="commissionPct"
          type="text"
          inputMode="decimal"
          value={commissionPct}
          onChange={(event) => setCommissionPct(event.target.value)}
          className={inputClass}
        />
      </Field>
      <DecimalInput label="Valor fechado da venda" name="amount" required defaultValue={record?.amount} />
      <LeadAutocompleteField defaultLeadId={record?.leadInscricaoId} defaultLeadName={record?.leadName} defaultLeadPhone={record?.leadPhone} />
      <Field label="Status">
        <div className="flex h-10 items-center gap-3">
          <StatusBadge status={record?.status ?? "previsto"} label={AVULSO_STATUS_LABELS[record?.status ?? "previsto"]} />
          {record ? (
            <label className="inline-flex items-center gap-2 text-xs font-bold text-rose-700">
              <input type="checkbox" name="cancelReceita" defaultChecked={record.status === "cancelado"} className="size-4 accent-rose-600" />
              Cancelar venda
            </label>
          ) : (
            <span className="text-xs text-slate-400">Definido automaticamente pelos pagamentos.</span>
          )}
        </div>
      </Field>
      <InvoiceFileInput label="Anexar comprovante" accept="image/*,.pdf" currentFilename={record?.invoiceFilename} />
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function FixedForm({
  record,
  categories,
  month,
  onCreateCategory,
}: {
  record?: FinanceFixedExpense;
  categories: FinanceCatalog["categories"];
  month: string;
  onCreateCategory: (kind: FinanceCategoryKind, name: string) => Promise<number | undefined>;
}) {
  return (
    <>
      <TextInput label="Mês" name="monthDisplay" type="month" defaultValue={record?.month ?? month} />
      <TextInput label="Descrição" name="description" required defaultValue={record?.description} />
      <CategorySelectInput label="Categoria" name="categoryId" kind="gasto_fixo" categories={categories} defaultValue={record?.categoryId} onCreateCategory={onCreateCategory} />
      <TextInput label="Vencimento" name="dueDate" type="date" defaultValue={toInputDate(record?.dueDate)} />
      <DecimalInput label="Salário / Valor" name="amount" required defaultValue={record?.amount} />
      <DecimalInput label="Benefícios" name="benefitsAmount" defaultValue={record?.benefitsAmount} />
      <SelectInput label="Status" name="status" defaultValue={record?.status ?? "pendente"}>
        <option value="pendente">Pendente</option>
        <option value="pago">Pago</option>
        <option value="atrasado">Atrasado</option>
      </SelectInput>
      <TextInput label="Pago em" name="paidAt" type="date" defaultValue={toInputDate(record?.paidAt)} />
      <TextInput label="Link da Nota Fiscal" name="invoiceUrl" defaultValue={record?.invoiceUrl} />
      <InvoiceFileInput currentFilename={record?.invoiceFilename} />
      <div className="md:col-span-2 xl:col-span-3">
        <LockCheckbox defaultChecked={record?.recurringLocked ?? false} />
      </div>
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function VariableForm({
  record,
  categories,
  branches,
  month,
  onCreateCategory,
}: {
  record?: FinanceVariableExpense;
  categories: FinanceCatalog["categories"];
  branches: FinanceCatalog["branches"];
  month: string;
  onCreateCategory: (kind: FinanceCategoryKind, name: string) => Promise<number | undefined>;
}) {
  return (
    <>
      <TextInput label="Data" name="date" type="date" required defaultValue={toInputDate(record?.date) || `${month}-01`} />
      <TextInput label="Descrição" name="description" required defaultValue={record?.description} />
      <CategorySelectInput label="Categoria" name="categoryId" kind="gasto_variavel" categories={categories} defaultValue={record?.categoryId} onCreateCategory={onCreateCategory} />
      <SelectInput label="Unidade" name="branchId" defaultValue={record?.branchId}><Options items={branches} emptyLabel="Sem unidade" /></SelectInput>
      <DecimalInput label="Valor" name="amount" required defaultValue={record?.amount} />
      <TextInput label="Link da Nota Fiscal" name="invoiceUrl" defaultValue={record?.invoiceUrl} />
      <InvoiceFileInput currentFilename={record?.invoiceFilename} />
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observação" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function BranchForm({ record, branches }: { record?: FinanceBranchItem; branches: FinanceCatalog["branches"] }) {
  return (
    <>
      <SelectInput label="Unidade" name="branchId" required defaultValue={record?.branchId}><Options items={branches} /></SelectInput>
      <TextInput label="Item" name="item" required defaultValue={record?.item} />
      <TextInput label="Categoria" name="category" defaultValue={record?.category ?? "Outros"} />
      <TextInput label="Fornecedor" name="supplier" defaultValue={record?.supplier} />
      <DecimalInput label="Valor" name="amount" required defaultValue={record?.amount} />
      <TextInput label="Data" name="date" type="date" defaultValue={toInputDate(record?.date)} />
      <SelectInput label="Status" name="status" defaultValue={record?.status ?? "pendente"}>
        <option value="pendente">Pendente</option>
        <option value="pago">Pago</option>
        <option value="atrasado">Atrasado</option>
      </SelectInput>
      <SelectInput label="Fase" name="phase" defaultValue={record?.phase ?? "implementacao"}>
        <option value="implementacao">Implementação</option>
        <option value="pre_operacional">Pré-operacional</option>
      </SelectInput>
      <TextInput label="Link da Nota Fiscal" name="invoiceUrl" defaultValue={record?.invoiceUrl} />
      <InvoiceFileInput currentFilename={record?.invoiceFilename} />
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function EnrollmentForm({ catalog, month, record }: { catalog: FinanceCatalog; month: string; record?: FinanceEnrollment }) {
  const [paymentMethodId, setPaymentMethodId] = useState(record?.paymentMethodId ? String(record.paymentMethodId) : "");
  const [sellerId, setSellerId] = useState(record?.sellerId ? String(record.sellerId) : "");
  const initialSeller = catalog.sellers.find((item) => String(item.id) === sellerId);
  const [commissionPct, setCommissionPct] = useState(String(record?.commissionPct ?? initialSeller?.defaultPct ?? 0));
  const selectedPaymentMethod = catalog.paymentMethods.find((item) => String(item.id) === paymentMethodId);
  const hasCardInstallmentFee = selectedPaymentMethod?.kind === "parcelado";

  return (
    <>
      <TextInput label="Aluno" name="student" required defaultValue={record?.student} />
      <SelectInput label="Curso" name="courseId" defaultValue={record?.courseId}><Options items={catalog.courses.filter((item) => item.active)} /></SelectInput>
      <DecimalInput label="Valor do Curso" name="totalAmount" required defaultValue={record?.totalAmount ?? 3000} />
      <TextInput label="Parcelas previstas" name="installments" type="number" required defaultValue={record?.installments ?? 1} />
      <SelectInput label="Forma de Pagamento" name="paymentMethodId" defaultValue={record?.paymentMethodId} onChange={setPaymentMethodId}><Options items={catalog.paymentMethods.filter((item) => item.active)} /></SelectInput>
      {hasCardInstallmentFee ? <SelectInput label="Bandeira do Cartão" name="cardBrandId" defaultValue={record?.cardBrandId}><Options items={catalog.cardBrands.filter((item) => item.active)} emptyLabel="Padrão (sem bandeira)" /></SelectInput> : <input type="hidden" name="cardBrandId" value="" />}
      <p className="md:col-span-2 xl:col-span-3 -mt-2 text-xs font-semibold text-slate-500">A previsão pode ser parcelada em qualquer forma de pagamento. Taxas por parcela são aplicadas apenas quando a forma cadastrada for cartão.</p>
      <TextInput label="Mês Inicial" name="firstMonth" type="month" required defaultValue={record?.firstMonth ?? month} />
      <TextInput label="Data" name="saleDate" type="date" required defaultValue={toInputDate(record?.saleDate) || new Date().toISOString().slice(0, 10)} />
      <SelectInput
        label="Vendedor"
        name="sellerId"
        defaultValue={record?.sellerId}
        onChange={(value) => {
          setSellerId(value);
          const seller = catalog.sellers.find((item) => String(item.id) === value);
          setCommissionPct(String(seller?.defaultPct ?? 0));
        }}
      >
        <Options items={catalog.sellers.filter((item) => item.active)} />
      </SelectInput>
      <Field label="Comissão do vendedor (%)">
        <input
          name="commissionPct"
          type="text"
          inputMode="decimal"
          value={commissionPct}
          onChange={(event) => setCommissionPct(event.target.value)}
          disabled={!sellerId}
          className={inputClass}
        />
      </Field>
      <SelectInput label="Unidade" name="branchId" defaultValue={record?.branchId}><Options items={catalog.branches.filter((item) => item.active)} /></SelectInput>
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function CommissionForm({ catalog }: { catalog: FinanceCatalog }) {
  return (
    <>
      <TextInput label="Data" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
      <SelectInput label="Vendedor" name="sellerId" required><Options items={catalog.sellers.filter((item) => item.active)} /></SelectInput>
      <TextInput label="Aluno" name="student" required />
      <SelectInput label="Curso" name="courseId"><Options items={catalog.courses.filter((item) => item.active)} emptyLabel="Sem curso" /></SelectInput>
      <DecimalInput label="Valor da Venda" name="saleAmount" required />
      <DecimalInput label="Percentual" name="percent" required defaultValue={10} />
      <SelectInput label="Forma de Pagamento" name="paymentMethodId"><Options items={catalog.paymentMethods.filter((item) => item.active)} /></SelectInput>
      <TextInput label="Quantidade de Parcelas" name="installments" type="number" defaultValue={1} />
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" /></div>
    </>
  );
}
