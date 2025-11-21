import type { Metadata } from "next";
import Link from "next/link";
import RecentInscricoesTable from "@/components/RecentInscricoesTable";
import TrainingSwitcher from "@/components/TrainingSwitcher";
import {
  getTrainingSnapshot,
  listDuplicateSuspects,
  listInscricoes,
  listTrainingFilterOptions,
} from "@/lib/db";
import type { DuplicateSummary, ListInscricoesResult } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";

export const dynamic = "force-dynamic";

const RECENT_PAGE_SIZE = 15;

interface DashboardPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pickStringParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function formatTrainingDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getTrainingDisplayLabel(option: TrainingOption): string {
  return (
    formatTrainingDate(option.startsAt) ??
    formatTrainingDate(option.id) ??
    formatTrainingDate(option.label) ??
    option.label ??
    option.id
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Painel de Inscrições",
    description: "Monitore as inscrições registradas pelo formulário de marketing multinível.",
  };
}

const EMPTY_SNAPSHOT = {
  total: 0,
  leads: 0,
  recruiters: 0,
  withIndicator: 0,
  withoutIndicator: 0,
  last24h: 0,
};

const EMPTY_RECENT: ListInscricoesResult = {
  data: [],
  page: 1,
  pageSize: RECENT_PAGE_SIZE,
  total: 0,
};

const EMPTY_DUPLICATES: DuplicateSummary = {
  groups: [],
  totalGroups: 0,
};

export default async function DashboardPage(props: DashboardPageProps) {
  const searchParams = await props.searchParams;
  const treinamentoSelecionado = pickStringParam(searchParams?.treinamento) ?? "";

  let trainingOptions: TrainingOption[] = [];
  try {
    trainingOptions = await listTrainingFilterOptions();
  } catch (error) {
    console.error("Failed to load training options", error);
  }

  function resolveDefaultTraining(): TrainingOption | undefined {
    if (!trainingOptions.length) {
      return undefined;
    }
    const withOrder = trainingOptions
      .map((option) => {
        const candidates = [option.startsAt, option.label, option.id];
        const timestamps = candidates
          .map((candidate) => (candidate ? Date.parse(candidate) : Number.NaN))
          .filter((value) => Number.isFinite(value)) as number[];
        const best = timestamps.length ? Math.max(...timestamps) : Number.NEGATIVE_INFINITY;
        return { option, score: best };
      })
      .sort((a, b) => b.score - a.score);
    return withOrder[0]?.option ?? trainingOptions[0];
  }

  const selectedTrainingOption = trainingOptions.find((option) => option.id === treinamentoSelecionado) ?? resolveDefaultTraining();
  const selectedTrainingId = selectedTrainingOption?.id ?? "";

  let snapshot = EMPTY_SNAPSHOT;
  let recentResult: ListInscricoesResult = EMPTY_RECENT;
  let duplicateSummary: DuplicateSummary = EMPTY_DUPLICATES;

  try {
    const [snapshotData, recentData, duplicateData] = await Promise.all([
      getTrainingSnapshot({ treinamentoId: selectedTrainingId || undefined }),
      listInscricoes({
        page: 1,
        pageSize: RECENT_PAGE_SIZE,
        orderBy: "criado_em",
        orderDirection: "desc",
        filters: {
          nome: "",
          telefone: "",
          indicacao: "",
          treinamento: selectedTrainingId,
        },
      }),
      listDuplicateSuspects({ maxGroups: 1 }),
    ]);

    snapshot = snapshotData;
    recentResult = recentData;
    duplicateSummary = duplicateData;
  } catch (error) {
    console.error("Failed to load dashboard metrics", error);
  }

  const heroLabel = selectedTrainingOption ? getTrainingDisplayLabel(selectedTrainingOption) : "Visão geral";
  const switcherOptions = trainingOptions.length
    ? trainingOptions
    : [{ id: "", label: "Todos os treinamentos" } satisfies TrainingOption];

  const nextCtaHref = selectedTrainingId ? `/crm?treinamento=${encodeURIComponent(selectedTrainingId)}` : "/crm";

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-500">Treinamento atual</p>
              <h1 className="text-3xl font-semibold text-neutral-900">{heroLabel}</h1>
              <p className="text-sm text-neutral-600">
                Acompanhe o desempenho do treinamento em tempo real e compartilhe os resultados com o time.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={nextCtaHref}
                className="inline-flex items-center justify-center rounded-2xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-sky-500"
              >
                Abrir CRM completo
              </Link>
              <Link
                href="/importar"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Importar planilha
              </Link>
            </div>
          </div>
          <div className="mt-4 max-w-xs">
            <TrainingSwitcher options={switcherOptions} selectedId={selectedTrainingId} />
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Total no treinamento</p>
            <p className="mt-2 text-3xl font-semibold text-neutral-900">{snapshot.total}</p>
          </article>
          <article className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Novos (24h)</p>
            <p className="mt-2 text-3xl font-semibold text-neutral-900">{snapshot.last24h}</p>
          </article>
          <article className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Sem indicador</p>
            <p className="mt-2 text-3xl font-semibold text-amber-600">{snapshot.withoutIndicator}</p>
          </article>
          <article className="rounded-3xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-rose-600">
              <span>Possíveis duplicados</span>
              <Link href="/duplicados" className="text-[11px] font-semibold text-rose-700 underline-offset-2 hover:underline">
                Revisar
              </Link>
            </div>
            <p className="mt-2 text-3xl font-semibold text-rose-700">{duplicateSummary.totalGroups}</p>
          </article>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-neutral-900">Últimas inscrições</h2>
              <p className="text-sm text-neutral-600">As {Math.min(RECENT_PAGE_SIZE, recentResult.data.length)} inscrições mais recentes deste treinamento.</p>
            </div>
            <Link
              href={nextCtaHref}
              className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              Ver tudo no CRM
            </Link>
          </div>
          <RecentInscricoesTable inscricoes={recentResult.data} />
        </section>
      </div>
    </main>
  );
}
