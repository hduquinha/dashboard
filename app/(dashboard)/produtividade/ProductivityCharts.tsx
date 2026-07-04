"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProductivityChartsData } from "@/types/productivity";

const COLORS = ["#2781F6", "#12A594", "#E54666", "#F59E0B", "#8B5CF6", "#06B6D4", "#84CC16", "#64748B"];

interface ProductivityChartsProps {
  charts: ProductivityChartsData;
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-[rgb(var(--border-weak))] text-sm text-[rgb(var(--slate-10))]">
      {label}
    </div>
  );
}

export default function ProductivityCharts({ charts }: ProductivityChartsProps) {
  const channelChartData = charts.channels.map<Record<string, string | number>>((entry) => ({
    channel: entry.channel,
    label: entry.label,
    value: entry.value,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
      <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Evolucao diaria</h2>
          <span className="text-xs text-[rgb(var(--slate-10))]">{charts.trend.length} dias</span>
        </div>
        {charts.trend.length === 0 ? (
          <EmptyChart label="Sem dados no periodo." />
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.trend} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f3" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="#60646c" fontSize={12} />
                <YAxis tickLine={false} axisLine={false} stroke="#60646c" fontSize={12} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Legend />
                <Line type="monotone" dataKey="tentativas" name="Tentativas" stroke="#2781F6" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="agendamentos" name="Agendamentos" stroke="#12A594" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="producao" name="Producao" stroke="#E54666" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="bolos" name="Bolos" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Canais</h2>
          <span className="text-xs text-[rgb(var(--slate-10))]">Producao</span>
        </div>
        {channelChartData.length === 0 ? (
          <EmptyChart label="Sem producao por canal." />
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={channelChartData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="44%"
                  innerRadius={62}
                  outerRadius={90}
                  paddingAngle={3}
                >
                  {channelChartData.map((entry, index) => (
                    <Cell key={String(entry.channel)} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Legend verticalAlign="bottom" height={54} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)] xl:col-span-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Consultores</h2>
          <span className="text-xs text-[rgb(var(--slate-10))]">Ranking do periodo</span>
        </div>
        {charts.consultants.length === 0 ? (
          <EmptyChart label="Sem consultores com registros." />
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.consultants.slice(0, 12)} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f3" strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} stroke="#60646c" fontSize={12} interval={0} angle={-15} textAnchor="end" height={68} />
                <YAxis tickLine={false} axisLine={false} stroke="#60646c" fontSize={12} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Legend />
                <Bar dataKey="tentativas" name="Tentativas" fill="#2781F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="agendamentos" name="Agendamentos" fill="#12A594" radius={[4, 4, 0, 0]} />
                <Bar dataKey="producao" name="Producao" fill="#E54666" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
