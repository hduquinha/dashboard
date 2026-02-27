"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Trophy,
  Users,
  UserCheck,
  Percent,
  Medal,
  ChevronRight,
  Calendar,
  Search,
  AlertTriangle,
  HelpCircle,
  Clock,
  CheckCircle,
  XCircle,
  UserX,
  Trash2,
  RotateCcw,
  Loader2,
  FileDown,
  FileText,
} from "lucide-react";

interface RecruiterRanking {
  recrutadorCodigo: string;
  recrutadorNome: string;
  totalInscritos: number;
  totalAprovados: number;
  percentualAprovacao: number;
}

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
  totalDias: number;
  diaProcessado: number;
  dia1Aprovado: boolean | null;
  dia2Aprovado: boolean | null;
  dia1Tempo: number | null;
  dia2Tempo: number | null;
}

interface PendingRecord {
  id: number;
  participanteNome: string;
  treinamentoId: string;
  aprovado: boolean;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  status: "not-found" | "doubt";
  inscricaoId1: number | null;
  inscricaoNome1: string | null;
  inscricaoId2: number | null;
  inscricaoNome2: string | null;
  criadoEm: string;
}

interface PresenceRanking {
  recrutadorCodigo: string;
  recrutadorNome: string;
  totalPresentes: number;
  totalAprovados: number;
}

type PresenceTab = "ranking" | "detalhes" | "nao-associados" | "relatorio";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

interface TrainingDetailsClientProps {
  treinamentoId: string;
  initialTab?: PresenceTab;
}

