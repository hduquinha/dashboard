"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Trophy,
  Users,
  UserCheck,
  Percent,
  Medal,
  ChevronRight,
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
  treinamentoId: string;
  recrutadorNome: string | null;
  aprovado: boolean;
  tempoTotalMinutos: number;
}

interface TrainingDetailsClientProps {
  treinamentoId: string;
}

export default function TrainingDetailsClient({
  treinamentoId,
}: TrainingDetailsClientProps) {
  const [ranking, setRanking] = useState<RecruiterRanking[]>([]);
  const [presences, setPresences] = useState<PresenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [rankingRes, presencesRes] = await Promise.all([
          fetch(`/api/trainings/${encodeURIComponent(treinamentoId)}/recruiters`),
          fetch(`/api/presence/list?treinamento=${encodeURIComponent(treinamentoId)}&aprovados=false`),
        ]);

        if (!rankingRes.ok || !presencesRes.ok) {
          throw new Error("Falha ao carregar dados");
        }

        const rankingData = await rankingRes.json();
        const presencesData = await presencesRes.json();

        setRanking(rankingData.ranking || []);
        setPresences(presencesData.presences || []);
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
  const totalReprovados = presences.filter((p) => !p.aprovado).length;

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
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{treinamentoId}</h1>
          <p className="text-sm text-neutral-500">
            Ranking de recrutadores e presenças confirmadas
          </p>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
            <Percent className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Reprovados</p>
            <p className="text-2xl font-bold text-red-600">{totalReprovados}</p>
          </div>
        </div>
      </div>

      {/* Ranking de Recrutadores */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-4">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-neutral-900">
            Ranking de Recrutadores
          </h2>
        </div>

        {ranking.length === 0 ? (
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
            {ranking.map((r, index) => (
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
                    <p className="text-lg font-bold text-neutral-900">
                      {r.totalInscritos}
                    </p>
                    <p className="text-xs text-neutral-500">Inscritos</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600">
                      {r.totalAprovados}
                    </p>
                    <p className="text-xs text-neutral-500">Aprovados</p>
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

      {/* Link para presenças confirmadas */}
      <Link
        href={`/presenca/confirmados?treinamento=${encodeURIComponent(treinamentoId)}`}
        className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-6 py-4 shadow-sm transition hover:border-cyan-300 hover:shadow-md"
      >
        <div className="flex items-center gap-3">
          <UserCheck className="h-5 w-5 text-emerald-500" />
          <span className="font-medium text-neutral-900">
            Ver todas as presenças confirmadas
          </span>
        </div>
        <ChevronRight className="h-5 w-5 text-neutral-400" />
      </Link>
    </main>
  );
}
