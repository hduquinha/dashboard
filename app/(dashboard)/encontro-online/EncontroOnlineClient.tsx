"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Filter,
  Users,
  CheckCircle,
  Eye,
  EyeOff,
  PlayCircle,
  Loader2,
  AlertTriangle,
  ChevronDown,
  BarChart3,
  Focus,
  FastForward,
  Clock,
  RefreshCw,
} from "lucide-react";
import type {
  EOReport,
  EOParticipantRow,
  EOStatusDisplay,
  EOSummary,
} from "@/types/encontroOnline";

/* ─────────────── helpers ─────────────── */

const STATUS_CONFIG: Record<
  EOStatusDisplay,
  { label: string; color: string; bg: string; dot: string }
> = {
  concluido: {
    label: "Concluído",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    dot: "bg-emerald-500",
  },
  assistindo: {
    label: "Assistindo",
    color: "text-yellow-700",
    bg: "bg-yellow-50",
    dot: "bg-yellow-500",
  },
  iniciou: {
    label: "Iniciou",
    color: "text-blue-700",
    bg: "bg-blue-50",
    dot: "bg-blue-500",
  },
  nao_assistiu: {
    label: "Não assistiu",
    color: "text-red-700",
    bg: "bg-red-50",
    dot: "bg-red-500",
  },
  nao_cadastrado: {
    label: "Não cadastrado",
    color: "text-neutral-500",
    bg: "bg-neutral-50",
    dot: "bg-neutral-400",
  },
};

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}min` : `${h}h`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ─────────────── Summary Cards ─────────────── */

function SummaryCards({ summary }: { summary: EOSummary }) {
  const cards = [
    {
      label: "Cadastrados",
      value: summary.totalRegistered,
      icon: Users,
      color: "text-neutral-600",
    },
    {
      label: "Concluíram",
      value: summary.totalCompleted,
      icon: CheckCircle,
      color: "text-emerald-600",
    },
    {
      label: "Assistindo",
      value: summary.totalWatching,
      icon: Eye,
      color: "text-yellow-600",
    },
    {
      label: "Iniciaram",
      value: summary.totalStarted,
      icon: PlayCircle,
      color: "text-blue-600",
    },
    {
      label: "Não assistiram",
      value: summary.totalNotWatched,
      icon: EyeOff,
      color: "text-red-600",
    },
    {
      label: "Média assistido",
      value: `${summary.avgPercentWatched}%`,
      icon: BarChart3,
      color: "text-violet-600",
    },
    {
      label: "Média tempo",
      value: formatSeconds(summary.avgWatchTimeSeconds),
      icon: Clock,
      color: "text-indigo-600",
    },
    {
      label: "Média foco",
      value: `${summary.avgFocusPercent}%`,
      icon: Focus,
      color: "text-cyan-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <c.icon className={`h-4 w-4 ${c.color}`} />
            <span className="text-xs text-neutral-500">{c.label}</span>
          </div>
          <p className={`mt-1 text-xl font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ─────────────── Status Badge ─────────────── */

function StatusBadge({ status }: { status: EOStatusDisplay }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/* ─────────────── Percent Bar ─────────────── */

function PercentBar({ value }: { value: number }) {
  const color =
    value >= 90
      ? "bg-emerald-500"
      : value >= 50
        ? "bg-yellow-500"
        : value > 0
          ? "bg-blue-500"
          : "bg-neutral-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className="text-xs text-neutral-600">{value}%</span>
    </div>
  );
}

/* ─────────────── Main Component ─────────────── */

