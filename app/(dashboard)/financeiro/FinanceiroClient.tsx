"use client";

import { FormEvent, ReactNode, useMemo, useState, useSyncExternalStore } from "react";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
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
  Plus,
  ReceiptText,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ExpenseStatus,
  FinanceBranchItem,
  FinanceCatalog,
  FinanceCommission,
  FinanceCommissionPanel,
  FinanceDashboardSummary,
  FinanceEnrollment,
  FinanceFilters,
  FinanceFixedExpense,
  FinanceKpi,
  FinanceMonthTotals,
  FinanceRevenue,
  FinanceVariableExpense,
  RevenueStatus,
} from "@/types/finance";

type TabKey =
  | "dashboard"
  | "fluxo"
  | "receitas"
  | "gastos"
  | "filiais"
  | "matriculas"
  | "comissoes"
  | "trimestral"
  | "configuracoes";

type ModalState =
  | { type: "revenue"; mode: "create" | "edit"; record?: FinanceRevenue }
  | { type: "fixed"; mode: "create" | "edit"; record?: FinanceFixedExpense }
  | { type: "variable"; mode: "create" | "edit"; record?: FinanceVariableExpense }
  | { type: "branch"; mode: "create" | "edit"; record?: FinanceBranchItem }
  | { type: "enrollment"; mode: "create" }
  | { type: "commission"; mode: "create" }
  | null;

interface FinanceiroClientProps {
  catalog: FinanceCatalog;
  summary: FinanceDashboardSummary;
  revenues: FinanceRevenue[];
  fixedExpenses: FinanceFixedExpense[];
  variableExpenses: FinanceVariableExpense[];
  enrollments: FinanceEnrollment[];
  commissions: FinanceCommission[];
  branchItems: FinanceBranchItem[];
  commissionPanel: FinanceCommissionPanel;
  filters: FinanceFilters;
  month: string;
  periodMode: "month" | "custom";
}

interface Column<T> {
  key: string;
  label: string;
  render: (item: T) => ReactNode;
  value: (item: T) => string | number | null | undefined;
  className?: string;
}

const tabs: Array<{ key: TabKey; label: string; icon: typeof LineChartIcon }> = [
  { key: "dashboard", label: "Dashboard Financeiro", icon: LineChartIcon },
  { key: "fluxo", label: "Fluxo de Caixa", icon: WalletCards },
  { key: "receitas", label: "Receitas", icon: BadgeDollarSign },
  { key: "gastos", label: "Despesas", icon: ReceiptText },
  { key: "filiais", label: "Unidade Tatuapé", icon: Building2 },
  { key: "matriculas", label: "Matrículas Parceladas", icon: CalendarDays },
  { key: "comissoes", label: "Comissões", icon: Banknote },
  { key: "trimestral", label: "Consolidação Trimestral", icon: FileDown },
  { key: "configuracoes", label: "Configurações Financeiras", icon: Settings2 },
];

const COLORS = ["#06a8d8", "#12a594", "#f59e0b", "#e54666", "#6366f1", "#14b8a6", "#8b5cf6", "#0f766e"];

const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100";
const labelClass = "text-[11px] font-black uppercase tracking-[0.14em] text-slate-500";

function splitInstallmentsClient(total: number, count: number): number[] {
  const n = Math.max(1, Math.trunc(count));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, index) => (base + (index === n - 1 ? remainder : 0)) / 100);
}

function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);
}

function number(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR").format(value ?? 0);
}

