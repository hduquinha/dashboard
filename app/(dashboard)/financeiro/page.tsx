import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FinanceiroClient from "./FinanceiroClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  currentMonth,
  getCommissionPanel,
  getFinanceCatalog,
  getFinanceDashboardSummary,
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

  const [catalog, summary, revenues, fixedExpenses, variableExpenses, enrollments, commissions, branchItems, commissionPanel] =
    await Promise.all([
      getFinanceCatalog(),
      getFinanceDashboardSummary(month, filters),
      listRevenues(filters),
      listFixedExpenses(month),
      listVariableExpenses(filters),
      listEnrollments({
        ...filters,
      }),
      listCommissions({
        ...filters,
      }),
      listBranchItems(filters.branchId),
      getCommissionPanel(month),
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
    />
  );
}
