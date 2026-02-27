"use client";

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

const COLORS = ["#2DBDC2", "#0f172a", "#94a3b8"]; // UP Cyan, Slate-900, Slate-400

interface DashboardChartsProps {
  growthData: { name: string; leads: number; recruits: number }[];
  distributionData: { name: string; value: number }[];
  topRecruiters: { name: string; recruits: number }[];
}

export default function DashboardCharts({ growthData, distributionData, topRecruiters }: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {/* Growth Chart */}
      <div className="col-span-1 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm xl:col-span-2">
        <h3 className="mb-4 text-lg font-bold text-neutral-900">Crescimento da Rede</h3>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={growthData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                itemStyle={{ color: '#0f172a' }}
              />
              <Legend />
              <Line type="monotone" dataKey="leads" stroke="#0f172a" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Leads" />
              <Line type="monotone" dataKey="recruits" stroke="#2DBDC2" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Clusters" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Distribution Chart */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-neutral-900">Distribuição</h3>
        <div className="h-[300px] w-full">
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
        </div>
      </div>

      {/* Top Performers */}
      <div className="col-span-1 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm lg:col-span-2 xl:col-span-3">
        <h3 className="mb-4 text-lg font-bold text-neutral-900">Top Clusters</h3>
        {topRecruiters.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-400">Nenhum recrutador encontrado.</p>
        ) : (
          <div className="space-y-3">
            {(() => {
              const max = Math.max(...topRecruiters.map((r) => r.recruits), 1);
              return topRecruiters.map((r, i) => {
                const name = humanizeName(r.name);
                const pct = Math.round((r.recruits / max) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-5 flex-shrink-0 text-right text-xs font-bold text-neutral-400">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-neutral-800" title={name}>
                          {name}
                        </span>
                        <span className="flex-shrink-0 text-xs font-bold text-neutral-500">
                          {r.recruits}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full rounded-full bg-[#2DBDC2] transition-all"
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
