import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FinanceiroClient from "./FinanceiroClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  currentMonth,
  getFinanceDataRange,
  getCommissionPanel,
  getCommissionsOverview,
  getFinanceCatalog,
  getFinanceDashboardSummary,
  listFinanceAgenda,
  listAllFixedExpenses,
  listAllMonthlyTotals,
  listBranchItems,
  listCommissions,
  listEnrollments,
  listFixedExpenses,
  listPendingInvoiceEnrollments,
  listFixedExpensesRange,
  listOverdueReceivables,
  listReceivables,
  listRevenues,
  listVariableExpenses,
} from "@/lib/finance";
import type { FinanceFilters } from "@/types/finance";
import { parseBusinessUnitFilter } from "@/lib/financeBusinessUnits";

export const metadata: Metadata = {
  title: "Gestao Financeira VozUP",
  description: "Modulo financeiro da VozUP.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function FinanceiroPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.finance")) {
    redirect("/");
  }

  const resolved = await Promise.resolve(searchParams);
  const requestedPeriod = pick(resolved.periodo);
  const requestedMonth = pick(resolved.month);
  // Um mês explícito sempre prevalece sobre um `periodo=all` residual na URL.
  // Isso evita que uma navegação anterior em "Tudo" faça a aba Despesas somar
  // o histórico inteiro quando a pessoa já selecionou, por exemplo, julho.
  const periodMode: "month" | "custom" | "all" =
    requestedPeriod === "custom" ? "custom" : requestedPeriod === "all" && !requestedMonth ? "all" : "month";
  // "Tudo" vira um intervalo concreto (primeiro movimento → mês corrente): o
  // resto do módulo trabalha com from/to, então não há caminho especial.
  const dataRange = periodMode === "all" ? await getFinanceDataRange() : null;
  const month = dataRange ? dataRange.to : requestedMonth || currentMonth();
  const from = dataRange ? dataRange.from : periodMode === "custom" ? pick(resolved.from) || month : month;
  const to = dataRange ? dataRange.to : periodMode === "custom" ? pick(resolved.to) || from : month;
  // Chave Voz UP × Instituto UP: sem valor, soma as duas.
  const businessUnit = parseBusinessUnitFilter(pick(resolved.unidade));
  const filters: FinanceFilters = {
    from,
    to,
    businessUnit,
    branchId: parseOptionalNumber(pick(resolved.branchId)),
    courseId: parseOptionalNumber(pick(resolved.courseId)),
    categoryId: parseOptionalNumber(pick(resolved.categoryId)),
    sellerId: parseOptionalNumber(pick(resolved.sellerId)),
    paymentMethodId: parseOptionalNumber(pick(resolved.paymentMethodId)),
  };
  // Em "Mês", as listas de despesa ficam presas ao mês base para não misturar
  // gastos de meses anteriores. Em "Período", elas seguem o intervalo escolhido
  // — do contrário o filtro de período mostrava receitas do intervalo e despesas
  // de um mês só (quase sempre vazias, porque o mês base não fazia parte dele).
  const expenseFilters: FinanceFilters =
    periodMode === "month" ? { ...filters, from: month, to: month } : { ...filters };
  // O período das despesas é sempre o selecionado no filtro do topo. Não há
  // uma visão independente de "todos os meses", pois ela podia sobrepor o
  // recorte escolhido e exibir o total histórico em vez do mês solicitado.
  const receitasVisao = pick(resolved.receitasVisao) === "todos" ? "todos" : "mes";
  const fluxoVisao = pick(resolved.fluxoVisao) === "todos" ? "todos" : "mes";
  const matriculasVisao = pick(resolved.matriculasVisao) === "todos" ? "todos" : "mes";
  const comissoesVisao = pick(resolved.comissoesVisao) === "todos" ? "todos" : "mes";

  const [
    catalog,
    summary,
    revenues,
    fixedExpenses,
    variableExpenses,
    enrollments,
    commissions,
    branchItems,
    commissionPanel,
    allMonthlyTotals,
    commissionsOverview,
    agenda,
    pendingInvoices,
    receivables,
    overdueReceivables,
  ] = await Promise.all([
    getFinanceCatalog(),
    getFinanceDashboardSummary(month, filters),
    receitasVisao === "todos"
      ? listRevenues({
          branchId: filters.branchId,
          courseId: filters.courseId,
          categoryId: filters.categoryId,
          sellerId: filters.sellerId,
          paymentMethodId: filters.paymentMethodId,
        })
      : listRevenues(filters),
    periodMode === "all"
      ? listAllFixedExpenses(businessUnit)
      : periodMode === "custom"
        ? listFixedExpensesRange(from, to, businessUnit)
        : listFixedExpenses(month, businessUnit),
    listVariableExpenses(expenseFilters),
    matriculasVisao === "todos"
      ? listEnrollments({ courseId: filters.courseId, sellerId: filters.sellerId })
      : listEnrollments({ ...filters }),
    comissoesVisao === "todos" ? listCommissions({ sellerId: filters.sellerId }) : listCommissions({ ...filters }),
    listBranchItems(filters.branchId),
    getCommissionPanel(month),
    fluxoVisao === "todos" ? listAllMonthlyTotals() : Promise.resolve(null),
    comissoesVisao === "todos"
      ? getCommissionsOverview({ sellerId: filters.sellerId })
      : getCommissionsOverview({ ...filters }),
    listFinanceAgenda(),
    // Fora do recorte de período de propósito: nota pendente de março continua
    // pendente com o filtro em agosto (ver listPendingInvoiceEnrollments).
    listPendingInvoiceEnrollments(),
    // A aba Cobrança recorta pelo VENCIMENTO, não pela competência: a pergunta
    // dela é "o que tenho para receber e cobrar neste mês".
    listReceivables({ from, to, sellerId: filters.sellerId, courseId: filters.courseId, branchId: filters.branchId }),
    // Vencidas de qualquer mês, pelo mesmo motivo da fila de NF.
    listOverdueReceivables(),
  ]);

  return (
    <FinanceiroClient
      catalog={catalog}
      summary={summary}
      revenues={revenues}
      fixedExpenses={fixedExpenses}
      fixedExpensesLocked={to < "2026-06"}
      variableExpenses={variableExpenses}
      enrollments={enrollments}
      agenda={agenda}
      commissions={commissions}
      branchItems={branchItems}
      commissionPanel={commissionPanel}
      filters={filters}
      month={month}
      periodMode={periodMode}
      receitasVisao={receitasVisao}
      fluxoVisao={fluxoVisao}
      matriculasVisao={matriculasVisao}
      comissoesVisao={comissoesVisao}
      allMonthlyTotals={allMonthlyTotals}
      commissionsOverview={commissionsOverview}
      pendingInvoices={pendingInvoices}
      receivables={receivables}
      overdueReceivables={overdueReceivables}
      canManageInvoices={hasPermission(session?.user, "finance.invoices")}
      canDeleteAuditEvents={hasPermission(session?.user, "admin.audit")}
      initialTab={pick(resolved.aba)}
    />
  );
}
