import { Users, TrendingUp, Award, Target } from "lucide-react";

const metrics = [
  {
    label: "Total na Rede",
    value: "12,345",
    change: "+12%",
    icon: Users,
    color: "text-cyan-500",
    bg: "bg-cyan-50",
  },
  {
    label: "Novos Leads (Hoje)",
    value: "142",
    change: "+5%",
    icon: Target,
    color: "text-emerald-500",
    bg: "bg-emerald-50",
  },
  {
    label: "Taxa de Conversão",
    value: "24.8%",
    change: "+2.1%",
    icon: TrendingUp,
    color: "text-blue-500",
    bg: "bg-blue-50",
  },
  {
    label: "Graduados",
    value: "89",
    change: "+4",
    icon: Award,
    color: "text-purple-500",
    bg: "bg-purple-50",
  },
];

export default function DashboardMetrics() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:shadow-md"
        >
          <div>
            <p className="text-sm font-medium text-neutral-500">{metric.label}</p>
            <p className="mt-1 text-2xl font-bold text-neutral-900">{metric.value}</p>
            <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {metric.change}
            </span>
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${metric.bg}`}>
            <metric.icon className={`h-6 w-6 ${metric.color}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
