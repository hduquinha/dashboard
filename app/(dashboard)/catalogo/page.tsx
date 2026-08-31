import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listTrainingCatalog } from "@/lib/trainingCatalog";
import { getSalesOriginReport } from "@/lib/salesReport";
import { CatalogClient } from "./CatalogClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cursos • Dashboard",
  description: "Tabela de precos dos treinamentos e quanto cada um faturou.",
};

/** Últimos 90 dias — janela padrão do relatório ao abrir a tela. */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 89 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString().slice(0, 10), to };
}

export default async function CatalogoPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "view.catalog")) {
    redirect("/");
  }

  const range = defaultRange();
  const [trainings, report] = await Promise.all([
    listTrainingCatalog(),
    getSalesOriginReport(range.from, range.to),
  ]);

  return (
    <CatalogClient
      initialTrainings={trainings}
      initialReport={report}
      canManage={hasPermission(session.user, "catalog.manage")}
    />
  );
}
