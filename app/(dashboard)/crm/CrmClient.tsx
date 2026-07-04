"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, UserPlus, X } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import type { CommercialStage, InscricaoItem, InscricaoStatus, OrderDirection, OrderableField } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import type { CommercialWorkspace } from "@/types/commercial";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { humanizeName } from "@/lib/utils";
import { LeadProfileModal } from "@/components/LeadProfileModal";
import { MergeLeadsModal } from "@/components/MergeLeadsModal";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { CrmKanbanView } from "@/components/CrmKanbanView";

/* ───────── Types ───────── */

interface RecruiterOption {
  code: string;
  name: string;
}

interface CampaignTermOption {
  value: string;
  count: number;
}

interface Filters {
  q: string;
  nome: string;
  telefone: string;
  cidade: string;
  profissao: string;
  indicacao: string;
  /** Comma-separated training IDs for multi-select */
  treinamentos?: string;
  /** Quick filter: all trainings of this kind */
  kind?: string;
  presenca?: "aprovada" | "reprovada" | "validada" | "nao-validada";
  tag?: "recrutador" | "whatsapp" | "com-indicador" | "com-dinamica";
  status?: string;
  campaignSource: string;
  campaignName: string;
  campaignTerm?: string;
  commercialStage?: CommercialStage;
  assignedSellerEmail: string;
  unassignedOnly?: boolean;
  stars?: string;
  produto?: "vozup" | "instituto";
}

interface LeadsClientProps {
  inscricoes: InscricaoItem[];
  commercial: CommercialWorkspace;
  total: number;
  page: number;
  pageSize: number;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  campaignTermOptions: CampaignTermOption[];
  filters: Filters;
}

/* ───────── Sort options ───────── */

const SORT_OPTIONS: {
  field: OrderableField;
  dir: OrderDirection;
  icon: string;
  label: string;
  shortLabel: string;
  description?: string;
}[] = [
  { field: "criado_em", dir: "desc", icon: "🗓️", label: "Mais recente", shortLabel: "Mais recente", description: "Data de entrada, do mais novo ao mais antigo" },
  { field: "criado_em", dir: "asc",  icon: "🗓️", label: "Mais antigo",  shortLabel: "Mais antigo",  description: "Data de entrada, do mais antigo ao mais novo" },
  { field: "nome",      dir: "asc",  icon: "🔤", label: "Nome A → Z",   shortLabel: "Nome A→Z",     description: "Ordem alfabética crescente" },
  { field: "nome",      dir: "desc", icon: "🔤", label: "Nome Z → A",   shortLabel: "Nome Z→A",     description: "Ordem alfabética decrescente" },
  { field: "status_at", dir: "desc", icon: "🔄", label: "Última interação", shortLabel: "Interação", description: "Leads com atividade mais recente primeiro" },
  { field: "stars",     dir: "desc", icon: "⭐", label: "Temperatura ↓", shortLabel: "Temperatura ↓", description: "Mais quentes primeiro" },
  { field: "stars",     dir: "asc",  icon: "⭐", label: "Temperatura ↑", shortLabel: "Temperatura ↑", description: "Mais frios primeiro" },
  { field: "commercial_stage", dir: "asc",  icon: "📋", label: "Etapa comercial", shortLabel: "Etapa", description: "Agrupa por etapa do funil" },
  { field: "treinamento", dir: "asc", icon: "🎓", label: "Treinamento",  shortLabel: "Treinamento", description: "Agrupa por evento / treinamento" },
  { field: "cidade",    dir: "asc",  icon: "📍", label: "Cidade A → Z", shortLabel: "Cidade",       description: "Ordem alfabética por cidade" },
];

/* ───────── Pipeline stages ───────── */

const PIPELINE: { key: string; label: string; color: string; bg: string; icon: string }[] = [
  { key: "aguardando", label: "Novo", color: "text-slate-700", bg: "bg-slate-100", icon: "📥" },
  { key: "aprovado", label: "Qualificado", color: "text-emerald-700", bg: "bg-emerald-100", icon: "✅" },
  { key: "rejeitado", label: "Descartado", color: "text-rose-700", bg: "bg-rose-100", icon: "🚫" },
];

