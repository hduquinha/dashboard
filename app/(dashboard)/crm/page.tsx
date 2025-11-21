import type { Metadata } from "next";
import Link from "next/link";
import InscricoesTable from "@/components/InscricoesTable";
import { listInscricoes, listTrainingFilterOptions } from "@/lib/db";
import { listRecruiters } from "@/lib/recruiters";
import type { OrderDirection, OrderableField } from "@/types/inscricao";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

interface CrmPageProps {
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
    "profissao",
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

function buildExportUrl(params: URLSearchParams): string {
  const query = params.toString();
  return query.length ? `/api/export?${query}` : "/api/export";
}

export const metadata: Metadata = {
  title: "CRM de Inscrições",
  description: "Gerencie toda a base com filtros avançados e exportação completa.",
};

export default async function CrmPage(props: CrmPageProps) {
  const searchParams = await props.searchParams;
  const page = parseNumberParam(searchParams?.page, 1);
  const pageSize = Math.min(parseNumberParam(searchParams?.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const orderBy = parseOrderField(searchParams?.orderBy);
  const orderDirection = parseDirection(searchParams?.orderDirection);
  const nome = pickStringParam(searchParams?.nome) ?? "";
  const telefone = pickStringParam(searchParams?.telefone) ?? "";
  const indicacao = pickStringParam(searchParams?.indicacao) ?? "";
  const treinamentoSelecionado = pickStringParam(searchParams?.treinamento) ?? "";

  const recruiterOptions = listRecruiters();
  const [trainingOptions, result] = await Promise.all([
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
  ]);

  const indicatorDatalistId = "indicator-options";
  const selectedTrainingOption = treinamentoSelecionado.length
    ? trainingOptions.find((option) => option.id === treinamentoSelecionado)
    : undefined;
  const trainingFilterLabel = selectedTrainingOption
    ? selectedTrainingOption.label ?? selectedTrainingOption.id
    : treinamentoSelecionado;
  const activeFilters = [
    nome ? { label: "Nome", value: nome } : null,
    telefone ? { label: "Telefone", value: telefone } : null,
    indicacao ? { label: "Indicador", value: indicacao } : null,
    treinamentoSelecionado ? { label: "Treinamento", value: trainingFilterLabel } : null,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));
  const activeFiltersCount = activeFilters.length;

  const paramsForExport = new URLSearchParams();
  if (nome) paramsForExport.set("nome", nome);
  if (telefone) paramsForExport.set("telefone", telefone);
  if (indicacao) paramsForExport.set("indicacao", indicacao);
  if (treinamentoSelecionado) paramsForExport.set("treinamento", treinamentoSelecionado);
  paramsForExport.set("orderBy", orderBy);
  paramsForExport.set("orderDirection", orderDirection);
  const exportUrl = buildExportUrl(paramsForExport);

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">CRM</p>
              <h1 className="text-3xl font-semibold text-neutral-900">Base completa de inscrições</h1>
              <p className="text-sm text-neutral-600">
                Utilize filtros avançados, exporte planilhas e revise cada inscrição com detalhes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={exportUrl}
                className="inline-flex items-center rounded-2xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-800 transition hover:border-neutral-500"
              >
                Exportar CSV
              </Link>
              <Link
                href="/importar"
                className="inline-flex items-center rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-neutral-800"
              >
                Importar novas inscrições
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="space-y-3 border-b border-neutral-200 bg-neutral-50/60 px-6 py-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Filtros</h2>
                <p className="text-xs text-neutral-500">
                  {activeFiltersCount > 0
                    ? `${activeFiltersCount} filtro${activeFiltersCount > 1 ? "s" : ""} aplicado${
                        activeFiltersCount > 1 ? "s" : ""
                      }.`
                    : "Refine a lista usando os campos disponíveis."}
                </p>
              </div>
              {activeFiltersCount > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {activeFilters.map((filter) => (
                    <span
                      key={`${filter.label}-${filter.value}`}
                      className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-sm"
                    >
                      {filter.label}: <span className="ml-1 text-neutral-900">{filter.value}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <details className="group" data-filter-state={activeFiltersCount > 0 ? "active" : "idle"}>
              <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:bg-white/70 hover:text-neutral-900">
                Abrir filtros
                {activeFiltersCount > 0 ? (
                  <span className="inline-flex min-w-[1.75rem] justify-center rounded-full bg-neutral-900 px-2 py-1 text-xs font-semibold text-white">
                    {activeFiltersCount}
                  </span>
                ) : null}
                <span className="text-xs font-normal text-neutral-500">(mantém preferências atuais)</span>
              </summary>
              <div className="border-t border-neutral-200 px-2 py-4 sm:px-4">
                <form method="get" className="space-y-4">
                  <input type="hidden" name="orderBy" value={orderBy} />
                  <input type="hidden" name="orderDirection" value={orderDirection} />
                  <input type="hidden" name="pageSize" value={String(pageSize)} />
                  <input type="hidden" name="page" value="1" />

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700">
                      Nome
                      <input
                        type="text"
                        name="nome"
                        defaultValue={nome}
                        placeholder="Ex.: Maria Silva"
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700">
                      Telefone
                      <input
                        type="tel"
                        name="telefone"
                        defaultValue={telefone}
                        placeholder="(11) 99999-0000"
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700">
                      Indicador
                      <input
                        type="text"
                        name="indicacao"
                        list={indicatorDatalistId}
                        defaultValue={indicacao}
                        placeholder="Código ou nome"
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                      <datalist id={indicatorDatalistId}>
                        {recruiterOptions.map((recruiter) => (
                          <option key={recruiter.code} value={recruiter.code} label={recruiter.name} />
                        ))}
                      </datalist>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700">
                      Treinamento
                      <select
                        id="treinamento"
                        name="treinamento"
                        defaultValue={treinamentoSelecionado}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      >
                        <option value="">Todos</option>
                        {trainingOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                      href="/crm"
                      className="text-sm font-semibold text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
                    >
                      Limpar filtros
                    </Link>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                    >
                      Aplicar filtros
                    </button>
                  </div>
                </form>
              </div>
            </details>
          </div>

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
