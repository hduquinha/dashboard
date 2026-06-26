import { Users, TrendingUp, Award, Target } from "lucide-react";

interface DashboardMetricsProps {
  totalLeads: number;
  newLeadsToday: number;
  conversionRate: number;
  graduados: number;
}

export default function DashboardMetrics({ totalLeads, newLeadsToday, conversionRate, graduados }: DashboardMetricsProps) {
  const metrics = [
    {
      label: "Total na Rede",
      value: totalLeads.toLocaleString(),
      change: "base atual",
      icon: Users,
      color: "text-[rgb(var(--blue-11))]",
      bg: "bg-[rgb(var(--blue-3))]",
    },
    {
      label: "Novos Leads (Hoje)",
      value: newLeadsToday.toLocaleString(),
      change: "desde 00h",
      icon: Target,
      color: "text-[rgb(var(--teal-9))]",
      bg: "bg-[rgb(224_248_243)]",
    },
    {
      label: "Taxa de Conversão",
      value: `${conversionRate}%`,
      change: "presença aprovada",
      icon: TrendingUp,
      color: "text-[rgb(var(--blue-11))]",
      bg: "bg-[rgb(var(--blue-3))]",
    },
    {
      label: "Graduados",
      value: graduados.toLocaleString(),
      change: "validados",
      icon: Award,
      color: "text-[rgb(var(--slate-12))]",
      bg: "bg-[rgb(var(--slate-3))]",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex items-center justify-between rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)] transition hover:border-[rgb(var(--border-strong))]"
        >
          <div>
            <p className="text-sm font-medium text-[rgb(var(--slate-11))]">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold text-[rgb(var(--slate-12))]">{metric.value}</p>
            <span className="mt-2 inline-block rounded-md bg-[rgb(224_248_243)] px-2 py-0.5 text-xs font-medium text-[rgb(var(--teal-9))]">
              {metric.change}
            </span>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${metric.bg}`}>
            <metric.icon className={`h-6 w-6 ${metric.color}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
