import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listDuplicateSuspects, listInscricoes, listTrainingFilterOptions } from "@/lib/db";
import { assertToken } from "@/lib/auth";
import DashboardNav from "@/components/DashboardNav";
import InscricoesTable from "@/components/InscricoesTable";
import DuplicateAlerts from "@/components/DuplicateAlerts";
import { listRecruiters } from "@/lib/recruiters";
import type { OrderDirection, OrderableField } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

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

function parseNumberParam(value: string | string[] | undefined, fallback: number): number {
  const raw = pickStringParam(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOrderField(value: string | string[] | undefined): OrderableField {
  const raw = pickStringParam(value);
  if (!raw) {
    return "criado_em";
  }
  const allowed: OrderableField[] = [
    "id",
    "nome",
    "telefone",
    "cidade",
    "treinamento",
    "recrutador",
    "criado_em",
  ];
  return allowed.includes(raw as OrderableField) ? (raw as OrderableField) : "criado_em";
}

function parseDirection(value: string | string[] | undefined): OrderDirection {
  const raw = pickStringParam(value);
  return raw === "asc" ? "asc" : "desc";
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

export default async function DashboardPage(props: DashboardPageProps) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
  } catch {
    redirect("/login");
  }

  const page = parseNumberParam(searchParams?.page, 1);
  const pageSize = Math.min(parseNumberParam(searchParams?.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const orderBy = parseOrderField(searchParams?.orderBy);
  const orderDirection = parseDirection(searchParams?.orderDirection);
  const nome = pickStringParam(searchParams?.nome) ?? "";
  const telefone = pickStringParam(searchParams?.telefone) ?? "";
  const indicacao = pickStringParam(searchParams?.indicacao) ?? "";
  const treinamentoSelecionado = pickStringParam(searchParams?.treinamento) ?? "";

  const recruiterOptions = listRecruiters();

  const [trainingOptions, result, duplicateGroups] = await Promise.all([
    listTrainingFilterOptions(),
    listInscricoes({
      page,
      pageSize,
      orderBy,
      orderDirection,
      filters: {
        nome,
        telefone,
        indicacao,
        treinamento: treinamentoSelecionado,
      },
    }),
    listDuplicateSuspects(),
  ]);

  const indicatorDatalistId = "indicator-options";
  const selectedTrainingOption = treinamentoSelecionado.length
    ? trainingOptions.find((option) => option.id === treinamentoSelecionado)
    : undefined;
  const trainingFilterLabel = selectedTrainingOption
    ? getTrainingDisplayLabel(selectedTrainingOption)
    : formatTrainingDate(treinamentoSelecionado) ?? treinamentoSelecionado;
  const activeFilters = [
    nome ? { label: "Nome", value: nome } : null,
    telefone ? { label: "Telefone", value: telefone } : null,
    indicacao ? { label: "Indicador", value: indicacao } : null,
    treinamentoSelecionado ? { label: "Treinamento", value: trainingFilterLabel } : null,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));
  const activeFiltersCount = activeFilters.length;

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
                Visão geral
              </p>
              <h1 className="text-3xl font-semibold text-neutral-900">Painel de Inscrições</h1>
              <p className="text-sm text-neutral-600">
                Acompanhe em tempo real as inscrições enviadas pelo formulário oficial.
              </p>
            </div>
            <span className="inline-flex items-center justify-center rounded-full bg-neutral-900 px-6 py-2 text-sm font-semibold text-white shadow-lg">
              Total: {result.total}
            </span>
          </div>
          <DashboardNav />
        </header>

        {duplicateGroups.length > 0 ? <DuplicateAlerts groups={duplicateGroups} /> : null}

        <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-neutral-200 bg-neutral-50/60 px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Filtros</h2>
              <p className="text-xs text-neutral-500">
                {activeFiltersCount > 0
                  ? `${activeFiltersCount} filtro${activeFiltersCount > 1 ? "s" : ""} aplicado${
                      activeFiltersCount > 1 ? "s" : ""
                    }.`
                  : "Refine a lista usando os campos disponíveis no menu."}
              </p>
            </div>
            <details className="group relative">
              <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:bg-white/70 hover:text-neutral-900">
                Abrir filtros
                {activeFiltersCount > 0 ? (
                  <span className="inline-flex min-w-[1.75rem] justify-center rounded-full bg-neutral-900 px-2 py-1 text-xs font-semibold text-white">
                    {activeFiltersCount}
                  </span>
                ) : null}
              </summary>
              <div className="absolute right-0 top-full z-20 mt-3 w-[min(90vw,420px)] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl">
                <form className="space-y-4" method="get">
                  <input type="hidden" name="page" value="1" />
                  <input type="hidden" name="pageSize" value={String(pageSize)} />
                  <input type="hidden" name="orderBy" value={orderBy} />
                  <input type="hidden" name="orderDirection" value={orderDirection} />

                  <div className="grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-2 text-sm text-neutral-700">
                      Nome
                      <input
                        id="nome"
                        name="nome"
                        defaultValue={nome}
                        placeholder="Filtrar por nome"
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-neutral-700">
                      Telefone
                      <input
                        id="telefone"
                        name="telefone"
                        defaultValue={telefone}
                        placeholder="Filtrar por telefone"
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-neutral-700">
                      Indicador
                      <input
                        id="indicacao"
                        name="indicacao"
                        defaultValue={indicacao}
                        placeholder="Código ou nome do indicador"
                        list={indicatorDatalistId}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-neutral-700">
                      Treinamento
                      <select
                        id="treinamento"
                        name="treinamento"
                        defaultValue={treinamentoSelecionado}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      >
                        <option value="">Todos</option>
                        {trainingOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {getTrainingDisplayLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <datalist id={indicatorDatalistId}>
                    {recruiterOptions.map((option) => (
                      <option key={`${option.code}-name`} value={option.name}>
                        {option.name} ({option.code})
                      </option>
                    ))}
                    {recruiterOptions.map((option) => (
                      <option key={`${option.code}-code`} value={option.code} />
                    ))}
                  </datalist>

                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href="/"
                      className="text-sm font-semibold text-neutral-500 underline-offset-4 hover:underline"
                    >
                      Limpar filtros
                    </Link>
                    <button
                      type="submit"
                      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
                    >
                      Aplicar filtros
                    </button>
                  </div>
                </form>
              </div>
            </details>
          </div>

          {activeFiltersCount > 0 ? (
            <div className="flex flex-wrap gap-2 px-6 py-4">
              {activeFilters.map((filter) => (
                <span
                  key={`${filter.label}-${filter.value}`}
                  className="inline-flex items-center rounded-full bg-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700"
                >
                  {filter.label}: {filter.value}
                </span>
              ))}
            </div>
          ) : null}

          <div className="px-2 pb-6 sm:px-4">
            <InscricoesTable
              inscricoes={result.data}
              page={page}
              pageSize={pageSize}
              total={result.total}
              orderBy={orderBy}
              orderDirection={orderDirection}
              trainingOptions={trainingOptions}
              recruiterOptions={recruiterOptions}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
