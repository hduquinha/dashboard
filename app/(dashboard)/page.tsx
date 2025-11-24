import { getDashboardStats } from "@/lib/db";
import DashboardMetrics from "@/components/DashboardMetrics";
import DashboardCharts from "@/components/DashboardCharts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <main className="space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
          <p className="text-sm text-neutral-500">Visão geral da operação e métricas de performance.</p>
        </div>
      </header>

      {/* Metrics Cards */}
      <DashboardMetrics 
        totalLeads={stats.totalLeads}
        newLeadsToday={stats.newLeadsToday}
        conversionRate={stats.conversionRate}
        graduados={stats.graduados}
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