export default function EncontroOnlineClient() {
  const [report, setReport] = useState<EOReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EOStatusDisplay | "todos">(
    "todos"
  );
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  useEffect(() => {
    fetchReport();
  }, []);

  async function fetchReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/encontro-online");
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Erro ao buscar dados");
      setReport(data.report);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(
    () => (report ? report.participants : []),
    [report]
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== "todos") {
      list = list.filter((r: EOParticipantRow) => r.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r: EOParticipantRow) =>
          r.name.toLowerCase().includes(q) || r.phone.includes(q)
      );
    }
    return list;
  }, [rows, statusFilter, search]);

  /* ─────────────── Render ─────────────── */

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        <span className="ml-3 text-neutral-500">
          Buscando dados do Encontro Online…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-10 w-10 text-red-400" />
        <p className="text-red-600">{error}</p>
        <button
          onClick={fetchReport}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white transition hover:bg-neutral-700"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!report) return null;

  const statusOptions: { key: EOStatusDisplay | "todos"; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "concluido", label: "Concluído" },
    { key: "assistindo", label: "Assistindo" },
    { key: "iniciou", label: "Iniciou" },
    { key: "nao_assistiu", label: "Não assistiu" },
    { key: "nao_cadastrado", label: "Não cadastrado" },
  ];

  return (
    <div className="space-y-6">
      {/* Summary */}
      <SummaryCards summary={report.summary} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#2DBDC2] focus:ring-2 focus:ring-[#2DBDC2]/20"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu((v: boolean) => !v)}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm transition hover:bg-neutral-50"
          >
            <Filter className="h-4 w-4 text-neutral-400" />
            <span>
              {statusFilter === "todos"
                ? "Filtrar status"
                : STATUS_CONFIG[statusFilter as EOStatusDisplay].label}
            </span>
            <ChevronDown className="h-3 w-3 text-neutral-400" />
          </button>

          {showFilterMenu && (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
              {statusOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setStatusFilter(opt.key);
                    setShowFilterMenu(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-neutral-50 ${
                    statusFilter === opt.key
                      ? "bg-neutral-100 font-medium"
                      : ""
                  }`}
                >
                  {opt.key !== "todos" && (
                    <span
                      className={`mr-2 inline-block h-2 w-2 rounded-full ${STATUS_CONFIG[opt.key as EOStatusDisplay].dot}`}
                    />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={fetchReport}
          className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm transition hover:bg-neutral-50"
          title="Atualizar dados"
        >
          <RefreshCw className="h-4 w-4 text-neutral-400" />
        </button>

        {/* Count */}
        <span className="ml-auto text-sm text-neutral-500">
          {filtered.length} de {rows.length} participantes
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">% Assistido</th>
              <th className="px-4 py-3">Tempo</th>
              <th className="px-4 py-3">Foco</th>
              <th className="px-4 py-3">Skips</th>
              <th className="px-4 py-3">Velocidade</th>
              <th className="px-4 py-3">Sessões</th>
              <th className="px-4 py-3">Último acesso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-neutral-400"
                >
                  Nenhum participante encontrado.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr
                  key={row.phone}
                  className="transition hover:bg-neutral-50"
                >
                  <td className="px-4 py-3 font-medium text-neutral-800">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 tabular-nums">
                    {row.phone}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PercentBar value={row.percentWatched} />
                  </td>
                  <td className="px-4 py-3 text-neutral-600 tabular-nums">
                    {formatSeconds(row.totalWatchedSeconds)}
                  </td>
                  <td className="px-4 py-3">
                    {row.focusPercent != null ? (
                      <span
                        className={
                          row.focusPercent >= 80
                            ? "text-emerald-600"
                            : row.focusPercent >= 50
                              ? "text-yellow-600"
                              : "text-red-600"
                        }
                      >
                        {row.focusPercent}%
                      </span>
                    ) : (
                      <span className="text-neutral-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.forwardSkips != null ? (
                      <span
                        className={
                          row.forwardSkips > 5
                            ? "font-medium text-red-600"
                            : "text-neutral-600"
                        }
                        title={
                          row.forwardSkips > 5
                            ? "Alto número de skips — possível fraude"
                            : undefined
                        }
                      >
                        {row.forwardSkips}
                        {row.forwardSkips > 5 && (
                          <FastForward className="ml-1 inline h-3 w-3" />
                        )}
                      </span>
                    ) : (
                      <span className="text-neutral-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {row.playbackSpeed != null
                      ? `${row.playbackSpeed}×`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {row.sessions ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">
                    {formatDate(row.lastWatchedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Generated at */}
      {report.summary.generatedAt && (
        <p className="text-xs text-neutral-400 text-right">
          Relatório gerado em{" "}
          {formatDate(report.summary.generatedAt)}
        </p>
      )}
    </div>
  );
}
