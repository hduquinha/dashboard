"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { humanizeName } from "@/lib/utils";

const COLORS = ["#2781F6", "#12A594", "#E54666"];

interface DashboardChartsProps {
  growthData: { name: string; leads: number; recruits: number }[];
  distributionData: { name: string; value: number }[];
  topRecruiters: { name: string; recruits: number }[];
}

export default function DashboardCharts({ growthData, distributionData, topRecruiters }: DashboardChartsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {/* Growth Chart */}
      <div className="col-span-1 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)] xl:col-span-2">
        <h3 className="mb-4 text-base font-semibold text-[rgb(var(--slate-12))]">Crescimento da Rede</h3>
        <div className="h-[300px] w-full">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={growthData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f3" />
                <XAxis dataKey="name" stroke="#60646c" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#60646c" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #eaeaea' }}
                  itemStyle={{ color: '#1c2024' }}
                />
                <Legend />
                <Line type="monotone" dataKey="leads" stroke="#2781F6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Leads" />
                <Line type="monotone" dataKey="recruits" stroke="#12A594" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Clusters" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full rounded-md bg-[rgb(var(--slate-3))]" />
          )}
        </div>
      </div>

      {/* Distribution Chart */}
      <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
        <h3 className="mb-4 text-base font-semibold text-[rgb(var(--slate-12))]">Distribuição</h3>
        <div className="h-[300px] w-full">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full rounded-md bg-[rgb(var(--slate-3))]" />
          )}
        </div>
      </div>

      {/* Top Performers */}
      <div className="col-span-1 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)] lg:col-span-2 xl:col-span-3">
        <h3 className="mb-4 text-base font-semibold text-[rgb(var(--slate-12))]">Top Clusters</h3>
        {topRecruiters.length === 0 ? (
          <p className="py-8 text-center text-sm text-[rgb(var(--slate-10))]">Nenhum recrutador encontrado.</p>
        ) : (
          <div className="space-y-3">
            {(() => {
              const max = Math.max(...topRecruiters.map((r) => r.recruits), 1);
              return topRecruiters.map((r, i) => {
                const name = humanizeName(r.name);
                const pct = Math.round((r.recruits / max) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-5 flex-shrink-0 text-right text-xs font-semibold text-[rgb(var(--slate-10))]">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[rgb(var(--slate-12))]" title={name}>
                          {name}
                        </span>
                        <span className="flex-shrink-0 text-xs font-semibold text-[rgb(var(--slate-11))]">
                          {r.recruits}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[rgb(var(--slate-3))]">
                        <div
                          className="h-full rounded-full bg-[rgb(var(--blue-9))] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
