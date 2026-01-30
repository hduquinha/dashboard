import type { Metadata } from "next";
import Link from "next/link";
import { listTrainingsWithStats } from "@/lib/db";
import { Calendar, Users, UserPlus, TrendingUp, ArrowRight, Trophy, UserCheck } from "lucide-react";
import { formatTrainingDateLabel } from "@/lib/trainings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Treinamentos",
  description: "Gerencie treinamentos e visualize inscritos por data.",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Sem data";
  
  const formatted = formatTrainingDateLabel(dateStr);
  if (formatted) return formatted;
  
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function TreinamentosPage() {
  const trainings = await listTrainingsWithStats();
  
  const totalInscritos = trainings.reduce((acc, t) => acc + t.totalInscritos, 0);
  const totalPresentes = trainings.reduce((acc, t) => acc + t.presentes, 0);
  const totalLast24h = trainings.reduce((acc, t) => acc + t.last24h, 0);
  const totalRecrutadores = trainings.reduce((acc, t) => acc + t.recrutadores, 0);

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Treinamentos</h1>
          <p className="text-sm text-neutral-500">
            Visualize e gerencie todos os treinamentos com seus inscritos organizados por data.
          </p>
        </div>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2DBDC2]/10">
            <Calendar className="h-6 w-6 text-[#2DBDC2]" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Treinamentos</p>
            <p className="text-2xl font-bold text-neutral-900">{trainings.length}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
            <Users className="h-6 w-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Total Inscritos</p>
            <p className="text-2xl font-bold text-neutral-900">{totalInscritos.toLocaleString()}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50">
            <UserCheck className="h-6 w-6 text-cyan-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Presentes</p>
            <p className="text-2xl font-bold text-cyan-600">{totalPresentes.toLocaleString()}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50">
            <UserPlus className="h-6 w-6 text-purple-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Recrutadores</p>
            <p className="text-2xl font-bold text-neutral-900">{totalRecrutadores.toLocaleString()}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
            <TrendingUp className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Últimas 24h</p>
            <p className="text-2xl font-bold text-neutral-900">{totalLast24h.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Trainings Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {trainings.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-neutral-200 bg-white p-8 text-center">
            <Calendar className="mx-auto h-12 w-12 text-neutral-300" />
            <h3 className="mt-4 text-lg font-medium text-neutral-900">Nenhum treinamento encontrado</h3>
            <p className="mt-2 text-sm text-neutral-500">
              Os treinamentos serão criados automaticamente quando inscritos forem registrados.
            </p>
          </div>
        ) : (
          trainings.map((training) => (
            <div
              key={training.id}
              className="group rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:border-cyan-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-neutral-900 line-clamp-2">
                    {training.label}
                  </h3>
                  {training.startsAt && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-neutral-500">
                      <Calendar className="h-4 w-4" />
                      {formatDate(training.startsAt)}
                    </p>
                  )}
                </div>
                {training.last24h > 0 && (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    +{training.last24h} hoje
                  </span>
                )}
              </div>
              
              <div className="mt-4 grid grid-cols-3 gap-4 border-t border-neutral-100 pt-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-neutral-900">{training.totalInscritos}</p>
                  <p className="text-xs text-neutral-500">Inscritos</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-cyan-600">{training.presentes}</p>
                  <p className="text-xs text-neutral-500">Presentes</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-600">{training.recrutadores}</p>
                  <p className="text-xs text-neutral-500">Recrutadores</p>
                </div>
              </div>
              
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex gap-2">
                  <Link
                    href={`/treinamentos/${encodeURIComponent(training.id)}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#2DBDC2] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#26a8ad]"
                  >
                    <Trophy className="h-4 w-4" />
                    Ranking
                  </Link>
                  <Link
                    href={`/crm?treinamento=${encodeURIComponent(training.id)}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
                  >
                    Ver inscritos
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                {training.presentes > 0 && (
                  <Link
                    href={`/crm?treinamento=${encodeURIComponent(training.id)}&presenca=aprovada`}
                    className="flex items-center justify-center gap-2 rounded-xl bg-cyan-50 px-4 py-2.5 text-sm font-medium text-cyan-700 transition hover:bg-cyan-100"
                  >
                    <UserCheck className="h-4 w-4" />
                    Ver presentes ({training.presentes})
                  </Link>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
