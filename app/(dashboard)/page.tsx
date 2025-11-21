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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Painel</p>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold text-neutral-900">Central do treinamento</h1>
                  <p className="text-sm text-neutral-600">
                    Monitore o desempenho do {heroLabel.toLowerCase()} e acione o time rapidamente com atalhos do CRM.
                  </p>
                </div>
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">
                  <span>Treinamento atual</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-neutral-900">{heroLabel}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={nextCtaHref}
                  className="inline-flex items-center rounded-2xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-800 transition hover:border-neutral-500"
                >
                  Ver CRM completo
                </Link>
                <Link
                  href="/importar"
                  className="inline-flex items-center rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-neutral-800"
                >
                  Importar novas inscrições
                </Link>
              </div>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="rounded-xl border border-neutral-100 bg-neutral-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Selecionar treinamento</p>
                <p className="text-sm text-neutral-600">Aplique o filtro para alinhar indicadores e atalhos.</p>
                <div className="mt-4 max-w-sm">
                  <TrainingSwitcher options={switcherOptions} selectedId={selectedTrainingId} />
                </div>
              </div>
              <div className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Atalhos rápidos</p>
                <ul className="mt-3 space-y-2 text-sm text-neutral-700">
                  <li className="flex items-center justify-between gap-4">
                    <span>Revisar possíveis duplicados</span>
                    <Link href="/duplicados" className="text-xs font-semibold text-neutral-900 underline-offset-2 hover:underline">
                      Abrir
                    </Link>
                  </li>
                  <li className="flex items-center justify-between gap-4">
                    <span>Diretório de recrutadores</span>
                    <Link href="/recrutadores" className="text-xs font-semibold text-neutral-900 underline-offset-2 hover:underline">
                      Abrir
                    </Link>
                  </li>
                  <li className="flex items-center justify-between gap-4">
                    <span>Rede de contatos</span>
                    <Link href="/rede" className="text-xs font-semibold text-neutral-900 underline-offset-2 hover:underline">
                      Abrir
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-neutral-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-neutral-900">Resumo do treinamento</h2>
              <p className="text-sm text-neutral-600">Indicadores gerais e alertas do período selecionado.</p>
            </div>
            <Link
              href={nextCtaHref}
              className="text-sm font-semibold text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
            >
              Abrir no CRM
            </Link>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Total no treinamento</p>
              <p className="mt-2 text-3xl font-semibold text-neutral-900">{snapshot.total}</p>
            </article>
            <article className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Novos (24h)</p>
              <p className="mt-2 text-3xl font-semibold text-neutral-900">{snapshot.last24h}</p>
            </article>
            <article className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Com indicador</p>
              <p className="mt-2 text-3xl font-semibold text-neutral-900">{snapshot.withIndicator}</p>
            </article>
            <article className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Sem indicador</p>
              <p className="mt-2 text-3xl font-semibold text-neutral-900">{snapshot.withoutIndicator}</p>
            </article>
            <article className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm sm:col-span-2 lg:col-span-2">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500">
                <span>Leads priorizados</span>
                <span className="text-neutral-900">{snapshot.leads}</span>
              </div>
              <p className="mt-4 text-sm text-neutral-600">
                Registros prontos para abordagem imediata com base nos filtros definidos.
              </p>
            </article>
            <article className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm sm:col-span-2 lg:col-span-2">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-rose-600">
                <span>Possíveis duplicados</span>
                <Link href="/duplicados" className="text-[11px] font-semibold text-rose-700 underline-offset-2 hover:underline">
                  Revisar
                </Link>
              </div>
              <p className="mt-2 text-3xl font-semibold text-rose-700">{duplicateSummary.totalGroups}</p>
              <p className="text-xs text-rose-700">Separados por clientId ou telefone repetido.</p>
            </article>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-neutral-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-neutral-900">Últimas inscrições</h2>
              <p className="text-sm text-neutral-600">
                As {Math.min(RECENT_PAGE_SIZE, recentResult.data.length)} inscrições mais recentes deste treinamento.
              </p>
            </div>
            <Link
              href={nextCtaHref}
              className="inline-flex items-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-500"
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
