"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Trophy,
  Users,
  Calendar,
  Search,
  Eye,
  EyeOff,
  X,
  Printer,
  BarChart3,
  Timer,
  CheckCircle,
  XCircle,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Types ──────────────────────────────────────────────

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

interface RankingRecord {
  inscricaoId: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  email: string | null;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  participanteNomeZoom: string | null;
  // Dia da dinâmica
  presenteNaDinamica: boolean;
  tempoDinamicaDiaMinutos: number;
  tempoTotalDiaMinutos: number;
  percentualDinamicaDia: number;
  // Geral
  tempoTotalGeralMinutos: number;
  tempoDinamicaGeralMinutos: number;
  aprovado: boolean;
  validadoEm: string | null;
  totalDias: number;
  dinamicaDay: string;
}

interface RankingClientProps {
  trainings: TrainingStats[];
}

// ── Helpers ────────────────────────────────────────────

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0min";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── Component ──────────────────────────────────────────

export default function RankingClient({ trainings }: RankingClientProps) {
  const [selectedTraining, setSelectedTraining] = useState("");
  const [allRecords, setAllRecords] = useState<RankingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [dinamicaDayLabel, setDinamicaDayLabel] = useState("");
  const [totalPresentesDinamica, setTotalPresentesDinamica] = useState(0);

  // ── Fetch ranking data ─────────────────────────────

  useEffect(() => {
    if (!selectedTraining) {
      setAllRecords([]);
      setDinamicaDayLabel("");
      setTotalPresentesDinamica(0);
      return;
    }

    let cancelled = false;

    async function fetchRanking() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/presence/ranking?treinamento=${encodeURIComponent(selectedTraining)}`
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setAllRecords(data.ranking ?? []);
          setDinamicaDayLabel(data.dinamicaDayLabel ?? "");
          setTotalPresentesDinamica(data.totalPresentesDinamica ?? 0);
        }
      } catch (err) {
        console.error("Erro ao carregar ranking:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRanking();
    return () => { cancelled = true; };
  }, [selectedTraining]);

  // Reset exclusions when switching training
  useEffect(() => {
    setExcludedIds(new Set());
    setShowExcluded(false);
    setSearchTerm("");
  }, [selectedTraining]);

  // ── Derived data ───────────────────────────────────

  const toggleExclude = useCallback((id: number) => {
    setExcludedIds((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Records already come sorted from API (present on dinâmica day first, by time)
  const visibleRecords = useMemo(() => {
    return allRecords.filter((r: RankingRecord) => {
      if (excludedIds.has(r.inscricaoId)) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return (
          r.nome.toLowerCase().includes(q) ||
          (r.recrutadorNome ?? "").toLowerCase().includes(q) ||
          (r.recrutadorCodigo ?? "").toLowerCase().includes(q) ||
          (r.cidade ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allRecords, excludedIds, searchTerm]);

  const excludedRecords = useMemo(
    () => allRecords.filter((r: RankingRecord) => excludedIds.has(r.inscricaoId)),
    [allRecords, excludedIds]
  );

  // Only show people who were present on dinâmica day in chart
  const chartData = useMemo(() => {
    return visibleRecords
      .filter((r: RankingRecord) => r.presenteNaDinamica)
      .slice(0, 15)
      .map((r: RankingRecord) => ({
        name: r.nome.length > 14 ? r.nome.slice(0, 14) + "…" : r.nome,
        fullName: r.nome,
        tempoDia: r.tempoTotalDiaMinutos,
        dinamica: r.tempoDinamicaDiaMinutos,
      }));
  }, [visibleRecords]);

  const selectedLabel =
    trainings.find((t) => t.id === selectedTraining)?.label ?? "";

  // ── Render ─────────────────────────────────────────

  return (
    <main className="space-y-6 print:space-y-4">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-500" />
            Ranking de Presença na Dinâmica
          </h1>
          <p className="text-sm text-neutral-500">
            Classificação por <strong>quem esteve presente no dia da dinâmica</strong>.
            {dinamicaDayLabel && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                <Info className="h-3 w-3" />
                Dinâmica: {dinamicaDayLabel}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
        >
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </button>
      </header>

      {/* Print Header */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-2xl font-bold text-neutral-900">
          Ranking de Presença na Dinâmica
        </h1>
        <p className="text-sm text-neutral-500">
          {selectedLabel}
          {dinamicaDayLabel ? ` — Dinâmica: ${dinamicaDayLabel}` : ""} — Gerado em{" "}
          {new Date().toLocaleDateString("pt-BR")} às{" "}
          {new Date().toLocaleTimeString("pt-BR")}
        </p>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Calendar className="h-4 w-4" />
          Treinamento:
        </label>
        <select
          value={selectedTraining}
          onChange={(e) => setSelectedTraining(e.target.value)}
          className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">Selecione um treinamento</option>
          {trainings
            .filter((t) => t.id !== "Sem Treinamento")
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
        </select>
      </div>

      {/* No training selected */}
      {!selectedTraining && (
        <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
          <Trophy className="h-12 w-12 mb-3 opacity-40" />
          <p className="text-lg font-medium">Selecione um treinamento para ver o ranking</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-amber-500" />
        </div>
      )}

      {/* Results */}
      {selectedTraining && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 print:grid-cols-4">
            <Card
              icon={<Users className="h-5 w-5 text-cyan-600" />}
              bg="bg-cyan-100"
              label="Total c/ Presença"
              value={allRecords.length}
            />
            <Card
              icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
              bg="bg-emerald-100"
              label="Presentes Dinâmica"
              value={totalPresentesDinamica - excludedRecords.filter((r: RankingRecord) => r.presenteNaDinamica).length}
            />
            <Card
              icon={<EyeOff className="h-5 w-5 text-red-500" />}
              bg="bg-red-100"
              label="Excluídos"
              value={excludedIds.size}
            />
            <Card
              icon={<Timer className="h-5 w-5 text-amber-600" />}
              bg="bg-amber-100"
              label={dinamicaDayLabel || "Dia da Dinâmica"}
              value={
                (() => {
                  const presentesDinamica = visibleRecords.filter((r: RankingRecord) => r.presenteNaDinamica);
                  if (presentesDinamica.length === 0) return "—";
                  const avg = Math.round(
                    presentesDinamica.reduce((s: number, r: RankingRecord) => s + r.tempoTotalDiaMinutos, 0) /
                      presentesDinamica.length
                  );
                  return `${formatMinutes(avg)} média`;
                })()
              }
            />
          </div>

          {/* Chart – Top 15 presentes no dia da dinâmica */}
          {chartData.length > 0 && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-neutral-900">
                <BarChart3 className="h-5 w-5 text-amber-500" />
                Top 15 – Presença no Dia da Dinâmica
                {dinamicaDayLabel && (
                  <span className="text-xs font-normal text-neutral-400">({dinamicaDayLabel})</span>
                )}
              </h3>
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatMinutes(v)}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={120}
                      fontSize={11}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatMinutes(value),
                        name === "tempoDia" ? "Tempo no Dia" : "Tempo na Dinâmica",
                      ]}
                      labelFormatter={(_label: string, payload: Array<{ payload?: { fullName?: string } }>) =>
                        payload?.[0]?.payload?.fullName || _label
                      }
                    />
                    <Bar
                      dataKey="tempoDia"
                      fill="#2DBDC2"
                      name="Tempo no Dia"
                      radius={[0, 4, 4, 0]}
                    />
                    <Bar
                      dataKey="dinamica"
                      fill="#F59E0B"
                      name="Tempo na Dinâmica"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Search + excluded toggle */}
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                placeholder="Buscar por nome, recrutador, cidade…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-4 text-sm shadow-sm placeholder:text-neutral-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </div>
            {excludedIds.size > 0 && (
              <button
                onClick={() => setShowExcluded(!showExcluded)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  showExcluded
                    ? "bg-red-100 text-red-700 ring-1 ring-red-300"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {showExcluded ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {showExcluded ? "Ocultar" : "Ver"} excluídos ({excludedIds.size})
              </button>
            )}
            {excludedIds.size > 0 && (
              <button
                onClick={() => setExcludedIds(new Set())}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition"
              >
                <X className="h-3.5 w-3.5" />
                Limpar exclusões
              </button>
            )}
          </div>

          {/* Excluded list */}
          {showExcluded && excludedRecords.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 print:hidden">
              <h4 className="mb-2 text-sm font-semibold text-red-700 flex items-center gap-1.5">
                <EyeOff className="h-4 w-4" />
                Nomes excluídos do ranking
              </h4>
              <div className="flex flex-wrap gap-2">
                {excludedRecords.map((r) => (
                  <button
                    key={r.inscricaoId}
                    onClick={() => toggleExclude(r.inscricaoId)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-100 transition"
                  >
                    {r.nome}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ranking Table */}
          {visibleRecords.length > 0 ? (
            <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  Ranking por Presença na Dinâmica – {selectedLabel}
                </h3>
                <span className="text-xs text-neutral-500">
                  {visibleRecords.length} participante{visibleRecords.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 w-12">
                        #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        Participante
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 hidden md:table-cell">
                        Recrutador
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-amber-600">
                        Presente Dinâmica
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        Tempo no Dia
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500 hidden md:table-cell">
                        Tempo Dinâmica
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500 hidden lg:table-cell">
                        Tempo Total Geral
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500 print:hidden">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibleRecords.map((r, idx) => {
                      const medal =
                        r.presenteNaDinamica && idx === 0
                          ? "🥇"
                          : r.presenteNaDinamica && idx === 1
                          ? "🥈"
                          : r.presenteNaDinamica && idx === 2
                          ? "🥉"
                          : null;
                      return (
                        <tr
                          key={r.inscricaoId}
                          className={`hover:bg-neutral-50 transition ${
                            !r.presenteNaDinamica
                              ? "opacity-50"
                              : idx < 3
                              ? "bg-amber-50/40"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-sm">
                            {medal ? (
                              <span className="text-lg" title={`${idx + 1}º`}>
                                {medal}
                              </span>
                            ) : (
                              <span className="text-neutral-400 font-medium">
                                {idx + 1}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-neutral-900">
                              {r.nome}
                            </p>
                            {r.cidade && (
                              <p className="text-xs text-neutral-500">
                                {r.cidade}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            {r.recrutadorNome ? (
                              <>
                                <p className="text-sm text-neutral-700">
                                  {r.recrutadorNome}
                                </p>
                                <p className="text-xs text-neutral-400">
                                  {r.recrutadorCodigo}
                                </p>
                              </>
                            ) : (
                              <span className="text-xs text-neutral-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {r.presenteNaDinamica ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                                <CheckCircle className="h-3.5 w-3.5" />
                                Sim
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
                                <XCircle className="h-3.5 w-3.5" />
                                Não
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                r.tempoTotalDiaMinutos > 0
                                  ? "bg-cyan-100 text-cyan-800"
                                  : "bg-neutral-100 text-neutral-500"
                              }`}
                            >
                              {formatMinutes(r.tempoTotalDiaMinutos)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center hidden md:table-cell">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                r.tempoDinamicaDiaMinutos > 0
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-neutral-100 text-neutral-500"
                              }`}
                            >
                              {formatMinutes(r.tempoDinamicaDiaMinutos)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-neutral-700 hidden lg:table-cell">
                            {formatMinutes(r.tempoTotalGeralMinutos)}
                          </td>
                          <td className="px-4 py-3 text-center print:hidden">
                            <button
                              onClick={() => toggleExclude(r.inscricaoId)}
                              title="Excluir do ranking"
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition"
                            >
                              <EyeOff className="h-3.5 w-3.5" />
                              Excluir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
              <Users className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm">Nenhum participante encontrado.</p>
            </div>
          )}
        </>
      )}

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

// ── Small summary card ───────────────────────────────

function Card({
  icon,
  bg,
  label,
  value,
}: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm print:border-neutral-300">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}
        >
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium text-neutral-500">{label}</p>
          <p className="text-xl font-bold text-neutral-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