function percent(value: number | null | undefined): string {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value ?? 0)}%`;
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

function toInputDate(value: string | null | undefined): string {
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

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseDecimal(value: string): number {
  const normalized = value.trim().replace(/\s/g, "");
  const decimalSeparator = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
  const withoutThousands =
    decimalSeparator === ","
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  const parsed = Number(withoutThousands);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formNumber(form: FormData, key: string): number {
  const value = formString(form, key);
  return parseDecimal(value);
}

function formOptionalNumber(form: FormData, key: string): number | null {
  const value = formString(form, key);
  if (!value) return null;
  return parseDecimal(value);
}

function formOptionalDate(form: FormData, key: string): string | null {
  return formString(form, key) || null;
}

function StatusBadge({ status }: { status: RevenueStatus | ExpenseStatus | "pago" | "pendente" }) {
  const tone =
    status === "recebido" || status === "pago"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : status === "atrasado" || status === "cancelado"
        ? "bg-rose-50 text-rose-700 ring-rose-100"
        : "bg-amber-50 text-amber-700 ring-amber-100";
  return (
    <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-bold ring-1", tone)}>
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function InvoiceLinks({
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

function InvoiceFileInput({ currentFilename }: { currentFilename?: string | null }) {
  const [selectedName, setSelectedName] = useState("");
  return (
    <div className="grid gap-1.5">
      <span className={labelClass}>Anexar nota</span>
      <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-300 bg-cyan-50 px-3 text-sm font-black text-cyan-800 transition hover:bg-cyan-100">
        <FileUp size={16} />
        Anexar nota
        <input
          type="file"
          name="invoiceFile"
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

function TextInput({
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

function DecimalInput({
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

function SelectInput({
  label,
  name,
  defaultValue,
  children,
  required = false,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <select name={name} required={required} defaultValue={valueOrEmpty(defaultValue)} className={inputClass}>
        {children}
      </select>
    </Field>
  );
}

function TextAreaInput({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | null }) {
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

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border border-slate-200 bg-white shadow-[var(--dashboard-card-shadow)]", className)}>{children}</section>;
}

function SectionHeader({
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
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <Section>
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-black text-slate-950">{title}</h3>
      </div>
      <div className="h-72 px-3 py-4">{hydrated ? children : <EmptyChart />}</div>
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

function SmartTable<T>({
  rows,
  columns,
  searchPlaceholder = "Pesquisar",
  actions,
}: {
  rows: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  actions?: (item: T) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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

function IconButton({
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
    ["matriculas", "Matrículas Parceladas"],
    ["comissoes", "Comissões"],
    ["trimestral", "Consolidação Trimestral"],
  ] as const;

  function href(section: string, format: "xlsx" | "csv" | "pdf") {
    const params = new URLSearchParams({ section, format, month });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    return `/api/finance/export?${params.toString()}`;
  }

  return (
    <Section>
      <SectionHeader
        title="Central de exportação"
        subtitle="Arquivos prontos para contabilidade, sócios, auditoria e backup."
        action={
          <a
            href={href("complete", "xlsx")}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"
          >
            <FileSpreadsheet size={16} />
            Exportar base completa
          </a>
        }
      />
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
        {sectionOptions.map(([section, label]) => (
          <div key={section} className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm font-black text-slate-950">{label}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-50 px-3 text-xs font-bold text-emerald-700" href={href(section, "xlsx")}>
                <Download size={13} /> Excel
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-100 px-3 text-xs font-bold text-slate-700" href={href(section, "csv")}>
                <Download size={13} /> CSV
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-md bg-rose-50 px-3 text-xs font-bold text-rose-700" href={href(section, "pdf")}>
                <Download size={13} /> PDF
              </a>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function FinanceiroClient({
  catalog,
  summary,
  revenues,
  fixedExpenses,
  variableExpenses,
  enrollments,
  commissions,
  branchItems,
  commissionPanel,
  filters,
  month,
  periodMode,
}: FinanceiroClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [modal, setModal] = useState<ModalState>(null);
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
    const params = new URLSearchParams({ month: localFilters.month });
    if (localFilters.periodMode === "custom") {
      params.set("periodo", "custom");
      params.set("from", localFilters.from || localFilters.month);
      params.set("to", localFilters.to || localFilters.from || localFilters.month);
    }
    for (const key of ["branchId", "courseId", "categoryId", "sellerId", "paymentMethodId"] as const) {
      const value = localFilters[key];
      if (value) params.set(key, value);
    }
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
        const body = {
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
        };
        await apiJson(modal.mode === "edit" ? `/api/finance/revenues/${modal.record?.id}` : "/api/finance/revenues", modal.mode === "edit" ? "PATCH" : "POST", body);
      }

      if (modal.type === "fixed") {
        const body = {
          month,
          description: formString(form, "description"),
          categoryId: formOptionalNumber(form, "categoryId"),
          dueDate: formOptionalDate(form, "dueDate"),
          amount: formNumber(form, "amount"),
          benefitsAmount: formOptionalNumber(form, "benefitsAmount"),
          status: formString(form, "status") as ExpenseStatus,
          paidAt: formOptionalDate(form, "paidAt"),
          notes: formString(form, "notes") || null,
          invoiceUrl: formString(form, "invoiceUrl") || null,
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
          costKind: formString(form, "costKind"),
          invoiceUrl: formString(form, "invoiceUrl") || null,
          notes: formString(form, "notes") || null,
        };
        const result = await apiJson(modal.mode === "edit" ? `/api/finance/branch-items/${modal.record?.id}` : "/api/finance/branch-items", modal.mode === "edit" ? "PATCH" : "POST", body);
        const targetId = modal.mode === "edit" ? modal.record?.id : result.id;
        if (targetId) await uploadInvoiceFile(`/api/finance/branch-items/${targetId}/invoice`, form);
      }

      if (modal.type === "enrollment") {
        await apiJson("/api/finance/enrollments", "POST", {
          student: formString(form, "student"),
          courseId: formOptionalNumber(form, "courseId"),
          totalAmount: formNumber(form, "totalAmount"),
          installments: formNumber(form, "installments"),
          paymentMethodId: formOptionalNumber(form, "paymentMethodId"),
          firstMonth: formString(form, "firstMonth"),
          saleDate: formString(form, "saleDate"),
          sellerId: formOptionalNumber(form, "sellerId"),
          branchId: formOptionalNumber(form, "branchId"),
          notes: formString(form, "notes") || null,
        });
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
              Dashboard, fluxo de caixa, receitas, despesas, implantação, matrículas parceladas, comissões e consolidação para investidores.
            </p>
          </div>
          <div className="grid w-full gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <Field label="Tipo de período">
              <div className="grid h-10 grid-cols-2 rounded-lg border border-slate-200 bg-white p-1">
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
                  onClick={() => setLocalFilters((current) => ({ ...current, periodMode: "custom" }))}
                  className={cn(
                    "rounded-md text-xs font-black transition",
                    localFilters.periodMode === "custom" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  Período
                </button>
              </div>
            </Field>
            <Field label={localFilters.periodMode === "custom" ? "Mês base" : "Mês"}>
              <input
                type="month"
                value={localFilters.month}
                onChange={(event) => setLocalFilters((current) => ({
                  ...current,
                  month: event.target.value,
                  from: current.periodMode === "month" ? event.target.value : current.from,
                  to: current.periodMode === "month" ? event.target.value : current.to,
                }))}
                className={inputClass}
              />
            </Field>
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

        {activeTab === "dashboard" ? (
          <DashboardTab summary={summary} chartMonthly={chartMonthly} month={month} filters={filters} />
        ) : null}

        {activeTab === "fluxo" ? (
          <FluxoTab monthly={summary.monthly} cashBalance={summary.cashBalance} />
        ) : null}

        {activeTab === "receitas" ? (
          <ReceitasTab
            rows={revenues}
            onAdd={() => setModal({ type: "revenue", mode: "create" })}
            onEdit={(record) => setModal({ type: "revenue", mode: "edit", record })}
            onDelete={(record) => destroy(`/api/finance/revenues/${record.id}`, "receita")}
          />
        ) : null}

        {activeTab === "gastos" ? (
          <GastosTab
            fixed={fixedExpenses}
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
          />
        ) : null}

        {activeTab === "matriculas" ? (
          <MatriculasTab
            rows={enrollments}
            catalog={catalog}
            onAdd={() => setModal({ type: "enrollment", mode: "create" })}
            onDelete={(record) => destroy(`/api/finance/enrollments/${record.id}`, "matrícula")}
          />
        ) : null}

        {activeTab === "comissoes" ? (
          <ComissoesTab
            rows={commissions}
            panel={commissionPanel}
            month={month}
            onAdd={() => setModal({ type: "commission", mode: "create" })}
            onDelete={(record) => destroy(`/api/finance/commissions/${record.id}`, "comissão")}
            onStatus={async (id, status) => {
              await apiJson(`/api/finance/commission-installments/${id}`, "PATCH", { status });
              refresh("Parcela atualizada.");
            }}
          />
        ) : null}

        {activeTab === "trimestral" ? (
          <TrimestralTab summary={summary} month={month} filters={filters} />
        ) : null}

        {activeTab === "configuracoes" ? (
          <ConfiguracoesTab catalog={catalog} onSaved={() => refresh("Configuração salva.")} apiJson={apiJson} />
        ) : null}
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
  chartMonthly: Array<{ mes: string; receitas: number; despesas: number; lucro: number; fixos: number; variaveis: number; saldo: number }>;
  month: string;
  filters: FinanceFilters;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {summary.kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Fluxo de Caixa Mensal">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartMonthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} />
              <Tooltip formatter={(value) => money(Number(value))} />
              <Line type="monotone" dataKey="receitas" stroke="#06a8d8" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="despesas" stroke="#e54666" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="lucro" stroke="#12a594" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Receitas x Despesas">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartMonthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} />
              <Tooltip formatter={(value) => money(Number(value))} />
              <Bar dataKey="receitas" fill="#06a8d8" radius={[6, 6, 0, 0]} />
              <Bar dataKey="despesas" fill="#e54666" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lucro Mensal">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartMonthly}>
              <defs>
                <linearGradient id="profitGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#12a594" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#12a594" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} />
              <Tooltip formatter={(value) => money(Number(value))} />
              <Area type="monotone" dataKey="lucro" stroke="#12a594" strokeWidth={3} fill="url(#profitGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Distribuição de Despesas">
          {summary.expenseDistribution.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(value) => money(Number(value))} />
                <Pie data={summary.expenseDistribution.map((item) => ({ name: item.name, value: item.value }))} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                  {summary.expenseDistribution.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
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

function SimpleBarChart({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 18, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" tickFormatter={(value) => `${Number(value) / 1000}k`} />
        <YAxis type="category" dataKey="name" width={116} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => money(Number(value))} />
        <Bar dataKey="value" fill="#06a8d8" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function FluxoTab({ monthly, cashBalance }: { monthly: FinanceMonthTotals[]; cashBalance: number }) {
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

function KpiMini({ label, value }: { label: string; value: string }) {
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
  onAdd,
  onEdit,
  onDelete,
}: {
  rows: FinanceRevenue[];
  onAdd: () => void;
  onEdit: (record: FinanceRevenue) => void;
  onDelete: (record: FinanceRevenue) => void;
}) {
  const total = rows.reduce((sum, item) => sum + item.amount, 0);
  return (
    <Section>
      <SectionHeader
        title="Receitas"
        subtitle={`Total de receitas: ${money(total)}`}
        action={<button type="button" onClick={onAdd} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar</button>}
      />
      <div className="p-5">
        <SmartTable
          rows={rows}
          columns={[
            { key: "date", label: "Data", render: (r) => r.date, value: (r) => r.date },
            { key: "description", label: "Descrição", render: (r) => r.description, value: (r) => r.description },
            { key: "category", label: "Categoria", render: (r) => r.categoryName ?? "Sem categoria", value: (r) => r.categoryName },
            { key: "origin", label: "Origem", render: (r) => r.origin ?? "-", value: (r) => r.origin },
            { key: "student", label: "Aluno", render: (r) => r.student ?? "-", value: (r) => r.student },
            { key: "payment", label: "Pagamento", render: (r) => r.paymentMethodName ?? "-", value: (r) => r.paymentMethodName },
            { key: "amount", label: "Valor", render: (r) => money(r.amount), value: (r) => r.amount },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
          ]}
          actions={(record) => (
            <RowActions>
              <IconButton title="Editar receita" onClick={() => onEdit(record)}><Edit3 size={15} /></IconButton>
              <IconButton title="Excluir receita" onClick={() => onDelete(record)} danger><Trash2 size={15} /></IconButton>
            </RowActions>
          )}
        />
      </div>
    </Section>
  );
}

function GastosTab({
  fixed,
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
        <SectionHeader title="Despesas Fixas" subtitle="Folha separada em salário, benefícios e total. Comissões vêm do módulo de comissões." action={<button type="button" onClick={onAddFixed} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar fixa</button>} />
        <div className="p-5">
          <SmartTable
            rows={fixed}
            columns={[
              { key: "description", label: "Descrição", render: (r) => r.description, value: (r) => r.description },
              { key: "category", label: "Categoria", render: (r) => r.categoryName ?? "-", value: (r) => r.categoryName },
              { key: "due", label: "Vencimento", render: (r) => r.dueDate ?? "-", value: (r) => r.dueDate },
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
          />
        </div>
      </Section>

      <Section>
        <SectionHeader title="Despesas Variáveis" subtitle="Categorias personalizadas e controle por unidade." action={<button type="button" onClick={onAddVariable} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar variável</button>} />
        <div className="p-5">
          <SmartTable
            rows={variable}
            columns={[
              { key: "date", label: "Data", render: (r) => r.date, value: (r) => r.date },
              { key: "description", label: "Descrição", render: (r) => r.description, value: (r) => r.description },
              { key: "category", label: "Categoria", render: (r) => r.categoryName ?? "-", value: (r) => r.categoryName },
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

function FiliaisTab({
  rows,
  onAdd,
  onEdit,
  onDelete,
}: {
  rows: FinanceBranchItem[];
  onAdd: () => void;
  onEdit: (record: FinanceBranchItem) => void;
  onDelete: (record: FinanceBranchItem) => void;
}) {
  const [costFilter, setCostFilter] = useState<"todos" | "fixo" | "variavel">("todos");
  const visibleRows = costFilter === "todos" ? rows : rows.filter((item) => item.costKind === costFilter);
  const totalFixo = rows.filter((item) => item.costKind === "fixo").reduce((sum, item) => sum + item.amount, 0);
  const totalVariavel = rows.filter((item) => item.costKind === "variavel").reduce((sum, item) => sum + item.amount, 0);
  const byCategory = Object.values(rows.reduce<Record<string, { name: string; value: number }>>((acc, item) => {
    const current = acc[item.category] ?? { name: item.category, value: 0 };
    current.value += item.amount;
    acc[item.category] = current;
    return acc;
  }, {}));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiMini label="Total Fixo" value={money(totalFixo)} />
        <KpiMini label="Total Variável" value={money(totalVariavel)} />
        <KpiMini label="Total Geral" value={money(totalFixo + totalVariavel)} />
      </div>
      <ChartCard title="Unidade Tatuapé por Categoria">
        <SimpleBarChart data={byCategory} />
      </ChartCard>
      <Section>
        <SectionHeader title="Unidade Tatuapé" action={<button type="button" onClick={onAdd} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Adicionar item</button>} />
        <div className="p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold text-slate-500">
              {visibleRows.length} de {rows.length} itens exibidos
            </p>
            <div className="grid h-10 grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-[360px]">
              {[
                ["todos", "Todos"],
                ["fixo", "Fixos"],
                ["variavel", "Variáveis"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCostFilter(value as "todos" | "fixo" | "variavel")}
                  className={cn(
                    "rounded-md text-xs font-black transition",
                    costFilter === value ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <SmartTable
            rows={visibleRows}
            columns={[
              { key: "branch", label: "Unidade", render: (r) => r.branchName, value: (r) => r.branchName },
              { key: "item", label: "Item", render: (r) => r.item, value: (r) => r.item },
              { key: "category", label: "Categoria", render: (r) => r.category, value: (r) => r.category },
              { key: "supplier", label: "Fornecedor", render: (r) => r.supplier ?? "-", value: (r) => r.supplier },
              { key: "costKind", label: "Tipo", render: (r) => r.costKind === "fixo" ? "Fixo" : "Variável", value: (r) => r.costKind },
              { key: "amount", label: "Valor", render: (r) => money(r.amount), value: (r) => r.amount },
              { key: "date", label: "Data", render: (r) => r.date ?? "-", value: (r) => r.date },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
              { key: "invoice", label: "Nota", render: (r) => <InvoiceLinks fileHref={r.hasInvoiceFile ? `/api/finance/branch-items/${r.id}/invoice` : null} invoiceUrl={r.invoiceUrl} filename={r.invoiceFilename} />, value: (r) => r.invoiceFilename ?? r.invoiceUrl },
            ]}
            actions={(record) => (
              <RowActions>
                <IconButton title="Editar item" onClick={() => onEdit(record)}><Edit3 size={15} /></IconButton>
                <IconButton title="Excluir item" onClick={() => onDelete(record)} danger><Trash2 size={15} /></IconButton>
              </RowActions>
            )}
          />
        </div>
      </Section>
    </div>
  );
}

function MatriculasTab({
  rows,
  catalog,
  onAdd,
  onDelete,
}: {
  rows: FinanceEnrollment[];
  catalog: FinanceCatalog;
  onAdd: () => void;
  onDelete: (record: FinanceEnrollment) => void;
}) {
  const [amount, setAmount] = useState(3000);
  const [installments, setInstallments] = useState(4);
  const parts = splitInstallmentsClient(amount, installments);
  const rate = catalog.installmentRates.find((item) => item.installments === installments)?.ratePct ?? 0;
  return (
    <div className="space-y-5">
      <Section>
        <SectionHeader title="Simulador inteligente" subtitle="Parcelas, taxas de cartão, receita líquida e projeção mensal." action={<button type="button" onClick={onAdd} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"><Plus size={16} />Cadastrar matrícula</button>} />
        <div className="grid gap-5 p-5 lg:grid-cols-[320px_1fr]">
          <div className="grid gap-3">
            <DecimalInput label="Valor do Curso" name="simAmount" defaultValue={amount} />
            <input type="range" min={1} max={12} value={installments} onChange={(event) => setInstallments(Number(event.target.value))} />
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <span>{installments} parcelas</span>
              <span>Taxa {percent(rate)}</span>
            </div>
            <button type="button" onClick={() => setAmount(amount + 500)} className="h-10 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
              Simular + R$ 500
            </button>
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
      <Section>
        <SectionHeader title="Matrículas Parceladas" />
        <div className="p-5">
          <SmartTable
            rows={rows}
            columns={[
              { key: "student", label: "Aluno", render: (r) => r.student, value: (r) => r.student },
              { key: "course", label: "Curso", render: (r) => r.courseName ?? "-", value: (r) => r.courseName },
              { key: "amount", label: "Valor", render: (r) => money(r.totalAmount), value: (r) => r.totalAmount },
              { key: "installments", label: "Parcelas", render: (r) => `${r.installments}x`, value: (r) => r.installments },
              { key: "payment", label: "Pagamento", render: (r) => r.paymentMethodName ?? "-", value: (r) => r.paymentMethodName },
              { key: "first", label: "Mês inicial", render: (r) => r.firstMonth, value: (r) => r.firstMonth },
              { key: "seller", label: "Vendedor", render: (r) => r.sellerName ?? "-", value: (r) => r.sellerName },
              { key: "net", label: "Receita líquida", render: (r) => money(r.netTotal), value: (r) => r.netTotal },
            ]}
            actions={(record) => <IconButton title="Excluir matrícula" onClick={() => onDelete(record)} danger><Trash2 size={15} /></IconButton>}
          />
        </div>
      </Section>
    </div>
  );
}

function ComissoesTab({
  rows,
  panel,
  month,
  onAdd,
  onDelete,
  onStatus,
}: {
  rows: FinanceCommission[];
  panel: FinanceCommissionPanel;
  month: string;
  onAdd: () => void;
  onDelete: (record: FinanceCommission) => void;
  onStatus: (id: number, status: "pago" | "pendente") => Promise<void>;
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
          subtitle="Apresentação executiva para investidores."
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

function ConfiguracoesTab({
  catalog,
  onSaved,
  apiJson,
}: {
  catalog: FinanceCatalog;
  onSaved: () => void;
  apiJson: (endpoint: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) => Promise<{ id?: number; ok?: boolean }>;
}) {
  const [rates, setRates] = useState(() => catalog.installmentRates.filter((item) => item.installments <= 12));
  const [initialBalance, setInitialBalance] = useState(catalog.initialBalance);

  async function submitCatalog(event: FormEvent<HTMLFormElement>, entity: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
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
        <SectionHeader title="Taxas das Parcelas" action={<button type="button" onClick={saveRates} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white"><SlidersHorizontal size={16} />Salvar taxas</button>} />
        <div className="grid gap-3 p-5 sm:grid-cols-3 xl:grid-cols-4">
          {rates.map((rate, index) => (
            <Field key={rate.installments} label={`${rate.installments}x`}>
              <input
                type="text"
                inputMode="decimal"
                value={rate.ratePct}
                onChange={(event) => setRates((current) => current.map((item, idx) => idx === index ? { ...item, ratePct: parseDecimal(event.target.value) } : item))}
                className={inputClass}
              />
            </Field>
          ))}
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
            <input value={initialBalance} onChange={(event) => setInitialBalance(parseDecimal(event.target.value))} type="text" inputMode="decimal" className={inputClass} />
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
}) {
  const titleByType: Record<NonNullable<ModalState>["type"], string> = {
    revenue: "Receita",
    fixed: "Despesa Fixa",
    variable: "Despesa Variável",
    branch: "Item da Unidade",
    enrollment: "Matrícula Parcelada",
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
            {modal.type === "revenue" ? <RevenueForm record={modal.record} categories={revenueCategories} courses={courses} branches={branches} sellers={sellers} paymentMethods={paymentMethods} /> : null}
            {modal.type === "fixed" ? <FixedForm record={modal.record} categories={fixedCategories} month={month} /> : null}
            {modal.type === "variable" ? <VariableForm record={modal.record} categories={variableCategories} branches={branches} /> : null}
            {modal.type === "branch" ? <BranchForm record={modal.record} branches={branches} /> : null}
            {modal.type === "enrollment" ? <EnrollmentForm catalog={catalog} month={month} /> : null}
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

function Options({
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

function RevenueForm({
  record,
  categories,
  courses,
  branches,
  sellers,
  paymentMethods,
}: {
  record?: FinanceRevenue;
  categories: FinanceCatalog["categories"];
  courses: FinanceCatalog["courses"];
  branches: FinanceCatalog["branches"];
  sellers: FinanceCatalog["sellers"];
  paymentMethods: FinanceCatalog["paymentMethods"];
}) {
  return (
    <>
      <TextInput label="Data" name="date" type="date" required defaultValue={toInputDate(record?.date) || new Date().toISOString().slice(0, 10)} />
      <TextInput label="Descrição" name="description" required defaultValue={record?.description} />
      <SelectInput label="Categoria" name="categoryId" defaultValue={record?.categoryId}><Options items={categories} /></SelectInput>
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
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function FixedForm({ record, categories, month }: { record?: FinanceFixedExpense; categories: FinanceCatalog["categories"]; month: string }) {
  return (
    <>
      <TextInput label="Mês" name="monthDisplay" type="month" defaultValue={record?.month ?? month} />
      <TextInput label="Descrição" name="description" required defaultValue={record?.description} />
      <SelectInput label="Categoria" name="categoryId" defaultValue={record?.categoryId}><Options items={categories} /></SelectInput>
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
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function VariableForm({ record, categories, branches }: { record?: FinanceVariableExpense; categories: FinanceCatalog["categories"]; branches: FinanceCatalog["branches"] }) {
  return (
    <>
      <TextInput label="Data" name="date" type="date" required defaultValue={toInputDate(record?.date) || new Date().toISOString().slice(0, 10)} />
      <TextInput label="Descrição" name="description" required defaultValue={record?.description} />
      <SelectInput label="Categoria" name="categoryId" defaultValue={record?.categoryId}><Options items={categories} /></SelectInput>
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
      <SelectInput label="Tipo de custo" name="costKind" defaultValue={record?.costKind ?? "fixo"}>
        <option value="fixo">Fixo</option>
        <option value="variavel">Variável</option>
      </SelectInput>
      <TextInput label="Link da Nota Fiscal" name="invoiceUrl" defaultValue={record?.invoiceUrl} />
      <InvoiceFileInput currentFilename={record?.invoiceFilename} />
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" defaultValue={record?.notes} /></div>
    </>
  );
}

function EnrollmentForm({ catalog, month }: { catalog: FinanceCatalog; month: string }) {
  return (
    <>
      <TextInput label="Aluno" name="student" required />
      <SelectInput label="Curso" name="courseId"><Options items={catalog.courses.filter((item) => item.active)} /></SelectInput>
      <DecimalInput label="Valor do Curso" name="totalAmount" required defaultValue={3000} />
      <TextInput label="Quantidade de Parcelas" name="installments" type="number" required defaultValue={4} />
      <SelectInput label="Forma de Pagamento" name="paymentMethodId"><Options items={catalog.paymentMethods.filter((item) => item.active)} /></SelectInput>
      <TextInput label="Mês Inicial" name="firstMonth" type="month" required defaultValue={month} />
      <TextInput label="Data" name="saleDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
      <SelectInput label="Vendedor" name="sellerId"><Options items={catalog.sellers.filter((item) => item.active)} /></SelectInput>
      <SelectInput label="Unidade" name="branchId"><Options items={catalog.branches.filter((item) => item.active)} /></SelectInput>
      <div className="md:col-span-2 xl:col-span-3"><TextAreaInput label="Observações" name="notes" /></div>
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
