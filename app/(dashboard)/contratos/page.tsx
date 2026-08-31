import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getContractCompany, listContracts } from "@/lib/contracts";
import { missingCompanyFields } from "@/lib/contractRules";
import { ContratosClient } from "./ContratosClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contratos • Dashboard",
  description: "Contratos preenchidos para assinatura eletrônica ou física.",
};

export default async function ContratosPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "view.contracts")) {
    redirect("/");
  }

  const [contracts, company] = await Promise.all([listContracts({ status: "todos" }), getContractCompany()]);

  return (
    <ContratosClient
      initialContracts={contracts}
      initialCompany={company}
      missingCompany={missingCompanyFields(company)}
      canManage={hasPermission(session.user, "contracts.manage")}
    />
  );
}