export default function TrainingDetailsClient({
  treinamentoId,
  initialTab,
}: TrainingDetailsClientProps) {
  const [ranking, setRanking] = useState<RecruiterRanking[]>([]);
  const [presences, setPresences] = useState<PresenceRecord[]>([]);
  const [pending, setPending] = useState<PendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PresenceTab>(initialTab || "ranking");
  const [searchQuery, setSearchQuery] = useState("");
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState<false | "all" | 1 | 2>(false);
  const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Handler para gerar PDF
  const handlePrintPdf = (section: "detalhes" | "nao-associados" | "all") => {
    const printUrl = `/api/presence/print?treinamento=${encodeURIComponent(treinamentoId)}&section=${section}`;
    window.open(printUrl, "_blank");
  };

  // Normaliza ID para comparação robusta (trim, lowercase, decode)
  const normalizeId = (id: string) => {
    let normalized = id.trim().toLowerCase();
    try { normalized = decodeURIComponent(normalized); } catch { /* já decodificado */ }
    return normalized;
  };

  // Verifica se dois IDs de treinamento são equivalentes
  const idsMatch = (a: string, b: string) => normalizeId(a) === normalizeId(b);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Buscar ranking E TODAS as presenças (sem filtro de treinamento)
        // Mesma abordagem da página Presenças Confirmadas que funciona perfeitamente
        const [rankingRes, presencesRes] = await Promise.all([
          fetch(`/api/trainings/${encodeURIComponent(treinamentoId)}/recruiters`),
          fetch(`/api/presence/list?aprovados=false`),
        ]);

        if (!rankingRes.ok || !presencesRes.ok) {
          throw new Error("Falha ao carregar dados");
        }

        const rankingData = await rankingRes.json();
        const presencesData = await presencesRes.json();

        setRanking(rankingData.ranking || []);

        const allPresences: PresenceRecord[] = presencesData.presences || [];
        const allPending: PendingRecord[] = presencesData.pending || [];

        // Filtrar client-side pelo treinamento (mesmo approach do ConfirmedPresencesClient)
        const matchedPresences = allPresences.filter(
          (p) => idsMatch(p.treinamentoId, treinamentoId)
        );
        const matchedPending = allPending.filter(
          (p) => idsMatch(p.treinamentoId, treinamentoId)
        );

        // Debug: se vazio mas há presenças globais, logar para diagnóstico
        if (matchedPresences.length === 0 && allPresences.length > 0) {
          const uniqueTrainings = [...new Set(allPresences.map(p => p.treinamentoId))];
          console.warn("[TrainingDetails] Nenhuma presença encontrada para este treinamento.");
          console.warn("[TrainingDetails] Target ID:", JSON.stringify(treinamentoId));
          console.warn("[TrainingDetails] Target normalizado:", JSON.stringify(normalizeId(treinamentoId)));
          console.warn("[TrainingDetails] IDs disponíveis:", uniqueTrainings.map(t => JSON.stringify(t)));
          console.warn("[TrainingDetails] IDs normalizados:", uniqueTrainings.map(t => JSON.stringify(normalizeId(t))));
          console.warn("[TrainingDetails] Total presenças globais:", allPresences.length);
        }

        setPresences(matchedPresences);
        setPending(matchedPending);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [treinamentoId]);

  // Estatísticas
  const totalInscritos = ranking.reduce((acc, r) => acc + r.totalInscritos, 0);
  const totalAprovados = presences.filter((p) => p.aprovado).length;
  const totalParciais = presences.filter(
    (p) => p.totalDias === 2 && p.diaProcessado < 2 && !p.aprovado
  ).length;
  const totalReprovados = presences.filter(
    (p) => !p.aprovado && !(p.totalDias === 2 && p.diaProcessado < 2)
  ).length;
  const hasMultiDay = presences.some((p) => p.totalDias > 1);
  const totalNaoAssociados = pending.length;

  // Filter presences by search query
  const filteredPresences = useMemo(() => {
    if (!searchQuery.trim()) return presences;
    const q = searchQuery.toLowerCase();
    return presences.filter(
      (p) =>
        p.nome.toLowerCase().includes(q) ||
        (p.participanteNomeZoom && p.participanteNomeZoom.toLowerCase().includes(q)) ||
        (p.recrutadorNome && p.recrutadorNome.toLowerCase().includes(q)) ||
        (p.cidade && p.cidade.toLowerCase().includes(q)) ||
        (p.telefone && p.telefone.includes(q))
    );
  }, [presences, searchQuery]);

  // Filter pending by search query
  const filteredPending = useMemo(() => {
    if (!searchQuery.trim()) return pending;
    const q = searchQuery.toLowerCase();
    return pending.filter(
      (p) =>
        p.participanteNome.toLowerCase().includes(q) ||
        (p.inscricaoNome1 && p.inscricaoNome1.toLowerCase().includes(q)) ||
        (p.inscricaoNome2 && p.inscricaoNome2.toLowerCase().includes(q))
    );
  }, [pending, searchQuery]);

  // Handler de reset de presenças
  const handleReset = async (target: "all" | 1 | 2) => {
    setResetting(true);
    setResetMessage(null);
    try {
      const body: { treinamentoId: string; day?: number } = { treinamentoId };
      if (target !== "all") body.day = target;

      const res = await fetch("/api/presence/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao resetar");
      }
      setResetMessage({ type: "success", text: data.message });
      // Recarregar dados (fetch all + filter client-side)
      const [rankingRes, presencesRes] = await Promise.all([
        fetch(`/api/trainings/${encodeURIComponent(treinamentoId)}/recruiters`),
        fetch(`/api/presence/list?aprovados=false`),
      ]);
      if (rankingRes.ok && presencesRes.ok) {
        const rankingData = await rankingRes.json();
        const presencesData = await presencesRes.json();
        const allPresences: PresenceRecord[] = presencesData.presences || [];
        const allPending: PendingRecord[] = presencesData.pending || [];
        setRanking(rankingData.ranking || []);
        setPresences(allPresences.filter(p => idsMatch(p.treinamentoId, treinamentoId)));
        setPending(allPending.filter(p => idsMatch(p.treinamentoId, treinamentoId)));
      }
    } catch (err) {
      setResetMessage({ type: "error", text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  // Ranking de inscritos ordenado por aprovados, desempate por inscritos
  const sortedRanking = useMemo(() => {
    return [...ranking].sort((a, b) => {
      if (b.totalAprovados !== a.totalAprovados) {
        return b.totalAprovados - a.totalAprovados;
      }
      return b.totalInscritos - a.totalInscritos;
    });
  }, [ranking]);

  // Ranking de presenças (agrupado por recrutador)
  const presenceRanking = useMemo(() => {
    const map = new Map<string, PresenceRanking>();
    
    presences.forEach((p) => {
      const code = p.recrutadorCodigo ?? "00";
      const name = p.recrutadorNome ?? "Sem Recrutador";
      
      if (!map.has(code)) {
        map.set(code, {
          recrutadorCodigo: code,
          recrutadorNome: name,
          totalPresentes: 0,
          totalAprovados: 0,
        });
      }
      
      const entry = map.get(code)!;
      entry.totalPresentes++;
      if (p.aprovado) {
        entry.totalAprovados++;
      }
    });
    
    // Ordenar por aprovados, desempate por presentes
    return Array.from(map.values()).sort((a, b) => {
      if (b.totalAprovados !== a.totalAprovados) {
        return b.totalAprovados - a.totalAprovados;
      }
      return b.totalPresentes - a.totalPresentes;
    });
  }, [presences]);

  // Medalha para os 3 primeiros
  const getMedalColor = (index: number): string => {
    switch (index) {
      case 0:
        return "text-yellow-500"; // Ouro
      case 1:
        return "text-neutral-400"; // Prata
      case 2:
        return "text-amber-600"; // Bronze
      default:
        return "text-neutral-300";
    }
  };

  if (loading) {
    return (
      <main className="space-y-6">
        <header className="flex items-center gap-4">
          <Link
            href="/treinamentos"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 transition hover:bg-neutral-50"
          >
            <ArrowLeft className="h-5 w-5 text-neutral-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Treinamento</h1>
            <p className="text-sm text-neutral-500">Carregando...</p>
          </div>
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
        <header className="flex items-center gap-4">
          <Link
            href="/treinamentos"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 transition hover:bg-neutral-50"
          >
            <ArrowLeft className="h-5 w-5 text-neutral-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Treinamento</h1>
          </div>
        </header>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex items-center gap-4">
        <Link
          href="/treinamentos"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 transition hover:bg-neutral-50"
        >
          <ArrowLeft className="h-5 w-5 text-neutral-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-neutral-900">{treinamentoId}</h1>
          <p className="text-sm text-neutral-500">
            Ranking de recrutadores e presenças confirmadas
          </p>
        </div>
        {/* Botão de Reset */}
        {presences.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowResetConfirm(showResetConfirm ? false : "all")}
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100"
            >
              <RotateCcw className="h-4 w-4" />
              Resetar Presenças
            </button>
            {showResetConfirm && (
              <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <Trash2 className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-900">Resetar Presenças</h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      Isso vai remover os dados de presença das inscrições deste treinamento. As inscrições em si não serão excluídas.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    onClick={() => handleReset("all")}
                    disabled={resetting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Resetar Tudo (Dia 1 + Dia 2)
                  </button>
                  {hasMultiDay && (
                    <>
                      <button
                        onClick={() => handleReset(1)}
                        disabled={resetting}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Resetar apenas Dia 1
                      </button>
                      <button
                        onClick={() => handleReset(2)}
                        disabled={resetting}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Resetar apenas Dia 2
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className="flex w-full items-center justify-center rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Reset feedback message */}
      {resetMessage && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            resetMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {resetMessage.text}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50">
            <Users className="h-6 w-6 text-purple-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Recrutadores</p>
            <p className="text-2xl font-bold text-neutral-900">{ranking.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2DBDC2]/10">
            <Users className="h-6 w-6 text-[#2DBDC2]" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Total Inscritos</p>
            <p className="text-2xl font-bold text-neutral-900">{totalInscritos}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
            <UserCheck className="h-6 w-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Presenças Aprovadas</p>
            <p className="text-2xl font-bold text-emerald-600">{totalAprovados}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
            <Clock className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Parciais</p>
            <p className="text-2xl font-bold text-amber-600">{totalParciais}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
            <Percent className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Reprovados</p>
            <p className="text-2xl font-bold text-red-600">{totalReprovados}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
        <button
          onClick={() => setActiveTab("ranking")}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "ranking"
              ? "border-[#2DBDC2] text-[#2DBDC2]"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Rankings
          </div>
        </button>
        <button
          onClick={() => setActiveTab("detalhes")}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "detalhes"
              ? "border-[#2DBDC2] text-[#2DBDC2]"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Presenças Detalhadas
            {presences.length > 0 && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">
                {presences.length}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab("nao-associados")}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "nao-associados"
              ? "border-[#2DBDC2] text-[#2DBDC2]"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <div className="flex items-center gap-2">
            <UserX className="h-4 w-4" />
            Não Associados
            {totalNaoAssociados > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs">
                {totalNaoAssociados}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab("relatorio")}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "relatorio"
              ? "border-[#2DBDC2] text-[#2DBDC2]"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Relatório Completo
          </div>
        </button>
      </div>

      {/* Search bar for detail/pending/relatorio tabs */}
      {(activeTab === "detalhes" || activeTab === "nao-associados" || activeTab === "relatorio") && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Buscar por nome, nome Zoom, recrutador, cidade..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-100"
          />
        </div>
      )}

      {/* =================== TAB: Rankings =================== */}
      {activeTab === "ranking" && (
        <>
          {/* Ranking de Recrutadores (por Inscritos) */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-neutral-900">
            Ranking de Inscritos
          </h2>
          <span className="text-sm text-neutral-500">(ordenado por aprovados)</span>
        </div>

        {sortedRanking.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-neutral-300" />
            <h3 className="mt-4 text-lg font-medium text-neutral-900">
              Nenhum recrutador encontrado
            </h3>
            <p className="mt-2 text-sm text-neutral-500">
              Ainda não há inscritos neste treinamento.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {sortedRanking.map((r, index) => (
              <div
                key={r.recrutadorCodigo}
                className="flex items-center gap-4 px-6 py-4 transition hover:bg-neutral-50"
              >
                {/* Posição */}
                <div className="flex h-10 w-10 items-center justify-center">
                  {index < 3 ? (
                    <Medal className={`h-6 w-6 ${getMedalColor(index)}`} />
                  ) : (
                    <span className="text-lg font-bold text-neutral-400">
                      {index + 1}º
                    </span>
                  )}
                </div>

                {/* Nome */}
                <div className="flex-1">
                  <p className="font-medium text-neutral-900">{r.recrutadorNome}</p>
                  <p className="text-xs text-neutral-500">
                    Código: {r.recrutadorCodigo}
                  </p>
                </div>

                {/* Estatísticas */}
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600">
                      {r.totalAprovados}
                    </p>
                    <p className="text-xs text-neutral-500">Aprovados</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-neutral-900">
                      {r.totalInscritos}
                    </p>
                    <p className="text-xs text-neutral-500">Inscritos</p>
                  </div>
                  <div className="text-center">
                    <p
                      className={`text-lg font-bold ${
                        r.percentualAprovacao >= 70
                          ? "text-emerald-600"
                          : r.percentualAprovacao >= 40
                            ? "text-amber-500"
                            : "text-red-500"
                      }`}
                    >
                      {r.percentualAprovacao}%
                    </p>
                    <p className="text-xs text-neutral-500">Taxa</p>
                  </div>
                </div>

                {/* Link para detalhes */}
                <Link
                  href={`/recrutadores/${r.recrutadorCodigo}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 transition hover:bg-neutral-100"
                >
                  <ChevronRight className="h-4 w-4 text-neutral-500" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ranking de Presenças (participantes do encontro) */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
          <Calendar className="h-5 w-5 text-emerald-500" />
          <h2 className="text-lg font-semibold text-neutral-900">
            Ranking de Presenças
          </h2>
          <span className="text-sm text-neutral-500">(quem participou do encontro)</span>
        </div>

        {presenceRanking.length === 0 ? (
          <div className="py-12 text-center">
            <UserCheck className="mx-auto h-12 w-12 text-neutral-300" />
            <h3 className="mt-4 text-lg font-medium text-neutral-900">
              Nenhuma presença confirmada
            </h3>
            <p className="mt-2 text-sm text-neutral-500">
              Ainda não há presenças validadas neste treinamento.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {presenceRanking.map((r, index) => (
              <div
                key={r.recrutadorCodigo}
                className="flex items-center gap-4 px-6 py-4 transition hover:bg-neutral-50"
              >
                {/* Posição */}
                <div className="flex h-10 w-10 items-center justify-center">
                  {index < 3 ? (
                    <Medal className={`h-6 w-6 ${getMedalColor(index)}`} />
                  ) : (
                    <span className="text-lg font-bold text-neutral-400">
                      {index + 1}º
                    </span>
                  )}
                </div>

                {/* Nome */}
                <div className="flex-1">
                  <p className="font-medium text-neutral-900">{r.recrutadorNome}</p>
                  <p className="text-xs text-neutral-500">
                    Código: {r.recrutadorCodigo}
                  </p>
                </div>

                {/* Estatísticas */}
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600">
                      {r.totalAprovados}
                    </p>
                    <p className="text-xs text-neutral-500">Aprovados</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-neutral-900">
                      {r.totalPresentes}
                    </p>
                    <p className="text-xs text-neutral-500">Presentes</p>
                  </div>
                </div>

                {/* Link para detalhes */}
                <Link
                  href={`/recrutadores/${r.recrutadorCodigo}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 transition hover:bg-neutral-100"
                >
                  <ChevronRight className="h-4 w-4 text-neutral-500" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Links para visualização no CRM */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/crm?treinamento=${encodeURIComponent(treinamentoId)}`}
          className="flex flex-1 items-center justify-between rounded-2xl border border-neutral-200 bg-white px-6 py-4 shadow-sm transition hover:border-cyan-300 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-cyan-500" />
            <span className="font-medium text-neutral-900">
              Ver todos os inscritos
            </span>
          </div>
          <ChevronRight className="h-5 w-5 text-neutral-400" />
        </Link>
        <Link
          href={`/crm?treinamento=${encodeURIComponent(treinamentoId)}&presenca=aprovada`}
          className="flex flex-1 items-center justify-between rounded-2xl border border-neutral-200 bg-white px-6 py-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <UserCheck className="h-5 w-5 text-emerald-500" />
            <span className="font-medium text-neutral-900">
              Ver inscritos presentes
            </span>
          </div>
          <ChevronRight className="h-5 w-5 text-neutral-400" />
        </Link>
      </div>
        </>
      )}

      {/* =================== TAB: Presenças Detalhadas =================== */}
      {activeTab === "detalhes" && (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
            <Calendar className="h-5 w-5 text-[#2DBDC2]" />
            <h2 className="text-lg font-semibold text-neutral-900">
              Presenças Detalhadas
            </h2>
            <span className="text-sm text-neutral-500">
              ({filteredPresences.length} de {presences.length}{presences.length === 1 ? " participante" : " participantes"})
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  const printUrl = `/api/presence/print?treinamento=${encodeURIComponent(treinamentoId)}&groupBy=recrutador`;
                  window.open(printUrl, "_blank");
                }}
                className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-100 hover:border-violet-300"
              >
                👥 Pré-PDF (por Recrutador)
              </button>
              <button
                onClick={() => handlePrintPdf("detalhes")}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 hover:border-[#2DBDC2] hover:text-[#2DBDC2]"
              >
                <FileDown className="h-4 w-4" />
                Gerar PDF
              </button>
            </div>
          </div>

          {filteredPresences.length === 0 ? (
            <div className="py-12 text-center">
              <UserCheck className="mx-auto h-12 w-12 text-neutral-300" />
              <h3 className="mt-4 text-lg font-medium text-neutral-900">
                {presences.length === 0
                  ? "Nenhuma presença confirmada"
                  : "Nenhum resultado encontrado"}
              </h3>
              <p className="mt-2 text-sm text-neutral-500">
                {presences.length === 0
                  ? "Ainda não há presenças validadas neste treinamento."
                  : "Tente buscar por outro termo."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/50">
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Nome</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Telefone</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Nome Zoom</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Recrutador</th>
                    {hasMultiDay ? (
                      <>
                        <th className="px-4 py-3 text-center font-medium text-neutral-600">Dia 1</th>
                        <th className="px-4 py-3 text-center font-medium text-neutral-600">Dia 2</th>
                      </>
                    ) : (
                      <th className="px-4 py-3 text-center font-medium text-neutral-600">Tempo</th>
                    )}
                    <th className="px-4 py-3 text-center font-medium text-neutral-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredPresences.map((p) => {
                    const isPartial = p.totalDias === 2 && p.diaProcessado < 2;
                    return (
                      <tr
                        key={p.inscricaoId}
                        className="transition hover:bg-neutral-50"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-neutral-900">{p.nome}</p>
                            {p.cidade && (
                              <p className="text-xs text-neutral-500">{p.cidade}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-neutral-700 text-xs">
                            {p.telefone || (
                              <span className="text-neutral-400 italic">—</span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-neutral-700">
                            {p.participanteNomeZoom || (
                              <span className="text-neutral-400 italic">—</span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {p.recrutadorNome ? (
                            <div>
                              <p className="text-neutral-700">{p.recrutadorNome}</p>
                              <p className="text-xs text-neutral-400">{p.recrutadorCodigo}</p>
                            </div>
                          ) : (
                            <span className="text-neutral-400 italic">—</span>
                          )}
                        </td>
                        {hasMultiDay ? (
                          <>
                            {/* Dia 1 */}
                            <td className="px-4 py-3 text-center">
                              {p.dia1Aprovado === true ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                                  {p.dia1Tempo != null && (
                                    <span className="text-xs text-neutral-500">{formatMinutes(p.dia1Tempo)}</span>
                                  )}
                                </div>
                              ) : p.dia1Aprovado === false ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <XCircle className="h-5 w-5 text-red-500" />
                                  {p.dia1Tempo != null && (
                                    <span className="text-xs text-neutral-500">{formatMinutes(p.dia1Tempo)}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                                  <Clock className="h-4 w-4" />
                                  Pendente
                                </span>
                              )}
                            </td>
                            {/* Dia 2 */}
                            <td className="px-4 py-3 text-center">
                              {p.dia2Aprovado === true ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                                  {p.dia2Tempo != null && (
                                    <span className="text-xs text-neutral-500">{formatMinutes(p.dia2Tempo)}</span>
                                  )}
                                </div>
                              ) : p.dia2Aprovado === false ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <XCircle className="h-5 w-5 text-red-500" />
                                  {p.dia2Tempo != null && (
                                    <span className="text-xs text-neutral-500">{formatMinutes(p.dia2Tempo)}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                                  <Clock className="h-4 w-4" />
                                  Pendente
                                </span>
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="px-4 py-3 text-center">
                            <span className="text-neutral-700">{formatMinutes(p.tempoTotalMinutos)}</span>
                          </td>
                        )}
                        <td className="px-4 py-3 text-center">
                          {p.aprovado ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              <CheckCircle className="h-3.5 w-3.5" />
                              Aprovado
                            </span>
                          ) : isPartial ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                              <Clock className="h-3.5 w-3.5" />
                              Parcial
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                              <XCircle className="h-3.5 w-3.5" />
                              Reprovado
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =================== TAB: Não Associados =================== */}
      {activeTab === "nao-associados" && (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-neutral-900">
              Participantes Não Associados
            </h2>
            <span className="text-sm text-neutral-500">
              ({filteredPending.length} de {pending.length} {pending.length === 1 ? "participante" : "participantes"} do Zoom sem associação)
            </span>
            {pending.length > 0 && (
              <div className="ml-auto">
                <button
                  onClick={() => handlePrintPdf("nao-associados")}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 hover:border-[#2DBDC2] hover:text-[#2DBDC2]"
                >
                  <FileDown className="h-4 w-4" />
                  Gerar PDF
                </button>
              </div>
            )}
          </div>

          {filteredPending.length === 0 ? (
            <div className="py-12 text-center">
              {pending.length === 0 ? (
                <>
                  <UserCheck className="mx-auto h-12 w-12 text-emerald-300" />
                  <h3 className="mt-4 text-lg font-medium text-neutral-900">
                    Todos associados!
                  </h3>
                  <p className="mt-2 text-sm text-neutral-500">
                    Todos os participantes do Zoom foram associados a inscrições.
                  </p>
                </>
              ) : (
                <>
                  <Search className="mx-auto h-12 w-12 text-neutral-300" />
                  <h3 className="mt-4 text-lg font-medium text-neutral-900">
                    Nenhum resultado encontrado
                  </h3>
                  <p className="mt-2 text-sm text-neutral-500">
                    Tente buscar por outro termo.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/50">
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Nome no Zoom</th>
                    <th className="px-4 py-3 text-center font-medium text-neutral-600">Tempo Total</th>
                    <th className="px-4 py-3 text-center font-medium text-neutral-600">Presença</th>
                    <th className="px-4 py-3 text-center font-medium text-neutral-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Sugestões</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredPending.map((p) => (
                    <tr
                      key={p.id}
                      className="transition hover:bg-neutral-50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-neutral-900">{p.participanteNome}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-neutral-700">{formatMinutes(p.tempoTotalMinutos)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.aprovado ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <CheckCircle className="h-4 w-4" />
                            OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-500">
                            <XCircle className="h-4 w-4" />
                            Insuficiente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.status === "not-found" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Não encontrado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                            <HelpCircle className="h-3.5 w-3.5" />
                            Dúvida
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === "doubt" ? (
                          <div className="space-y-1">
                            {p.inscricaoNome1 && (
                              <p className="text-xs text-neutral-600">
                                1. {p.inscricaoNome1}
                                {p.inscricaoId1 && (
                                  <span className="text-neutral-400"> (#{p.inscricaoId1})</span>
                                )}
                              </p>
                            )}
                            {p.inscricaoNome2 && (
                              <p className="text-xs text-neutral-600">
                                2. {p.inscricaoNome2}
                                {p.inscricaoId2 && (
                                  <span className="text-neutral-400"> (#{p.inscricaoId2})</span>
                                )}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400 italic">
                            Sem sugestões
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pending.length > 0 && (
            <div className="border-t border-neutral-100 px-6 py-3">
              <p className="text-xs text-neutral-500">
                Estes participantes do Zoom não puderam ser associados automaticamente a nenhuma inscrição.
                Você pode resolvê-los na página de{" "}
                <Link
                  href={`/presenca/confirmados?treinamento=${encodeURIComponent(treinamentoId)}`}
                  className="text-cyan-600 hover:underline"
                >
                  Presenças Confirmadas
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      )}

      {/* =================== TAB: Relatório Completo =================== */}
      {activeTab === "relatorio" && (
        <>
          {/* Botão PDF para relatório completo */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Visão unificada de presenças detalhadas e participantes não associados.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const printUrl = `/api/presence/print?treinamento=${encodeURIComponent(treinamentoId)}&groupBy=recrutador`;
                  window.open(printUrl, "_blank");
                }}
                className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 shadow-sm transition hover:bg-violet-100 hover:border-violet-300"
              >
                👥 Pré-PDF (por Recrutador)
              </button>
              <button
                onClick={() => handlePrintPdf("all")}
                className="flex items-center gap-2 rounded-xl bg-[#2DBDC2] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#1a9a9e]"
              >
                <FileDown className="h-4 w-4" />
                Gerar PDF Completo
              </button>
            </div>
          </div>

          {/* Seção Presenças Detalhadas */}
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
              <Calendar className="h-5 w-5 text-[#2DBDC2]" />
              <h2 className="text-lg font-semibold text-neutral-900">
                Presenças Detalhadas
              </h2>
              <span className="text-sm text-neutral-500">
                ({filteredPresences.length} de {presences.length}{presences.length === 1 ? " participante" : " participantes"})
              </span>
            </div>

            {filteredPresences.length === 0 ? (
              <div className="py-12 text-center">
                <UserCheck className="mx-auto h-12 w-12 text-neutral-300" />
                <h3 className="mt-4 text-lg font-medium text-neutral-900">
                  {presences.length === 0
                    ? "Nenhuma presença confirmada"
                    : "Nenhum resultado encontrado"}
                </h3>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/50">
                      <th className="px-4 py-3 text-left font-medium text-neutral-600">Nome</th>
                      <th className="px-4 py-3 text-left font-medium text-neutral-600">Telefone</th>
                      <th className="px-4 py-3 text-left font-medium text-neutral-600">Nome Zoom</th>
                      <th className="px-4 py-3 text-left font-medium text-neutral-600">Recrutador</th>
                      {hasMultiDay ? (
                        <>
                          <th className="px-4 py-3 text-center font-medium text-neutral-600">Dia 1</th>
                          <th className="px-4 py-3 text-center font-medium text-neutral-600">Dia 2</th>
                        </>
                      ) : (
                        <th className="px-4 py-3 text-center font-medium text-neutral-600">Tempo</th>
                      )}
                      <th className="px-4 py-3 text-center font-medium text-neutral-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredPresences.map((p) => {
                      const isPartial = p.totalDias === 2 && p.diaProcessado < 2;
                      return (
                        <tr key={p.inscricaoId} className="transition hover:bg-neutral-50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-neutral-900">{p.nome}</p>
                              {p.cidade && <p className="text-xs text-neutral-500">{p.cidade}</p>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-neutral-700 text-xs">
                              {p.telefone || <span className="text-neutral-400 italic">—</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-neutral-700">
                              {p.participanteNomeZoom || <span className="text-neutral-400 italic">—</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            {p.recrutadorNome ? (
                              <div>
                                <p className="text-neutral-700">{p.recrutadorNome}</p>
                                <p className="text-xs text-neutral-400">{p.recrutadorCodigo}</p>
                              </div>
                            ) : (
                              <span className="text-neutral-400 italic">—</span>
                            )}
                          </td>
                          {hasMultiDay ? (
                            <>
                              <td className="px-4 py-3 text-center">
                                {p.dia1Aprovado === true ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                                    {p.dia1Tempo != null && <span className="text-xs text-neutral-500">{formatMinutes(p.dia1Tempo)}</span>}
                                  </div>
                                ) : p.dia1Aprovado === false ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <XCircle className="h-5 w-5 text-red-500" />
                                    {p.dia1Tempo != null && <span className="text-xs text-neutral-500">{formatMinutes(p.dia1Tempo)}</span>}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                                    <Clock className="h-4 w-4" /> Pendente
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {p.dia2Aprovado === true ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                                    {p.dia2Tempo != null && <span className="text-xs text-neutral-500">{formatMinutes(p.dia2Tempo)}</span>}
                                  </div>
                                ) : p.dia2Aprovado === false ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <XCircle className="h-5 w-5 text-red-500" />
                                    {p.dia2Tempo != null && <span className="text-xs text-neutral-500">{formatMinutes(p.dia2Tempo)}</span>}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                                    <Clock className="h-4 w-4" /> Pendente
                                  </span>
                                )}
                              </td>
                            </>
                          ) : (
                            <td className="px-4 py-3 text-center">
                              <span className="text-neutral-700">{formatMinutes(p.tempoTotalMinutos)}</span>
                            </td>
                          )}
                          <td className="px-4 py-3 text-center">
                            {p.aprovado ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                <CheckCircle className="h-3.5 w-3.5" /> Aprovado
                              </span>
                            ) : isPartial ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                                <Clock className="h-3.5 w-3.5" /> Parcial
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                                <XCircle className="h-3.5 w-3.5" /> Reprovado
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Seção Não Associados */}
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-neutral-900">
                Participantes Não Associados
              </h2>
              <span className="text-sm text-neutral-500">
                ({filteredPending.length} {filteredPending.length === 1 ? "participante" : "participantes"})
              </span>
            </div>

            {filteredPending.length === 0 ? (
              <div className="py-8 text-center">
                <UserCheck className="mx-auto h-10 w-10 text-emerald-300" />
                <h3 className="mt-3 text-base font-medium text-neutral-900">
                  {pending.length === 0 ? "Todos associados!" : "Nenhum resultado encontrado"}
                </h3>
                {pending.length === 0 && (
                  <p className="mt-1 text-sm text-neutral-500">
                    Todos os participantes do Zoom foram associados a inscrições.
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/50">
                      <th className="px-4 py-3 text-left font-medium text-neutral-600">Nome no Zoom</th>
                      <th className="px-4 py-3 text-center font-medium text-neutral-600">Tempo Total</th>
                      <th className="px-4 py-3 text-center font-medium text-neutral-600">Presença</th>
                      <th className="px-4 py-3 text-center font-medium text-neutral-600">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-neutral-600">Sugestões</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredPending.map((p) => (
                      <tr key={p.id} className="transition hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-900">{p.participanteNome}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-neutral-700">{formatMinutes(p.tempoTotalMinutos)}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {p.aprovado ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CheckCircle className="h-4 w-4" /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-500">
                              <XCircle className="h-4 w-4" /> Insuficiente
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {p.status === "not-found" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                              <AlertTriangle className="h-3.5 w-3.5" /> Não encontrado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                              <HelpCircle className="h-3.5 w-3.5" /> Dúvida
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {p.status === "doubt" ? (
                            <div className="space-y-1">
                              {p.inscricaoNome1 && (
                                <p className="text-xs text-neutral-600">
                                  1. {p.inscricaoNome1}
                                  {p.inscricaoId1 && <span className="text-neutral-400"> (#{p.inscricaoId1})</span>}
                                </p>
                              )}
                              {p.inscricaoNome2 && (
                                <p className="text-xs text-neutral-600">
                                  2. {p.inscricaoNome2}
                                  {p.inscricaoId2 && <span className="text-neutral-400"> (#{p.inscricaoId2})</span>}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-400 italic">Sem sugestões</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
