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

const dataGrowth = [
  { name: "Jan", leads: 400, recruits: 240 },
  { name: "Fev", leads: 300, recruits: 139 },
  { name: "Mar", leads: 200, recruits: 980 },
  { name: "Abr", leads: 278, recruits: 390 },
  { name: "Mai", leads: 189, recruits: 480 },
  { name: "Jun", leads: 239, recruits: 380 },
  { name: "Jul", leads: 349, recruits: 430 },
];

const dataDistribution = [
  { name: "Recrutadores", value: 400 },
  { name: "Leads", value: 3000 },
  { name: "Clientes", value: 300 },
];

const COLORS = ["#06b6d4", "#0f172a", "#94a3b8"]; // Cyan-500, Slate-900, Slate-400

const dataPerformance = [
  { name: "Rodrigo", recruits: 45 },
  { name: "Ana", recruits: 32 },
  { name: "Carlos", recruits: 28 },
  { name: "Beatriz", recruits: 25 },
  { name: "João", recruits: 20 },
];

export default function DashboardCharts() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {/* Growth Chart */}
      <div className="col-span-1 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm xl:col-span-2">
        <h3 className="mb-4 text-lg font-bold text-neutral-900">Crescimento da Rede</h3>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={dataGrowth}
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
                data={dataDistribution}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
              >
                {dataDistribution.map((entry, index) => (
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
        <h3 className="mb-4 text-lg font-bold text-neutral-900">Top Recrutadores (Mês Atual)</h3>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dataPerformance}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={60} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="recruits" fill="#06b6d4" radius={[0, 4, 4, 0]} barSize={20} name="Cadastros" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
