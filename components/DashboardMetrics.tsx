import { Users, TrendingUp, GraduationCap, UserPlus } from "lucide-react";
import IconTile, { type IconTileTone } from "@/components/IconTile";
import type { LucideIcon } from "lucide-react";

interface DashboardMetricsProps {
  totalLeads: number;
  newLeadsToday: number;
  conversionRate: number;
  graduados: number;
}

interface Metric {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  tone: IconTileTone;
}

export default function DashboardMetrics({ totalLeads, newLeadsToday, conversionRate, graduados }: DashboardMetricsProps) {
  // Um ícone por indicador — nada de dois cartões com o mesmo desenho, que é o
  // que fazia a linha de KPIs parecer repetida à primeira vista.
  const metrics: Metric[] = [
    {
      label: "Total na Rede",
      value: totalLeads.toLocaleString(),
      change: "base atual",
      icon: Users,
      tone: "brand",
    },
    {
      label: "Novos Leads (Hoje)",
      value: newLeadsToday.toLocaleString(),
      change: "desde 00h",
      icon: UserPlus,
      tone: "teal",
    },
    {
      label: "Taxa de Conversão",
      value: `${conversionRate}%`,
      change: "presença aprovada",
      icon: TrendingUp,
      tone: "amber",
    },
    {
      label: "Graduados",
      value: graduados.toLocaleString(),
      change: "validados",
      icon: GraduationCap,
      tone: "slate",
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
          <IconTile icon={metric.icon} tone={metric.tone} size="lg" solid />
        </div>
      ))}
    </div>
  );
}
