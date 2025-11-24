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
  BarChart,
  Bar,
  Legend
} from "recharts";

const COLORS = ["#06b6d4", "#0f172a", "#94a3b8"]; // Cyan-500, Slate-900, Slate-400

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
              <Line type="monotone" dataKey="recruits" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Recrutadores" />
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

      {/* Top Performers Bar Chart */}
      <div className="col-span-1 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm lg:col-span-2 xl:col-span-3">
        <h3 className="mb-4 text-lg font-bold text-neutral-900">Top Recrutadores</h3>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topRecruiters}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={100} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="recruits" fill="#06b6d4" radius={[0, 4, 4, 0]} barSize={20} name="Cadastros" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
