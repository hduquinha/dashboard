"use client";

import { useState, useEffect, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  FileDown,
  Trophy,
  Users,
  UserCheck,
  TrendingUp,
  Calendar,
  Printer,
} from "lucide-react";

interface TrainingStats {
  id: string;
  label: string;
  startsAt: string | null;
  totalInscritos: number;
  leads: number;
  recrutadores: number;
  presentes: number;
  last24h: number;
}

interface RecruiterRanking {
  recrutadorCodigo: string;
  recrutadorNome: string;
  totalInscritos: number;
  totalAprovados: number;
  percentualAprovacao: number;
}

interface PresenceRanking {
  recrutadorCodigo: string;
  recrutadorNome: string;
  totalPresentes: number;
  totalAprovados: number;
}

interface RelatoriosClientProps {
  trainings: TrainingStats[];
}

const COLORS = [
  "#2DBDC2",
  "#10B981",
  "#6366F1",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
];

export default function RelatoriosClient({ trainings }: RelatoriosClientProps) {
  const [selectedTraining, setSelectedTraining] = useState<string>("");
  const [recruitersRanking, setRecruitersRanking] = useState<RecruiterRanking[]>([]);
  const [presenceRanking, setPresenceRanking] = useState<PresenceRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // Buscar dados do treinamento selecionado
  useEffect(() => {
    if (!selectedTraining) {
      setRecruitersRanking([]);
      setPresenceRanking([]);
      return;
    }

    async function fetchData() {
      setLoading(true);
      try {
        const [rankingRes, presenceRes] = await Promise.all([
          fetch(`/api/trainings/${encodeURIComponent(selectedTraining)}/recruiters`),
          fetch(`/api/presence/list?treinamento=${encodeURIComponent(selectedTraining)}&aprovados=false`),
        ]);

        if (rankingRes.ok) {
          const data = await rankingRes.json();
          setRecruitersRanking(data.ranking || []);
        }

        if (presenceRes.ok) {
          const data = await presenceRes.json();
          // Agrupar presenças por recrutador
          const presenceMap = new Map<string, PresenceRanking>();
          for (const p of data.presences || []) {
            const code = p.recrutadorCodigo ?? "00";
            const name = p.recrutadorNome ?? "Sem Recrutador";
            if (!presenceMap.has(code)) {
              presenceMap.set(code, {
                recrutadorCodigo: code,
                recrutadorNome: name,
                totalPresentes: 0,
                totalAprovados: 0,
              });
            }
            const entry = presenceMap.get(code)!;
            entry.totalPresentes++;
            if (p.aprovado) entry.totalAprovados++;
          }
          setPresenceRanking(
            Array.from(presenceMap.values()).sort((a, b) => b.totalAprovados - a.totalAprovados)
          );
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedTraining]);

  // Exportar para PDF (usando print)
  const handleExportPDF = () => {
    window.print();
  };

  // Dados para gráfico de treinamentos
  const trainingChartData = trainings
    .filter((t) => t.id !== "Sem Treinamento")
    .slice(0, 10)
    .map((t) => ({
      name: t.label.length > 10 ? t.label.slice(0, 10) + "..." : t.label,
      fullName: t.label,
      inscritos: t.totalInscritos,
      presentes: t.presentes,
      recrutadores: t.recrutadores,
    }));

  // Dados para gráfico de pizza (distribuição geral)
  const pieData = [
    { name: "Leads", value: trainings.reduce((acc, t) => acc + t.leads, 0) },
    { name: "Recrutadores", value: trainings.reduce((acc, t) => acc + t.recrutadores, 0) },
  ];

  // Top 10 recrutadores para gráfico
  const topRecruitersChart = recruitersRanking.slice(0, 10).map((r) => ({
    name: r.recrutadorNome.length > 12 ? r.recrutadorNome.slice(0, 12) + "..." : r.recrutadorNome,
    fullName: r.recrutadorNome,
    inscritos: r.totalInscritos,
    aprovados: r.totalAprovados,
  }));

  // Top 10 presenças para gráfico
  const topPresenceChart = presenceRanking.slice(0, 10).map((r) => ({
    name: r.recrutadorNome.length > 12 ? r.recrutadorNome.slice(0, 12) + "..." : r.recrutadorNome,
    fullName: r.recrutadorNome,
    presentes: r.totalPresentes,
    aprovados: r.totalAprovados,
  }));

  const selectedTrainingData = trainings.find((t) => t.id === selectedTraining);

  return (
    <main className="space-y-6 print:space-y-4">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Relatórios</h1>
          <p className="text-sm text-neutral-500">
            Visualize rankings e estatísticas com gráficos.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleExportPDF}
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            <Printer className="h-4 w-4" />
            Imprimir / PDF
          </button>
        </div>
      </header>

      {/* Print Header */}
      <div className="hidden print:block print:mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Relatório de Performance</h1>
        <p className="text-sm text-neutral-500">
          Gerado em {new Date().toLocaleDateString("pt-BR")} às {new Date().toLocaleTimeString("pt-BR")}
        </p>
      </div>

      {/* Filtro de Treinamento */}
      <div className="flex items-center gap-4 print:hidden">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Calendar className="h-4 w-4" />
          Treinamento:
        </label>
        <select
          value={selectedTraining}
          onChange={(e) => setSelectedTraining(e.target.value)}
          className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">Visão Geral (Todos)</option>
          {trainings
            .filter((t) => t.id !== "Sem Treinamento")
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
        </select>
      </div>

      <div ref={reportRef} className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 print:grid-cols-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm print:border-neutral-300">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100">
                <Users className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-neutral-500">Total Inscritos</p>
                <p className="text-xl font-bold text-neutral-900">
                  {selectedTrainingData
                    ? selectedTrainingData.totalInscritos.toLocaleString()
                    : trainings.reduce((acc, t) => acc + t.totalInscritos, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm print:border-neutral-300">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                <UserCheck className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-neutral-500">Presentes</p>
                <p className="text-xl font-bold text-emerald-600">
                  {selectedTrainingData
                    ? selectedTrainingData.presentes.toLocaleString()
                    : trainings.reduce((acc, t) => acc + t.presentes, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm print:border-neutral-300">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
                <Trophy className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-neutral-500">Recrutadores</p>
                <p className="text-xl font-bold text-neutral-900">
                  {selectedTrainingData
                    ? selectedTrainingData.recrutadores.toLocaleString()
                    : trainings.reduce((acc, t) => acc + t.recrutadores, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm print:border-neutral-300">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-neutral-500">Taxa Presença</p>
                <p className="text-xl font-bold text-neutral-900">
                  {selectedTrainingData
                    ? selectedTrainingData.totalInscritos > 0
                      ? Math.round((selectedTrainingData.presentes / selectedTrainingData.totalInscritos) * 100)
                      : 0
                    : trainings.reduce((acc, t) => acc + t.totalInscritos, 0) > 0
                    ? Math.round(
                        (trainings.reduce((acc, t) => acc + t.presentes, 0) /
                          trainings.reduce((acc, t) => acc + t.totalInscritos, 0)) *
                          100
                      )
                    : 0}
                  %
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Gráficos - Visão Geral */}
        {!selectedTraining && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Gráfico de Barras - Treinamentos */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-neutral-900">
                Inscritos por Treinamento
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trainingChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={80} fontSize={12} />
                    <Tooltip
                      formatter={(value, name) => [value, name === "inscritos" ? "Inscritos" : "Presentes"]}
                      labelFormatter={(label, payload) =>
                        payload?.[0]?.payload?.fullName || label
                      }
                    />
                    <Bar dataKey="inscritos" fill="#2DBDC2" name="Inscritos" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="presentes" fill="#10B981" name="Presentes" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gráfico de Pizza - Distribuição */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-neutral-900">
                Distribuição Leads vs Recrutadores
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Gráficos - Treinamento Selecionado */}
        {selectedTraining && !loading && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Ranking de Inscritos */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-neutral-900">
                🏆 Ranking de Inscritos
              </h3>
              {topRecruitersChart.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topRecruitersChart} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} fontSize={11} />
                      <Tooltip
                        labelFormatter={(label, payload) =>
                          payload?.[0]?.payload?.fullName || label
                        }
                      />
                      <Bar dataKey="inscritos" fill="#6366F1" name="Inscritos" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-neutral-500 py-10">Sem dados de ranking</p>
              )}
            </div>

            {/* Ranking de Presença */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-neutral-900">
                ✅ Ranking de Presença
              </h3>
              {topPresenceChart.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topPresenceChart} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} fontSize={11} />
                      <Tooltip
                        labelFormatter={(label, payload) =>
                          payload?.[0]?.payload?.fullName || label
                        }
                      />
                      <Bar dataKey="aprovados" fill="#10B981" name="Aprovados" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="presentes" fill="#2DBDC2" name="Total Presentes" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-neutral-500 py-10">Sem dados de presença</p>
              )}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-cyan-500" />
          </div>
        )}

        {/* Tabela de Ranking */}
        {selectedTraining && !loading && recruitersRanking.length > 0 && (
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-neutral-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-neutral-900">
                Ranking Completo - {selectedTrainingData?.label}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Recrutador
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Inscritos
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Presença Aprovada
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Taxa
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {recruitersRanking.map((r, idx) => {
                    const presenceData = presenceRanking.find(
                      (p) => p.recrutadorCodigo === r.recrutadorCodigo
                    );
                    return (
                      <tr key={r.recrutadorCodigo} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 text-sm">
                          {idx < 3 ? (
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                                idx === 0
                                  ? "bg-yellow-100 text-yellow-700"
                                  : idx === 1
                                  ? "bg-neutral-200 text-neutral-600"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {idx + 1}
                            </span>
                          ) : (
                            <span className="text-neutral-500">{idx + 1}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-900">{r.recrutadorNome}</p>
                          <p className="text-xs text-neutral-500">{r.recrutadorCodigo}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-semibold text-neutral-900">{r.totalInscritos}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-semibold text-emerald-600">
                            {presenceData?.totalAprovados ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.totalInscritos > 0 && (presenceData?.totalAprovados ?? 0) / r.totalInscritos >= 0.5
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-neutral-100 text-neutral-600"
                            }`}
                          >
                            {r.totalInscritos > 0
                              ? Math.round(((presenceData?.totalAprovados ?? 0) / r.totalInscritos) * 100)
                              : 0}
                            %
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:block {
            display: block !important;
          }
          nav,
          aside,
          header.print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}
