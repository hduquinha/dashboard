import { getDashboardStats, listTrainingFilterOptions, getTrainingSnapshot, getDuplicateSummaryCount } from "@/lib/db";
import DashboardMetrics from "@/components/DashboardMetrics";
import DashboardCharts from "@/components/DashboardCharts";
import TrainingSwitcher from "@/components/TrainingSwitcher";
import DuplicateNotification from "@/components/DuplicateNotification";
import Link from "next/link";
import { CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pickStringParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function DashboardPage(props: DashboardPageProps) {
  const searchParams = await props.searchParams;
  const treinamentoSelecionado = pickStringParam(searchParams?.treinamento) ?? "";
  
  // Busca duplicados separadamente com tratamento de erro
  let duplicateSummary = { totalGroups: 0, topReasons: [] as Array<{ reason: "telefone" | "email" | "nome-dia" | "payload"; count: number }> };
  try {
    duplicateSummary = await getDuplicateSummaryCount({ windowDays: 30 });
  } catch (error) {
    console.error("Erro ao buscar duplicados:", error);
  }

  const [stats, trainingOptions, trainingSnapshot] = await Promise.all([
    getDashboardStats(),
    listTrainingFilterOptions(),
    treinamentoSelecionado 
      ? getTrainingSnapshot({ treinamentoId: treinamentoSelecionado })
      : null,
  ]);

  // Add "Todos" option at the beginning
  const optionsWithAll = [
    { id: "", label: "Todos os Treinamentos", startsAt: null },
    ...trainingOptions
  ];

  // Use filtered data if a training is selected
  const displayMetrics = treinamentoSelecionado && trainingSnapshot
    ? {
        totalLeads: trainingSnapshot.total,
        newLeadsToday: trainingSnapshot.last24h,
        conversionRate: trainingSnapshot.total > 0 
          ? Math.round((trainingSnapshot.recruiters / trainingSnapshot.total) * 100 * 10) / 10 
          : 0,
        graduados: trainingSnapshot.recruiters,
      }
    : {
        totalLeads: stats.totalLeads,
        newLeadsToday: stats.newLeadsToday,
        conversionRate: stats.conversionRate,
        graduados: stats.graduados,
      };

  const selectedTrainingLabel = trainingOptions.find(t => t.id === treinamentoSelecionado)?.label;

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
          <p className="text-sm text-neutral-500">
            {treinamentoSelecionado && selectedTrainingLabel
              ? `Visualizando: ${selectedTrainingLabel}`
              : "Visão geral da operação e métricas de performance."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-64">
            <TrainingSwitcher 
              options={optionsWithAll} 
              selectedId={treinamentoSelecionado || ""} 
            />
          </div>
          <Link
            href="/treinamentos"
            className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
          >
            <CalendarDays className="h-4 w-4" />
            Ver Treinamentos
          </Link>
        </div>
      </header>

      {/* Duplicate Alert Notification */}
      {duplicateSummary.totalGroups > 0 && (
        <DuplicateNotification
          totalGroups={duplicateSummary.totalGroups}
          topReasons={duplicateSummary.topReasons}
        />
      )}

      {/* Metrics Cards */}
      <DashboardMetrics 
        totalLeads={displayMetrics.totalLeads}
        newLeadsToday={displayMetrics.newLeadsToday}
        conversionRate={displayMetrics.conversionRate}
        graduados={displayMetrics.graduados}
      />

      {/* Charts Section */}
      <DashboardCharts 
        growthData={stats.growthData}
        distributionData={stats.distributionData}
        topRecruiters={stats.topRecruiters}
      />
    </main>
  );
}
