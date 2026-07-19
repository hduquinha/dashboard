import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FunnelAdminClient from "./FunnelAdminClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listCommercialSellers } from "@/lib/commercial";
import { listFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Funis • Dashboard",
  description: "Funis de vendas, etapas do Kanban e atribuicao aos vendedores.",
};

export default async function FunisPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "crm.manage_funnels")) {
    redirect("/");
  }

  const [funnels, sellers] = await Promise.all([listFunnels(), listCommercialSellers()]);

  return <FunnelAdminClient initialFunnels={funnels} sellers={sellers} />;
}
