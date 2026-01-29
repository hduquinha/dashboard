"use client";

import { useState, useEffect, useMemo } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Filter,
  Users,
  Calendar,
  Download,
  ChevronDown,
  UserCheck,
  UserX,
  Trash2,
  Loader2,
} from "lucide-react";

interface PresenceRecord {
  inscricaoId: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  email: string | null;
  treinamentoId: string;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  participanteNomeZoom: string | null;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  aprovado: boolean;
  validadoEm: string | null;
}

interface ApiResponse {
  success: boolean;
  total: number;
  totalAprovados: number;
  totalReprovados: number;
  presences: PresenceRecord[];
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConfirmedPresencesClient() {
  const [presences, setPresences] = useState<PresenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTraining, setSelectedTraining] = useState<string>("all");
  const [showApproved, setShowApproved] = useState(true);
  const [showRejected, setShowRejected] = useState(true);

  // Stats
  const [totalAprovados, setTotalAprovados] = useState(0);
  const [totalReprovados, setTotalReprovados] = useState(0);

  // Seleção em massa
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isRemovingBulk, setIsRemovingBulk] = useState(false);

  // Remoção de presença
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Toggle seleção de um item
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Selecionar/deselecionar todos os filtrados
  const toggleSelectAll = () => {
    const filteredIds = filteredPresences.map((p) => p.inscricaoId);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));
    
    if (allSelected) {
      // Deseleciona todos
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // Seleciona todos
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // Remover presenças selecionadas em massa
  const handleBulkRemove = async () => {
    if (selectedIds.size === 0) return;
    
    const count = selectedIds.size;
    if (!confirm(`Tem certeza que deseja desassociar ${count} presença(s)?\n\nIsso irá remover a validação de presença e descontabilizar do ranking.`)) {
      return;
    }

    setIsRemovingBulk(true);

    try {
      const response = await fetch("/api/presence/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscricaoIds: Array.from(selectedIds) }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Erro ao remover presenças");
      }

      // Atualiza contadores antes de remover
      const removedItems = presences.filter((p) => selectedIds.has(p.inscricaoId));
      const removedAprovados = removedItems.filter((p) => p.aprovado).length;
      const removedReprovados = removedItems.filter((p) => !p.aprovado).length;

      // Remove da lista local
      setPresences((prev) => prev.filter((p) => !selectedIds.has(p.inscricaoId)));
      
      // Atualiza contadores
      setTotalAprovados((prev) => prev - removedAprovados);
      setTotalReprovados((prev) => prev - removedReprovados);

      // Limpa seleção
      setSelectedIds(new Set());

      alert(data.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover presenças");
    } finally {
      setIsRemovingBulk(false);
    }
  };

  // Função para remover presença
  const handleRemovePresence = async (inscricaoId: number, nome: string) => {
    if (!confirm(`Tem certeza que deseja desassociar a presença de "${nome}"?\n\nIsso irá remover a validação de presença e descontabilizar do ranking.`)) {
      return;
    }

    setRemovingId(inscricaoId);

    try {
      const response = await fetch("/api/presence/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscricaoId }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Erro ao remover presença");
      }

      // Remove da lista local
      setPresences((prev) => prev.filter((p) => p.inscricaoId !== inscricaoId));
      
      // Atualiza contadores
      const removed = presences.find((p) => p.inscricaoId === inscricaoId);
      if (removed) {
        if (removed.aprovado) {
          setTotalAprovados((prev) => prev - 1);
        } else {
          setTotalReprovados((prev) => prev - 1);
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover presença");
    } finally {
      setRemovingId(null);
    }
  };

  // Carregar dados
  useEffect(() => {
    async function fetchPresences() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/presence/list?aprovados=false");
        if (!response.ok) {
          throw new Error("Falha ao carregar presenças");
        }
        const data: ApiResponse = await response.json();
        setPresences(data.presences);
        setTotalAprovados(data.totalAprovados);
        setTotalReprovados(data.totalReprovados);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setLoading(false);
      }
    }

    fetchPresences();
  }, []);

  // Lista de treinamentos únicos
  const trainings = useMemo(() => {
    const unique = new Set(presences.map((p) => p.treinamentoId));
    return Array.from(unique).sort();
  }, [presences]);

  // Filtrar presenças
  const filteredPresences = useMemo(() => {
    return presences.filter((p) => {
      // Filtro de busca
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = p.nome.toLowerCase().includes(query);
        const matchesZoom = p.participanteNomeZoom?.toLowerCase().includes(query);
        const matchesPhone = p.telefone?.includes(query);
        const matchesCity = p.cidade?.toLowerCase().includes(query);
        const matchesRecruiter = p.recrutadorNome?.toLowerCase().includes(query);
        if (!matchesName && !matchesZoom && !matchesPhone && !matchesCity && !matchesRecruiter) {
          return false;
        }
      }

      // Filtro de treinamento
      if (selectedTraining !== "all" && p.treinamentoId !== selectedTraining) {
        return false;
      }

      // Filtro de aprovado/reprovado
      if (p.aprovado && !showApproved) return false;
      if (!p.aprovado && !showRejected) return false;

      return true;
    });
  }, [presences, searchQuery, selectedTraining, showApproved, showRejected]);

  // Exportar CSV
  const handleExport = () => {
    const headers = [
      "Nome",
      "Telefone",
      "Email",
      "Cidade",
      "Treinamento",
      "Recrutador",
      "Nome Zoom",
      "Tempo Total (min)",
      "Tempo Dinâmica (min)",
      "% Dinâmica",
      "Aprovado",
      "Validado Em",
    ];

    const rows = filteredPresences.map((p) => [
      p.nome,
      p.telefone ?? "",
      p.email ?? "",
      p.cidade ?? "",
      p.treinamentoId,
      p.recrutadorNome ?? p.recrutadorCodigo ?? "",
      p.participanteNomeZoom ?? "",
      p.tempoTotalMinutos.toString(),
      p.tempoDinamicaMinutos.toString(),
      p.percentualDinamica.toString(),
      p.aprovado ? "Sim" : "Não",
      p.validadoEm ?? "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `presencas_confirmadas_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-neutral-900">Presenças Confirmadas</h1>
          <p className="text-sm text-neutral-500">Carregando...</p>
        </header>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-cyan-500" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-neutral-900">Presenças Confirmadas</h1>
        </header>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-400" />
          <p className="mt-4 text-red-700">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Presenças Confirmadas</h1>
          <p className="text-sm text-neutral-500">
            Participantes com presença validada nos treinamentos
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={filteredPresences.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </button>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2DBDC2]/10">
            <Users className="h-6 w-6 text-[#2DBDC2]" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Total Validados</p>
            <p className="text-2xl font-bold text-neutral-900">{presences.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
            <UserCheck className="h-6 w-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Aprovados</p>
            <p className="text-2xl font-bold text-emerald-600">{totalAprovados}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
            <UserX className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Reprovados</p>
            <p className="text-2xl font-bold text-red-600">{totalReprovados}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50">
            <Calendar className="h-6 w-6 text-purple-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Treinamentos</p>
            <p className="text-2xl font-bold text-purple-600">{trainings.length}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Buscar por nome, telefone, cidade ou recrutador..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-4 text-sm transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
          />
        </div>

        {/* Training Filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <select
            value={selectedTraining}
            onChange={(e) => setSelectedTraining(e.target.value)}
            className="appearance-none rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-10 text-sm transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="all">Todos os treinamentos</option>
            {trainings.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        </div>

        {/* Status Toggles */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowApproved(!showApproved)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              showApproved
                ? "bg-emerald-100 text-emerald-700"
                : "bg-neutral-100 text-neutral-400"
            }`}
          >
            <CheckCircle className="h-4 w-4" />
            Aprovados
          </button>
          <button
            type="button"
            onClick={() => setShowRejected(!showRejected)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              showRejected
                ? "bg-red-100 text-red-700"
                : "bg-neutral-100 text-neutral-400"
            }`}
          >
            <XCircle className="h-4 w-4" />
            Reprovados
          </button>
        </div>

        {/* Botão de desassociar em massa */}
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={handleBulkRemove}
            disabled={isRemovingBulk}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRemovingBulk ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Desassociar ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Results */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-6 py-4">
          <p className="text-sm text-neutral-500">
            Exibindo <span className="font-medium text-neutral-900">{filteredPresences.length}</span> de{" "}
            <span className="font-medium text-neutral-900">{presences.length}</span> registros
          </p>
        </div>

        {filteredPresences.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="mx-auto h-12 w-12 text-neutral-300" />
            <h3 className="mt-4 text-lg font-medium text-neutral-900">Nenhum registro encontrado</h3>
            <p className="mt-2 text-sm text-neutral-500">
              Ajuste os filtros ou aguarde a validação de presenças.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3 w-12">
                    <input
                      type="checkbox"
                      checked={filteredPresences.length > 0 && filteredPresences.every((p) => selectedIds.has(p.inscricaoId))}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-neutral-300 text-cyan-600 focus:ring-cyan-500"
                    />
                  </th>
                  <th className="px-6 py-3">Participante</th>
                  <th className="px-6 py-3">Contato</th>
                  <th className="px-6 py-3">Treinamento</th>
                  <th className="px-6 py-3">Recrutador</th>
                  <th className="px-6 py-3">Tempo</th>
                  <th className="px-6 py-3">Dinâmica</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Validado</th>
                  <th className="px-6 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredPresences.map((p) => (
                  <tr key={p.inscricaoId} className={`hover:bg-neutral-50 ${selectedIds.has(p.inscricaoId) ? 'bg-cyan-50' : ''}`}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.inscricaoId)}
                        onChange={() => toggleSelect(p.inscricaoId)}
                        className="h-4 w-4 rounded border-neutral-300 text-cyan-600 focus:ring-cyan-500"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-neutral-900">{p.nome}</p>
                        {p.participanteNomeZoom && p.participanteNomeZoom !== p.nome && (
                          <p className="text-xs text-neutral-500">
                            Zoom: {p.participanteNomeZoom}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        {p.telefone && <p className="text-neutral-700">{p.telefone}</p>}
                        {p.cidade && <p className="text-neutral-500">{p.cidade}</p>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                        {p.treinamentoId}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-neutral-600">
                        {p.recrutadorNome ?? p.recrutadorCodigo ?? "-"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-sm text-neutral-600">
                        <Clock className="h-4 w-4" />
                        {formatMinutes(p.tempoTotalMinutos)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-neutral-200">
                          <div
                            className={`h-full rounded-full ${
                              p.percentualDinamica >= 100
                                ? "bg-emerald-500"
                                : p.percentualDinamica >= 50
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${Math.min(p.percentualDinamica, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-neutral-500">{p.percentualDinamica}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {p.aprovado ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                          <CheckCircle className="h-3 w-3" />
                          Aprovado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                          <XCircle className="h-3 w-3" />
                          Reprovado
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-neutral-500">
                      {formatDate(p.validadoEm)}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => handleRemovePresence(p.inscricaoId, p.nome)}
                        disabled={removingId === p.inscricaoId}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Desassociar presença"
                      >
                        {removingId === p.inscricaoId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Desassociar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
