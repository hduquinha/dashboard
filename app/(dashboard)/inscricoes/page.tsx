import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, MessageCircle, UploadCloud, Users } from "lucide-react";
import InscricoesTable from "@/components/InscricoesTable";
import PrintButton from "@/components/PrintButton";
import { listInscricoes, listTrainingFilterOptions, listRecruitersWithDbNames } from "@/lib/db";
import { listChatwootChannelOptions } from "@/lib/chatwoot";
import { isOnlineTraining } from "@/lib/participantTags";
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
  const cidade = pickStringParam(searchParams?.cidade) ?? "";
  const indicacao = pickStringParam(searchParams?.indicacao) ?? "";
  const treinamentoSelecionado =
    pickStringParam(searchParams?.data_treinamento) ?? pickStringParam(searchParams?.treinamento) ?? "";
  const tamanhoCamiseta = pickStringParam(searchParams?.tamanho_camiseta) ?? "";
  const presencaFiltro = pickStringParam(searchParams?.presenca) as "aprovada" | "reprovada" | "validada" | "nao-validada" | undefined;

  const recruiterOptionsPromise = listRecruitersWithDbNames();
  const trainingOptions = await listTrainingFilterOptions();
  const activeTreinamentoId = treinamentoSelecionado;

  // Agrupar treinamentos por cluster para exibição organizada
  const trainingsByCluster = trainingOptions.reduce((acc, option) => {
    const clusterKey = option.cluster ?? 999;
    if (!acc[clusterKey]) {
      acc[clusterKey] = [];
    }
    acc[clusterKey].push(option);
    return acc;
  }, {} as Record<number, typeof trainingOptions>);

  const clusterLabels: Record<number, string> = {
    1: "Cluster 1",
    2: "Cluster 2",
    3: "Cluster 3",
    4: "Cluster 4",
    5: "Cluster 5",
    999: "Outros",
  };

  const sortedClusterKeys = Object.keys(trainingsByCluster)
    .map(Number)
    .sort((a, b) => a - b);

  const resultPromise = listInscricoes({
    page,
    pageSize,
    orderBy,
    orderDirection,
    filters: {
      nome,
      telefone,
      cidade,
      indicacao,
      dataTreinamento: activeTreinamentoId || undefined,
      tamanhoCamiseta,
      presenca: presencaFiltro,
    },
  });

  const [recruiterOptions, result, chatwootChannels] = await Promise.all([
    recruiterOptionsPromise,
    resultPromise,
    listChatwootChannelOptions(),
  ]);

  const selectedTrainingOption = activeTreinamentoId.length
    ? trainingOptions.find((option) => option.id === activeTreinamentoId)
    : undefined;
  const useOnlineTrainingTable =
    activeTreinamentoId.length > 0 &&
    (selectedTrainingOption
      ? selectedTrainingOption.kind === "online"
      : isOnlineTraining(activeTreinamentoId));
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
    cidade ? { label: "Cidade", value: cidade } : null,
    tamanhoCamiseta ? { label: "Camiseta", value: tamanhoCamiseta } : null,
    indicacao ? { label: "Indicacao", value: indicadorLabel } : null,
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
  if (cidade) paramsForExport.set("cidade", cidade);
  if (indicacao) paramsForExport.set("indicacao", indicacao);
  if (activeTreinamentoId) paramsForExport.set("data_treinamento", activeTreinamentoId);
  if (tamanhoCamiseta) paramsForExport.set("tamanho_camiseta", tamanhoCamiseta);
  paramsForExport.set("orderBy", orderBy);
  paramsForExport.set("orderDirection", orderDirection);
  const exportUrl = buildExportUrl(paramsForExport);
  const crmHref = activeTreinamentoId
    ? `/crm?treinamento=${encodeURIComponent(activeTreinamentoId)}`
    : "/crm";

  const distribuirParams = new URLSearchParams();
  if (activeTreinamentoId) distribuirParams.set("treinamento", activeTreinamentoId);
  if (presencaFiltro) distribuirParams.set("presenca", presencaFiltro);
  if (indicacao) distribuirParams.set("indicacao", indicacao);
  const distribuirHref = `/distribuicao?${distribuirParams.toString()}`;

  return (
    <main className="space-y-4 sm:space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          {activeTreinamentoId ? (
            <Link
              href="/treinamentos"
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 transition hover:text-neutral-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Treinamentos
            </Link>
          ) : null}
          <h1 className="text-xl font-bold text-neutral-900 sm:text-2xl">
            {activeTreinamentoId ? "Inscritos do treinamento" : "Inscrições"}
          </h1>
          <p className="text-sm text-neutral-500">
            {activeTreinamentoId
              ? trainingFilterLabel || "Lista filtrada por treinamento"
              : "Gerencie a base de leads e recrutadores."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <Link
            href={crmHref}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <MessageCircle className="h-4 w-4" />
            CRM/Chatwoot
          </Link>
          <PrintButton className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50" />
          <Link
            href={exportUrl}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </Link>
          <Link
            href={distribuirHref}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-100"
          >
            <Users className="h-4 w-4" />
            Distribuir
          </Link>
          <Link
            href="/importar"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            <UploadCloud className="h-4 w-4" />
            Importar Dados
          </Link>
        </div>
      </header>

      {/* CRM Table Section */}
      <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        {/* Header with search */}
        <div className="border-b border-neutral-200 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-neutral-900">Inscrições</h2>
              <p className="text-sm text-neutral-500">{result.total.toLocaleString()} registros encontrados</p>
            </div>
            
            {/* Quick Search */}
            <form className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] lg:max-w-xl">
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
                className="min-h-10 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                Buscar
              </button>
            </form>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="border-b border-neutral-100 bg-neutral-50/80 px-4 py-3 sm:px-6">
          <form className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center xl:gap-3">
            {/* Treinamento Filter */}
            <div className="relative min-w-0">
              <select
                name="data_treinamento"
                defaultValue={activeTreinamentoId}
                className="min-h-10 w-full appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 xl:w-auto"
              >
                <option value="">Data do treinamento</option>
                {sortedClusterKeys.map((clusterKey) => {
                  const options = trainingsByCluster[clusterKey];
                  if (sortedClusterKeys.length === 1 && clusterKey === 999) {
                    // Se só tem "Outros", não usar optgroup
                    return options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ));
                  }
                  return (
                    <optgroup key={clusterKey} label={clusterLabels[clusterKey] ?? `Cluster ${clusterKey}`}>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Presença Filter */}
            <div className="relative min-w-0">
              <select
                name="presenca"
                defaultValue={presencaFiltro ?? ""}
                className="min-h-10 w-full appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 xl:w-auto"
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

            {/* Camiseta Filter */}
            <div className="relative min-w-0">
              <select
                name="tamanho_camiseta"
                defaultValue={tamanhoCamiseta}
                className="min-h-10 w-full appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 xl:w-auto"
              >
                <option value="">Camiseta</option>
                {["P", "M", "G", "GG", "XG", "XGG"].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            <div className="relative min-w-0">
              <input
                type="text"
                name="indicacao"
                defaultValue={indicacao}
                list="recruiters-list"
                placeholder="Indicacao..."
                className="min-h-10 w-full rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-neutral-700 transition placeholder:text-neutral-500 hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 xl:w-36"
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
              className="min-h-10 w-full rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-neutral-700 transition placeholder:text-neutral-500 hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 xl:w-36"
            />

            <input
              type="text"
              name="cidade"
              defaultValue={cidade}
              placeholder="Cidade..."
              className="min-h-10 w-full rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-neutral-700 transition placeholder:text-neutral-500 hover:border-neutral-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 xl:w-36"
            />

            {/* Apply button for text inputs */}
            <button
              type="submit"
              className="min-h-10 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-600"
            >
              Filtrar
            </button>

            {/* Clear all - only show if filters active */}
            {activeFiltersCount > 0 && (
              <Link
                href="/inscricoes"
                className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-red-600 xl:ml-auto"
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
            chatwootChannels={chatwootChannels}
            showUpDayColumns={!useOnlineTrainingTable}
          />
        </div>
      </section>
    </main>
  );
}
