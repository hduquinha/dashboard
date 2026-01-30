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
  
  // Buscar nome do indicador pelo código
  const selectedRecruiter = indicacao
    ? recruiterOptions.find((r) => r.code.toLowerCase() === indicacao.toLowerCase())
    : undefined;
  const indicadorLabel = selectedRecruiter
    ? `${selectedRecruiter.name} (${selectedRecruiter.code})`
    : indicacao;

  const presencaLabels: Record<string, string> = {
    aprovada: "Presença Aprovada",
    reprovada: "Presença Reprovada",
    validada: "Presença Validada",
    "nao-validada": "Sem Presença",
  };
  const activeFilters = [
    nome ? { label: "Nome", value: nome } : null,
    telefone ? { label: "Telefone", value: telefone } : null,
    indicacao ? { label: "Indicador", value: indicadorLabel } : null,
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
        {/* Header with search */}
        <div className="border-b border-neutral-200 px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-neutral-900">Inscrições</h2>
              <p className="text-sm text-neutral-500">{result.total.toLocaleString()} registros encontrados</p>
            </div>
            
            {/* Quick Search */}
            <form className="flex flex-1 gap-2 lg:max-w-xl">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  name="nome"
                  defaultValue={nome}
                  placeholder="Buscar por nome..."
                  className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-4 text-sm transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-100"
                />
              </div>
              <button
                type="submit"
                className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                Buscar
              </button>
            </form>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="border-b border-neutral-100 bg-neutral-50/80 px-6 py-3">
          <form className="flex flex-wrap items-center gap-3">
            {/* Treinamento Filter */}
            <div className="relative">
              <select
                name="treinamento"
                defaultValue={activeTreinamentoId}
                className="appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              >
                <option value="">🎓 Treinamento</option>
                {trainingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Presença Filter */}
            <div className="relative">
              <select
                name="presenca"
                defaultValue={presencaFiltro ?? ""}
                className="appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              >
                <option value="">✓ Presença</option>
                <option value="aprovada">✅ Aprovada</option>
                <option value="reprovada">❌ Reprovada</option>
                <option value="validada">📋 Validada</option>
                <option value="nao-validada">⏳ Sem Presença</option>
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Indicador Filter */}
            <div className="relative">
              <input
                type="text"
                name="indicacao"
                defaultValue={indicacao}
                list="recruiters-list"
                placeholder="👤 Indicador..."
                className="w-36 rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-neutral-700 transition placeholder:text-neutral-500 hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
              <datalist id="recruiters-list">
                {recruiterOptions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </datalist>
            </div>

            {/* Telefone Filter */}
            <input
              type="text"
              name="telefone"
              defaultValue={telefone}
              placeholder="📱 Telefone..."
              className="w-36 rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-neutral-700 transition placeholder:text-neutral-500 hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            />

            {/* Apply button for text inputs */}
            <button
              type="submit"
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-600"
            >
              Filtrar
            </button>

            {/* Clear all - only show if filters active */}
            {activeFiltersCount > 0 && (
              <Link
                href="/crm"
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-red-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Limpar filtros
              </Link>
            )}
          </form>
        </div>

        {/* Active Filters Pills */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 bg-gradient-to-r from-cyan-50/50 to-transparent px-6 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Filtros:</span>
            {activeFilters.map((filter, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100/80 px-3 py-1 text-xs font-medium text-cyan-700"
              >
                {filter.label}: {filter.value}
              </span>
            ))}
          </div>
        )}

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
