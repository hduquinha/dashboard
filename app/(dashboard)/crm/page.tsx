import type { Metadata } from "next";
import Link from "next/link";
import InscricoesTable from "@/components/InscricoesTable";
import { listInscricoes, listTrainingFilterOptions } from "@/lib/db";
import { listRecruiters } from "@/lib/recruiters";
import type { OrderDirection, OrderableField } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;

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
  const presencaFiltro = pickStringParam(searchParams?.presenca) as "aprovada" | "reprovada" | "validada" | "nao-validada" | undefined;

  const baseSearchParams = new URLSearchParams();
  if (searchParams && typeof searchParams === "object") {
    for (const [key, value] of Object.entries(searchParams)) {
      const normalized = Array.isArray(value) ? value[0] : value;
      if (typeof normalized === "string" && normalized.length > 0) {
        baseSearchParams.set(key, normalized);
      }
    }
  }

  const buildFiltersHref = (overrides: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(baseSearchParams);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === undefined || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const query = next.toString();
    return query.length ? `/crm?${query}` : "/crm";
  };

  const recruiterOptionsPromise = listRecruiters();
  const trainingOptions = await listTrainingFilterOptions();
  const activeTreinamentoId = treinamentoSelecionado;

  const resultPromise = listInscricoes({
    page,
    pageSize,
    orderBy,
    orderDirection,
    filters: {
      nome,
      telefone,
      indicacao,
      treinamento: activeTreinamentoId || undefined,
      presenca: presencaFiltro,
    },
  });

  const [recruiterOptions, result] = await Promise.all([recruiterOptionsPromise, resultPromise]);

  const indicatorDatalistId = "indicator-options";
  const selectedTrainingOption = activeTreinamentoId.length
    ? trainingOptions.find((option) => option.id === activeTreinamentoId)
    : undefined;
  const trainingFilterLabel = selectedTrainingOption
    ? selectedTrainingOption.label ?? selectedTrainingOption.id
    : activeTreinamentoId;
  const presencaLabels: Record<string, string> = {
    aprovada: "Presença Aprovada",
    reprovada: "Presença Reprovada",
    validada: "Presença Validada",
    "nao-validada": "Sem Presença",
  };
  const activeFilters = [
    nome ? { label: "Nome", value: nome } : null,
    telefone ? { label: "Telefone", value: telefone } : null,
    indicacao ? { label: "Indicador", value: indicacao } : null,
    activeTreinamentoId
      ? {
          label: "Treinamento",
          value: trainingFilterLabel ?? activeTreinamentoId,
        }
      : null,
    presencaFiltro
      ? {
          label: "Presença",
          value: presencaLabels[presencaFiltro] ?? presencaFiltro,
        }
      : null,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));
  const activeFiltersCount = activeFilters.length;

  const paramsForExport = new URLSearchParams();
  if (nome) paramsForExport.set("nome", nome);
  if (telefone) paramsForExport.set("telefone", telefone);
  if (indicacao) paramsForExport.set("indicacao", indicacao);
  if (activeTreinamentoId) paramsForExport.set("treinamento", activeTreinamentoId);
  paramsForExport.set("orderBy", orderBy);
  paramsForExport.set("orderDirection", orderDirection);
  const exportUrl = buildExportUrl(paramsForExport);

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">CRM</h1>
          <p className="text-sm text-neutral-500">Gerencie a base de leads e recrutadores.</p>
        </div>
        <div className="flex gap-3">
          <Link
            href={exportUrl}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            Exportar CSV
          </Link>
          <Link
            href="/importar"
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            Importar Dados
          </Link>
        </div>
      </header>

      {/* CRM Table Section */}
      <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Inscrições</h2>
              <p className="text-sm text-neutral-500">Lista completa de registros.</p>
            </div>
          </div>
        </div>

        {/* Filters (Collapsible) */}
        <div className="border-b border-neutral-200 bg-neutral-50/50 px-6 py-4">
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-600 hover:text-neutral-900">
              <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 group-open:bg-neutral-900 group-open:text-white">
                {activeFiltersCount}
              </span>
              Filtros avançados
              <svg
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            
            <div className="mt-4">
              <form className="grid gap-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
                    Nome
                    <input
                      type="text"
                      name="nome"
                      defaultValue={nome}
                      placeholder="Buscar por nome..."
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm shadow-sm focus:border-[#2DBDC2] focus:ring-[#2DBDC2]"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
                    Telefone
                    <input
                      type="text"
                      name="telefone"
                      defaultValue={telefone}
                      placeholder="Ex: 11999999999"
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm shadow-sm focus:border-[#2DBDC2] focus:ring-[#2DBDC2]"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
                    Indicado por
                    <input
                      type="text"
                      name="indicacao"
                      defaultValue={indicacao}
                      list="recruiters-list"
                      placeholder="Nome ou código..."
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm shadow-sm focus:border-[#2DBDC2] focus:ring-[#2DBDC2]"
                    />
                    <datalist id="recruiters-list">
                      {recruiterOptions.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.name} ({r.code})
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
                    Treinamento
                    <select
                      name="treinamento"
                      defaultValue={activeTreinamentoId}
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm shadow-sm focus:border-[#2DBDC2] focus:ring-[#2DBDC2]"
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

                <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
                  <Link
                    href="/crm"
                    className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline"
                  >
                    Limpar filtros
                  </Link>
                  <button
                    type="submit"
                    className="rounded-lg bg-[#2DBDC2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1A9A9E]"
                  >
                    Aplicar Filtros
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>

        <div className="p-0">
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
    </main>
  );
}
