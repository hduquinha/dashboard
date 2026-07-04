import {
  getCommercialDashboardStats,
  getDashboardStats,
  getDuplicateSummaryCount,
  getTrainingSnapshot,
  listTrainingFilterOptions,
} from "@/lib/db";
import DashboardMetrics from "@/components/DashboardMetrics";
import DashboardCharts from "@/components/DashboardCharts";
import TrainingSwitcher from "@/components/TrainingSwitcher";
import DuplicateNotification from "@/components/DuplicateNotification";
import CommercialCommandCenter from "@/components/CommercialCommandCenter";
import Link from "next/link";
import { CalendarDays, Target } from "lucide-react";
import type { DuplicateReason } from "@/types/inscricao";
import { ttlCache } from "@/lib/serverCache";

// Force redeploy v2
export const dynamic = "force-dynamic";

const cachedDashboardStats = () =>
  ttlCache("dashboard:home:stats", 15_000, () => getDashboardStats());

const cachedTrainingOptions = () =>
  ttlCache("dashboard:training-options", 60_000, () => listTrainingFilterOptions());

const cachedDuplicateSummary = () =>
  ttlCache("dashboard:home:duplicate-summary", 60_000, () =>
    getDuplicateSummaryCount({ windowDays: 30 })
  );

const cachedCommercialDashboardStats = (treinamentoId: string) =>
  ttlCache(`dashboard:commercial:${treinamentoId || "todos"}`, 15_000, () =>
    getCommercialDashboardStats({ treinamentoId: treinamentoId || undefined })
  );

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
  
  const [stats, trainingOptions, trainingSnapshot, commercialStats] = await Promise.all([
    cachedDashboardStats(),
    cachedTrainingOptions(),
    treinamentoSelecionado
      ? ttlCache(`dashboard:training-snapshot:${treinamentoSelecionado}`, 15_000, () =>
          getTrainingSnapshot({ treinamentoId: treinamentoSelecionado })
        )
      : Promise.resolve(null),
    cachedCommercialDashboardStats(treinamentoSelecionado),
  ]);

  let duplicateSummary = { totalGroups: 0, topReasons: [] as Array<{ reason: DuplicateReason; count: number }> };
  try {
    duplicateSummary = await cachedDuplicateSummary();
  } catch (error) {
    console.error("Erro ao buscar duplicados:", error);
  }

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
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[rgb(var(--slate-12))]">Central CRM</h1>
          <p className="text-sm text-[rgb(var(--slate-11))]">
            {treinamentoSelecionado && selectedTrainingLabel
              ? `Visualizando: ${selectedTrainingLabel}`
              : "Resumo comercial da operação."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
          <div className="w-full sm:w-64">
            <TrainingSwitcher 
              options={optionsWithAll} 
              selectedId={treinamentoSelecionado || ""} 
            />
          </div>
          <Link
            href="/crm"
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-[rgb(var(--slate-12))] px-4 text-sm font-medium text-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.08)] transition hover:bg-[rgb(var(--slate-11))]"
          >
            <Target className="h-4 w-4" />
            Abrir Pipeline
          </Link>
          <Link
            href="/treinamentos"
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[rgb(var(--border-strong))] bg-[rgb(var(--surface-1))] px-4 text-sm font-medium text-[rgb(var(--slate-11))] shadow-[0_1px_2px_rgba(28,32,36,0.04)] transition hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
          >
            <CalendarDays className="h-4 w-4" />
            Ver Instituto UP
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

      <CommercialCommandCenter stats={commercialStats} />

      {/* Charts Section */}
      <DashboardCharts 
        growthData={stats.growthData}
        distributionData={stats.distributionData}
        topRecruiters={stats.topRecruiters}
      />

    </main>
  );
}