const COMMERCIAL_STAGE_STYLE: Record<CommercialStage, { label: string; className: string }> = {
  novo: { label: "Novo", className: "bg-slate-100 text-slate-700" },
  primeiro_contato: { label: "Primeiro contato", className: "bg-cyan-50 text-cyan-700" },
  em_atendimento: { label: "Em atendimento", className: "bg-blue-50 text-blue-700" },
  agendado: { label: "Agendado", className: "bg-violet-50 text-violet-700" },
  fechamento: { label: "Fechamento", className: "bg-amber-50 text-amber-700" },
  ganho: { label: "Ganho", className: "bg-emerald-50 text-emerald-700" },
  perdido: { label: "Perdido", className: "bg-rose-50 text-rose-700" },
  no_show: { label: "No-show", className: "bg-orange-50 text-orange-700" },
};

function pipelineFor(status?: InscricaoStatus) {
  return PIPELINE.find((p) => p.key === status) ?? PIPELINE[0];
}


/* ───────── Formatters ───────── */

function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtRelative(value: string): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d atrás`;
  return fmtDate(value);
}

/* ───────── Component ───────── */

export default function CrmClient({
  inscricoes,
  commercial,
  total,
  page,
  pageSize,
  orderBy,
  orderDirection,
  trainingOptions,
  recruiterOptions,
  campaignTermOptions,
  filters,
}: LeadsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [records, setRecords] = useState(inscricoes);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState(filters.q || filters.nome);
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [view, setView] = useState<"list" | "kanban">(() =>
    searchParams.get("view") === "kanban" ? "kanban" : "list"
  );
  const filterBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setRecords(inscricoes); }, [inscricoes]);
  useEffect(() => { setSearchText(filters.q || filters.nome); }, [filters.q, filters.nome]);
  useEffect(() => { setShowMergeModal(false); }, [selectedId]);
  useEffect(() => {
    if (!activePopover) return;
    function onMouseDown(e: MouseEvent) {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setActivePopover(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [activePopover]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selected = useMemo(() => records.find((r) => r.id === selectedId) ?? null, [records, selectedId]);
  const syncRecord = useCallback((updated: InscricaoItem) => {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  const trainingById = useMemo(() => {
    const map: Record<string, TrainingOption> = {};
    for (const t of trainingOptions) map[t.id] = t;
    return map;
  }, [trainingOptions]);

  /* ─── URL helpers ─── */

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const q = params.toString();
    startTransition(() => router.push(q ? `${pathname}?${q}` : pathname));
  }, [searchParams, pathname, router, startTransition]);

  function goToPage(p: number) {
    updateQuery({ page: String(Math.min(Math.max(1, p), totalPages)) });
  }

  function handleSort(field: OrderableField) {
    const dir: OrderDirection = orderBy === field && orderDirection === "asc" ? "desc" : "asc";
    updateQuery({ orderBy: field, orderDirection: dir, page: "1" });
  }

  function getTrainingDisplay(inscricao: InscricaoItem) {
    const tid = inscricao.treinamentoId;
    if (!tid) return null;
    const match = trainingById[tid];
    const raw = inscricao.treinamentoData ?? match?.startsAt ?? null;
    const formatted = raw ? formatTrainingDateLabel(raw) : formatTrainingDateLabel(tid);
    return formatted ?? inscricao.treinamentoNome ?? match?.label ?? tid;
  }

  /* ─── Render ─── */

  // Parse selected training IDs from comma-separated string
  const selectedTrainingIds = useMemo(
    () => new Set(filters.treinamentos ? filters.treinamentos.split(",").filter(Boolean) : []),
    [filters.treinamentos],
  );

  // Training options split by kind
  const onlineTrainings = useMemo(() => trainingOptions.filter((t) => t.kind === "online"), [trainingOptions]);
  const upDayTrainings = useMemo(() => trainingOptions.filter((t) => t.kind === "up-day-plus"), [trainingOptions]);

  // Export / print / distribuir URLs — reflect active filters
  const exportUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("source", "crm");
    if (filters.q) p.set("q", filters.q);
    if (filters.status) p.set("status", filters.status);
    if (filters.treinamentos) p.set("treinamentos", filters.treinamentos);
    if (filters.kind && !filters.treinamentos) p.set("kind", filters.kind);
    if (filters.presenca) p.set("presenca", filters.presenca);
    if (filters.indicacao) p.set("indicacao", filters.indicacao);
    if (filters.stars) p.set("stars", filters.stars);
    if (filters.campaignSource) p.set("campaignSource", filters.campaignSource);
    if (filters.commercialStage) p.set("commercialStage", filters.commercialStage);
    return `/api/export?${p.toString()}`;
  }, [filters]);

  const printUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.status) p.set("status", filters.status);
    if (filters.treinamentos) p.set("treinamentos", filters.treinamentos);
    if (filters.presenca) p.set("presenca", filters.presenca);
    if (filters.indicacao) p.set("indicacao", filters.indicacao);
    return `/api/print?${p.toString()}`;
  }, [filters]);

  const distribuirUrl = useMemo(() => {
    const p = new URLSearchParams();
    // distribuicao page uses its own filter UI with these params
    if (filters.treinamentos) {
      const ids = filters.treinamentos.split(",").filter(Boolean);
      if (ids.length === 1) p.set("treinamento", ids[0]);
    } else if (filters.kind) {
      p.set("kind", filters.kind);
    }
    if (filters.status) p.set("status", filters.status);
    if (filters.presenca) p.set("presenca", filters.presenca);
    if (filters.q) p.set("q", filters.q);
    return `/distribuicao?${p.toString()}`;
  }, [filters]);

  // Presença filter is only relevant in online context
  const hasOnlineContext = useMemo(() => {
    if (filters.kind === "online") return true;
    if (selectedTrainingIds.size === 0) return false;
    return [...selectedTrainingIds].some((id) => trainingById[id]?.kind === "online");
  }, [filters.kind, selectedTrainingIds, trainingById]);

  function toggleTraining(id: string) {
    const next = new Set(selectedTrainingIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    const joined = [...next].join(",");
    updateQuery({ treinamentos: joined || null, kind: null, page: "1" });
  }

  const activeFiltersCount = [
    filters.treinamentos,
    filters.kind,
    filters.presenca,
    filters.tag,
    filters.indicacao,
    filters.campaignSource,
    filters.campaignName,
    filters.campaignTerm,
    filters.commercialStage,
    filters.assignedSellerEmail,
    filters.unassignedOnly,
    filters.stars,
    filters.produto,
  ].filter(Boolean).length;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:h-[calc(100vh-4rem)] lg:min-h-0">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-neutral-200 bg-white">

        {/* Row 1: Title + sync */}
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-neutral-900">CRM</h1>
            <span className="text-xs text-neutral-400">
              {view === "list" ? `${total.toLocaleString()} registros · p. ${page}/${totalPages}` : "Kanban"}
            </span>
            {/* View toggle */}
            <div className="flex overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
              <button
                type="button"
                onClick={() => { setView("list"); updateQuery({ view: null }); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition ${view === "list" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
                title="Vista em lista"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                Lista
              </button>
              <button
                type="button"
                onClick={() => { setView("kanban"); updateQuery({ view: "kanban" }); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition ${view === "kanban" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
                title="Vista em kanban"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                Kanban
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-semibold text-white hover:bg-cyan-700"
            >
              <UserPlus className="h-3.5 w-3.5" /> Novo lead
            </button>
            <ExportMenu
              exportUrl={exportUrl}
              printUrl={printUrl}
              distribuirUrl={distribuirUrl}
              total={total}
            />
          </div>
        </div>

        {/* Row 2: Search + status + filter chips — all inline */}
        <div ref={filterBarRef} className="relative flex flex-wrap items-center gap-1.5 border-t border-neutral-100 px-4 py-2">

          {/* Search */}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => { e.preventDefault(); updateQuery({ q: searchText, nome: null, page: "1" }); setActivePopover(null); }}
          >
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar nome, cidade..."
                className="h-8 w-52 rounded-lg border border-neutral-200 bg-neutral-50 pl-8 pr-3 text-xs focus:border-neutral-400 focus:bg-white focus:outline-none"
              />
            </div>
            <button type="submit" className="h-8 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-700">
              Buscar
            </button>
          </form>

          <div className="mx-1 h-5 w-px bg-neutral-200" />

          {/* Status chips */}
          {PIPELINE.map((p) => {
            const active = filters.status === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => updateQuery({ status: active ? null : p.key, page: "1" })}
                className={`h-8 rounded-lg px-3 text-xs font-medium transition ${
                  active ? `${p.bg} ${p.color} font-semibold` : "text-neutral-500 hover:bg-neutral-100"
                }`}
              >
                {p.label}
              </button>
            );
          })}

          <div className="mx-1 h-5 w-px bg-neutral-200" />

          {/* ── FILTER CHIPS ── */}

          {/* Produto */}
          <div className="flex rounded-lg border border-neutral-200 bg-white overflow-hidden">
            {[
              { value: "", label: "Todos" },
              { value: "instituto", label: "Instituto UP" },
              { value: "vozup", label: "Voz UP" },
            ].map((opt) => {
              const active = (filters.produto ?? "") === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateQuery({ produto: opt.value || null, page: "1" })}
                  className={`h-8 px-3 text-xs font-semibold transition border-r border-neutral-200 last:border-r-0 ${
                    active
                      ? opt.value === "vozup"
                        ? "bg-violet-600 text-white"
                        : opt.value === "instituto"
                          ? "bg-cyan-600 text-white"
                          : "bg-neutral-900 text-white"
                      : "text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Treinamento */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "treinamento" ? null : "treinamento")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.treinamentos || filters.kind
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <span>
                {filters.kind === "online" && !filters.treinamentos
                  ? "Todos Encontros Online"
                  : filters.kind === "up-day-plus" && !filters.treinamentos
                    ? "Todos UP Day Plus"
                    : selectedTrainingIds.size === 1
                      ? (trainingById[[...selectedTrainingIds][0]]?.label ?? "Treinamento")
                      : selectedTrainingIds.size > 1
                        ? `Treinamento · ${selectedTrainingIds.size}`
                        : "Treinamento"}
              </span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "treinamento" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-[480px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                <div className="flex divide-x divide-neutral-100">

                  {/* Online column */}
                  <div className="flex-1 p-3">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Encontro Online</span>
                      <button
                        type="button"
                        onClick={() => { updateQuery({ kind: filters.kind === "online" && !filters.treinamentos ? null : "online", treinamentos: null, page: "1" }); setActivePopover(null); }}
                        className={`h-5 rounded-full px-2.5 text-[10px] font-semibold transition ${
                          filters.kind === "online" && !filters.treinamentos
                            ? "bg-cyan-600 text-white"
                            : "bg-neutral-100 text-neutral-500 hover:bg-cyan-100 hover:text-cyan-700"
                        }`}
                      >
                        Todos
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      {onlineTrainings.length === 0
                        ? <span className="text-xs text-neutral-400">Nenhum encontro</span>
                        : onlineTrainings.map((t) => {
                          const active = selectedTrainingIds.has(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTraining(t.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                active
                                  ? "bg-cyan-50 font-semibold text-cyan-800"
                                  : "text-neutral-700 hover:bg-neutral-50"
                              }`}
                            >
                              <span className={`h-4 w-4 flex-shrink-0 rounded border text-center text-[10px] leading-4 ${active ? "border-cyan-500 bg-cyan-500 text-white" : "border-neutral-300"}`}>
                                {active ? "✓" : ""}
                              </span>
                              {t.label || formatTrainingDateLabel(t.id) || t.id}
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* UP Day column */}
                  <div className="flex-1 p-3">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">UP Day Plus</span>
                      <button
                        type="button"
                        onClick={() => { updateQuery({ kind: filters.kind === "up-day-plus" && !filters.treinamentos ? null : "up-day-plus", treinamentos: null, page: "1" }); setActivePopover(null); }}
                        className={`h-5 rounded-full px-2.5 text-[10px] font-semibold transition ${
                          filters.kind === "up-day-plus" && !filters.treinamentos
                            ? "bg-violet-600 text-white"
                            : "bg-neutral-100 text-neutral-500 hover:bg-violet-100 hover:text-violet-700"
                        }`}
                      >
                        Todos
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      {upDayTrainings.length === 0
                        ? <span className="text-xs text-neutral-400">Nenhum UP Day</span>
                        : upDayTrainings.map((t) => {
                          const active = selectedTrainingIds.has(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTraining(t.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                active
                                  ? "bg-violet-50 font-semibold text-violet-800"
                                  : "text-neutral-700 hover:bg-neutral-50"
                              }`}
                            >
                              <span className={`h-4 w-4 flex-shrink-0 rounded border text-center text-[10px] leading-4 ${active ? "border-violet-500 bg-violet-500 text-white" : "border-neutral-300"}`}>
                                {active ? "✓" : ""}
                              </span>
                              {t.label || formatTrainingDateLabel(t.id) || t.id}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>

                {(filters.treinamentos || filters.kind) && (
                  <div className="border-t border-neutral-100 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => { updateQuery({ kind: null, treinamentos: null, page: "1" }); setActivePopover(null); }}
                      className="text-xs text-neutral-400 hover:text-rose-500"
                    >
                      Limpar seleção
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Etiqueta */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "etiqueta" ? null : "etiqueta")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.tag
                  ? "border-violet-400 bg-violet-50 font-semibold text-violet-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {filters.tag === "recrutador" ? "🧑‍💼 Recrutador"
                : filters.tag === "whatsapp" ? "💬 WhatsApp enviado"
                  : filters.tag === "com-indicador" ? "🔗 Com indicador"
                    : filters.tag === "com-dinamica" ? "🎯 Com dinâmica"
                      : "Etiqueta"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "etiqueta" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {[
                  { value: "", label: "Qualquer" },
                  { value: "recrutador", label: "🧑‍💼 Recrutador" },
                  { value: "whatsapp", label: "💬 WhatsApp enviado" },
                  { value: "com-indicador", label: "🔗 Com indicador" },
                  { value: "com-dinamica", label: "🎯 Com dinâmica" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { updateQuery({ tag: opt.value || null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      (filters.tag ?? "") === opt.value ? "bg-violet-50 font-semibold text-violet-800" : "text-neutral-700"
                    }`}
                  >
                    <span className={`h-4 w-4 flex-shrink-0 rounded-full border ${(filters.tag ?? "") === opt.value ? "border-violet-500 bg-violet-500" : "border-neutral-300"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Presença */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "presenca" ? null : "presenca")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.presenca
                  ? "border-emerald-400 bg-emerald-50 font-semibold text-emerald-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {filters.presenca === "aprovada" ? "✓ Presentes"
                : filters.presenca === "reprovada" ? "~ Parcial"
                  : filters.presenca === "validada" ? "Com validação"
                    : filters.presenca === "nao-validada" ? "Sem validação"
                      : "Presença"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "presenca" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {[
                  { value: "", label: "Todas" },
                  { value: "aprovada", label: "✓ Presente" },
                  { value: "reprovada", label: "~ Parcial / reprovada" },
                  { value: "validada", label: "Com validação" },
                  { value: "nao-validada", label: "Sem validação" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { updateQuery({ presenca: opt.value || null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      (filters.presenca ?? "") === opt.value ? "bg-emerald-50 font-semibold text-emerald-800" : "text-neutral-700"
                    }`}
                  >
                    <span className={`h-4 w-4 flex-shrink-0 rounded-full border ${(filters.presenca ?? "") === opt.value ? "border-emerald-500 bg-emerald-500" : "border-neutral-300"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Temperatura */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "stars" ? null : "stars")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.stars
                  ? "border-amber-400 bg-amber-50 font-semibold text-amber-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {filters.stars ? `${"★".repeat(Number(filters.stars))} ${filters.stars}★` : "Temperatura"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "stars" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {[
                  { value: "", label: "Qualquer", stars: 0 },
                  { value: "1", label: "Fria", stars: 1 },
                  { value: "2", label: "Morna", stars: 2 },
                  { value: "3", label: "Quente", stars: 3 },
                  { value: "4", label: "Muito quente", stars: 4 },
                  { value: "5", label: "Hot 🔥", stars: 5 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { updateQuery({ stars: opt.value || null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      (filters.stars ?? "") === opt.value ? "bg-amber-50 font-semibold text-amber-800" : "text-neutral-700"
                    }`}
                  >
                    <span className="w-14 text-amber-400">{"★".repeat(opt.stars)}{"☆".repeat(5 - opt.stars)}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Indicador */}
          {recruiterOptions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "indicador" ? null : "indicador")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.indicacao
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {filters.indicacao
                  ? (recruiterOptions.find((r) => r.code === filters.indicacao)?.name ?? "Indicador")
                  : "Indicador"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "indicador" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
                  {[{ code: "", name: "Qualquer" }, ...recruiterOptions].map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => { updateQuery({ indicacao: r.code || null, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                        (filters.indicacao ?? "") === r.code ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Criativo (Meta Ads / tráfego pago) */}
          {campaignTermOptions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "criativo" ? null : "criativo")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.campaignTerm
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                <span className="max-w-[140px] truncate">
                  {filters.campaignTerm || "Criativo"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "criativo" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-72 w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
                  <button
                    type="button"
                    onClick={() => { updateQuery({ campaignTerm: null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      !filters.campaignTerm ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                    }`}
                  >
                    Qualquer
                  </button>
                  {campaignTermOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { updateQuery({ campaignTerm: opt.value, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                        filters.campaignTerm === opt.value ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      <span className="truncate">{opt.value}</span>
                      <span className={`flex-shrink-0 text-[10px] ${filters.campaignTerm === opt.value ? "text-neutral-300" : "text-neutral-400"}`}>
                        {opt.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Etapa comercial */}
          {commercial.stages.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "etapa" ? null : "etapa")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.commercialStage
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {filters.commercialStage
                  ? (COMMERCIAL_STAGE_STYLE[filters.commercialStage]?.label ?? "Etapa")
                  : "Etapa"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "etapa" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                  {[{ key: "", label: "Qualquer" }, ...commercial.stages].map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { updateQuery({ commercialStage: s.key || null, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                        (filters.commercialStage ?? "") === s.key ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Vendedor — supervisor only */}
          {commercial.isSupervisor && commercial.sellers.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "vendedor" ? null : "vendedor")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.assignedSellerEmail || filters.unassignedOnly
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {filters.unassignedOnly
                  ? "Sem vendedor"
                  : filters.assignedSellerEmail
                    ? (commercial.sellers.find((s) => s.email === filters.assignedSellerEmail)?.name ?? "Vendedor")
                    : "Vendedor"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "vendedor" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
                  <button
                    type="button"
                    onClick={() => { updateQuery({ assignedSellerEmail: null, unassignedOnly: null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${!filters.assignedSellerEmail && !filters.unassignedOnly ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"}`}
                  >Todos</button>
                  <button
                    type="button"
                    onClick={() => { updateQuery({ unassignedOnly: "1", assignedSellerEmail: null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${filters.unassignedOnly ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"}`}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Sem vendedor
                  </button>
                  <div className="my-1 border-t border-neutral-100" />
                  {commercial.sellers.map((s) => (
                    <button
                      key={s.chatwootUserId}
                      type="button"
                      onClick={() => { updateQuery({ assignedSellerEmail: s.email, unassignedOnly: null, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${filters.assignedSellerEmail === s.email ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ordenar */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "ordenar" ? null : "ordenar")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                orderBy !== "criado_em" || orderDirection !== "desc"
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {SORT_OPTIONS.find((o) => o.field === orderBy && o.dir === orderDirection)?.shortLabel ?? "Ordenar"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "ordenar" && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {SORT_OPTIONS.map((opt) => {
                  const active = orderBy === opt.field && orderDirection === opt.dir;
                  return (
                    <button
                      key={`${opt.field}-${opt.dir}`}
                      type="button"
                      onClick={() => { updateQuery({ orderBy: opt.field, orderDirection: opt.dir, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs transition hover:bg-neutral-50 ${
                        active ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      <span className="text-base leading-none">{opt.icon}</span>
                      <div className="min-w-0">
                        <p className="font-semibold">{opt.label}</p>
                        {opt.description && <p className={`text-[10px] ${active ? "text-neutral-300" : "text-neutral-400"}`}>{opt.description}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Clear all filters */}
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={() => updateQuery({ kind: null, treinamentos: null, presenca: null, tag: null, indicacao: null, campaignSource: null, campaignName: null, campaignTerm: null, commercialStage: null, assignedSellerEmail: null, unassignedOnly: null, stars: null, produto: null, page: "1" })}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-neutral-400 transition hover:bg-neutral-100 hover:text-rose-500"
            >
              <X className="h-3.5 w-3.5" />
              Limpar · {activeFiltersCount}
            </button>
          )}
        </div>
      </header>

      {isPending && (
        <div className="h-0.5 flex-shrink-0 bg-cyan-400" style={{ animation: "pulse 1s infinite" }} />
      )}

      {/* ── BANNER VozUP ───────────────────────────────────── */}
      {filters.produto === "vozup" && (
        <div className="flex-shrink-0 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-purple-50 px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">
              🎤 Voz UP
            </span>
            <span className="text-xs text-violet-600">
              Leads captados pelo Workshop e Landing Page da Voz UP. Novos leads da landing page devem ser distribuídos.
            </span>
            <a
              href="/distribuicao?produto=vozup&unassignedOnly=true"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
            >
              Distribuir leads Voz UP →
            </a>
          </div>
        </div>
      )}

      {/* ── MAIN SPLIT ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">

        {/* ── KANBAN VIEW ────────────────────────────────── */}
        {view === "kanban" && (
          <CrmKanbanView
            selectedId={selectedId}
            onSelectLead={setSelectedId}
            produto={filters.produto ?? null}
            assignedSellerEmail={filters.assignedSellerEmail || undefined}
            isSupervisor={commercial.isSupervisor}
          />
        )}

        {/* ── TABLE PANE ─────────────────────────────────── */}
        <div className={`${view === "kanban" ? "hidden" : ""} flex w-full flex-col border-r border-neutral-200`}>

          {/* Mobile cards */}
          <div className="flex-1 overflow-y-auto p-3 md:hidden">
            {records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 py-16 text-center text-sm text-neutral-400">
                Nenhum lead encontrado.
              </div>
            ) : records.map((lead) => {
              const pipe = pipelineFor(lead.status);
              const lastNote = lead.notes && lead.notes.length > 0 ? lead.notes[lead.notes.length - 1] : null;
              const isSelected = selectedId === lead.id;
              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : lead.id)}
                  className={`mb-2.5 w-full rounded-xl border bg-white p-3.5 text-left shadow-sm transition ${
                    isSelected ? "border-cyan-300 ring-2 ring-cyan-100" : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-bold text-neutral-600">
                      {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-neutral-900">{humanizeName(lead.nome) ?? "Sem nome"}</p>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${pipe.bg} ${pipe.color}`}>{pipe.label}</span>
                      </div>
                      {lead.telefone && <p className="text-xs text-neutral-400">{lead.telefone}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {getTrainingDisplay(lead) && (
                          <span className="rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">{getTrainingDisplay(lead)}</span>
                        )}
                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">{fmtRelative(lead.criadoEm)}</span>
                        {lead.notes && lead.notes.length > 0 && (
                          <span className="rounded-md bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">{lead.notes.length} obs.</span>
                        )}
                      </div>
                      {lastNote && (
                        <p className="mt-1.5 line-clamp-1 text-xs text-neutral-400">{lastNote.content}</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden flex-1 overflow-auto md:block">
            <table className="min-w-full">
              <thead className="sticky top-0 z-10 border-b border-neutral-100 bg-white">
                <tr>
                  {([
                    { key: "nome" as OrderableField, label: "Lead" },
                    { key: "criado_em" as OrderableField, label: "Data" },
                    { key: "treinamento" as OrderableField, label: "Treinamento" },
                    { key: "recrutador" as OrderableField, label: "Campanha" },
                  ] as const).map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="cursor-pointer px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400 hover:text-neutral-700"
                    >
                      {col.label}
                      {orderBy === col.key && <span className="ml-1 text-cyan-500">{orderDirection === "asc" ? "↑" : "↓"}</span>}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">Observações</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">Etapa</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-neutral-400">Temp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center text-sm text-neutral-400">
                      Nenhum lead encontrado.
                    </td>
                  </tr>
                ) : records.map((lead) => {
                  const isSelected = selectedId === lead.id;
                  const lastNote = lead.notes && lead.notes.length > 0 ? lead.notes[lead.notes.length - 1] : null;
                  const pipe = pipelineFor(lead.status);
                  const avatarBg = pipe.key === "aprovado" ? "bg-emerald-100 text-emerald-700" : pipe.key === "rejeitado" ? "bg-rose-100 text-rose-600" : "bg-neutral-100 text-neutral-600";
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(isSelected ? null : lead.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-cyan-50 ring-1 ring-inset ring-cyan-200" : "hover:bg-neutral-50/70"
                      }`}
                    >
                      {/* Lead */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg}`}>
                            {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-neutral-900 max-w-[160px]">
                              {humanizeName(lead.nome) ?? "Sem nome"}
                            </p>
                            {lead.telefone && (
                              <p className="text-[11px] text-neutral-400">{lead.telefone}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3 text-[11px] text-neutral-400 whitespace-nowrap">
                        {fmtRelative(lead.criadoEm)}
                      </td>
                      {/* Training */}
                      <td className="px-4 py-3">
                        {getTrainingDisplay(lead) ? (
                          <span className="inline-block max-w-[140px] truncate rounded-lg bg-neutral-900 px-2.5 py-1 text-[10px] font-bold text-white">
                            {getTrainingDisplay(lead)}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-300">—</span>
                        )}
                      </td>
                      {/* Campaign */}
                      <td className="px-4 py-3 max-w-[140px]">
                        <p className="truncate text-[11px] font-semibold text-neutral-700">
                          {lead.commercial?.campaignSource || humanizeName(lead.recrutadorNome) || "—"}
                        </p>
                        {lead.commercial?.campaignName && (
                          <p className="truncate text-[10px] text-neutral-400">{lead.commercial.campaignName}</p>
                        )}
                      </td>
                      {/* Observações */}
                      <td className="px-4 py-3">
                        {lastNote ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
                              {lead.notes!.length} OBS.
                            </span>
                            <p className="mt-0.5 max-w-[160px] truncate text-[10px] text-neutral-400">
                              {lastNote.content}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[10px] text-neutral-300">Sem observação</span>
                        )}
                      </td>
                      {/* Stage */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${COMMERCIAL_STAGE_STYLE[lead.commercial?.stage ?? "novo"].className}`}>
                          {COMMERCIAL_STAGE_STYLE[lead.commercial?.stage ?? "novo"].label}
                        </span>
                      </td>
                      {/* Stars */}
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm ${lead.stars ? "text-amber-400" : "text-neutral-200"}`}>
                          {"★".repeat(lead.stars ?? 0)}{"★".repeat(5 - (lead.stars ?? 0)).replace(/★/g, "☆")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-shrink-0 items-center justify-between border-t border-neutral-100 bg-white px-5 py-2.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="h-8 rounded-lg px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
              >← Anterior</button>
              <span className="text-xs text-neutral-400">Página {page} de {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                className="h-8 rounded-lg px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
              >Próxima →</button>
            </div>
          )}
        </div>

      </div>

      {/* ─ Perfil do lead (pop-up centralizado) ─ */}
      <LeadProfileModal
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={syncRecord}
        onDelete={(id: number) => {
          setRecords((prev) => prev.filter((r) => r.id !== id));
          setSelectedId(null);
        }}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
        commercial={commercial}
      />

      {/* ─ Merge modal (fora do layout) ─ */}
      {showMergeModal && selected && (
        <MergeLeadsModal
          primary={selected}
          onMerged={(updated) => {
            setRecords((prev) => prev.map((r) => r.id === updated.id ? { ...r, ...updated } : r));
            setShowMergeModal(false);
          }}
          onClose={() => setShowMergeModal(false)}
        />
      )}

      {/* ─ Create lead modal (fora do layout) ─ */}
      {showCreateModal && (
        <CreateLeadModal
          onCreated={({ inscricao }) => {
            setRecords((prev) =>
              prev.some((r) => r.id === inscricao.id)
                ? prev.map((r) => (r.id === inscricao.id ? { ...r, ...inscricao } : r))
                : [inscricao, ...prev]
            );
            setSelectedId(inscricao.id);
            setShowCreateModal(false);
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

/* ─── Small components ─── */

const filterSelectClass = "h-8 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-100";


