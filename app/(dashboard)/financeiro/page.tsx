import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FinanceiroClient from "./FinanceiroClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  currentMonth,
  getAllTimeExpenseTotals,
  getCommissionPanel,
  getCommissionsOverview,
  getFinanceCatalog,
  getFinanceDashboardSummary,
  listAllFixedExpenses,
  listAllMonthlyTotals,
  listBranchItems,
  listCommissions,
  listEnrollments,
  listFixedExpenses,
  listRevenues,
  listVariableExpenses,
} from "@/lib/finance";
import type { FinanceFilters } from "@/types/finance";

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
  const month = pick(resolved.month) || currentMonth();
  const periodMode = pick(resolved.periodo) === "custom" ? "custom" : "month";
  const from = periodMode === "custom" ? pick(resolved.from) || month : month;
  const to = periodMode === "custom" ? pick(resolved.to) || from : month;
  const filters: FinanceFilters = {
    from,
    to,
    branchId: parseOptionalNumber(pick(resolved.branchId)),
    courseId: parseOptionalNumber(pick(resolved.courseId)),
    categoryId: parseOptionalNumber(pick(resolved.categoryId)),
    sellerId: parseOptionalNumber(pick(resolved.sellerId)),
    paymentMethodId: parseOptionalNumber(pick(resolved.paymentMethodId)),
  };
  const expenseMonthFilters: FinanceFilters = { ...filters, from: month, to: month };
  // Addon "ver todos os meses": disponível em Despesas, Receitas, Fluxo de
  // Caixa, Matrículas e Comissões. Cada aba tem seu próprio toggle
  // independente — por padrão cada aba mostra o mês/período selecionado acima;
  // em Despesas, as listas mensais ficam presas ao mês base para não misturar
  // gastos variáveis de meses anteriores. Com <aba>Visao=todos essa aba
  // específica passa a mostrar os itens de todos os meses.
  const gastosVisao = pick(resolved.gastosVisao) === "todos" ? "todos" : "mes";
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
    allTimeTotals,
    allMonthlyTotals,
    commissionsOverview,
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
    gastosVisao === "todos" ? listAllFixedExpenses() : listFixedExpenses(month),
    gastosVisao === "todos"
      ? listVariableExpenses({ categoryId: filters.categoryId })
      : listVariableExpenses(expenseMonthFilters),
    matriculasVisao === "todos"
      ? listEnrollments({ courseId: filters.courseId, sellerId: filters.sellerId })
      : listEnrollments({ ...filters }),
    comissoesVisao === "todos" ? listCommissions({ sellerId: filters.sellerId }) : listCommissions({ ...filters }),
    listBranchItems(filters.branchId),
    getCommissionPanel(month),
    gastosVisao === "todos" ? getAllTimeExpenseTotals() : Promise.resolve(null),
    fluxoVisao === "todos" ? listAllMonthlyTotals() : Promise.resolve(null),
    comissoesVisao === "todos"
      ? getCommissionsOverview({ sellerId: filters.sellerId })
      : getCommissionsOverview({ ...filters }),
  ]);

  return (
    <FinanceiroClient
      catalog={catalog}
      summary={summary}
      revenues={revenues}
      fixedExpenses={fixedExpenses}
      variableExpenses={variableExpenses}
      enrollments={enrollments}
      commissions={commissions}
      branchItems={branchItems}
      commissionPanel={commissionPanel}
      filters={filters}
      month={month}
      periodMode={periodMode}
      gastosVisao={gastosVisao}
      receitasVisao={receitasVisao}
      fluxoVisao={fluxoVisao}
      matriculasVisao={matriculasVisao}
      comissoesVisao={comissoesVisao}
      allTimeTotals={allTimeTotals}
      allMonthlyTotals={allMonthlyTotals}
      commissionsOverview={commissionsOverview}
    />
  );
}
