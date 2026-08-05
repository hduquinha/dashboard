"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Archive,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ClipboardPenLine,
  FileText,
  Filter,
  FolderKanban,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Tag,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { TaskAuditEvent, TaskAuditFilterOptions, TaskAuditSummary } from "@/lib/tasksAudit";

type PeriodPreset = "hoje" | "7d" | "30d" | "90d" | "tudo" | "custom";

const PAGE_SIZE = 50;

const PERIODS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "tudo", label: "Todo o histórico" },
  { key: "custom", label: "Personalizado" },
];

const ACTION_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  card_created: { label: "Card criado", icon: Plus, tone: "bg-emerald-50 text-emerald-700" },
  card_updated: { label: "Card atualizado", icon: ClipboardPenLine, tone: "bg-blue-50 text-blue-700" },
  card_moved: { label: "Card movido", icon: ArrowRight, tone: "bg-violet-50 text-violet-700" },
  card_completed: { label: "Card concluído", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
  card_archived: { label: "Card arquivado", icon: Archive, tone: "bg-amber-50 text-amber-700" },
  card_restored: { label: "Card restaurado", icon: Archive, tone: "bg-cyan-50 text-cyan-700" },
  card_deleted: { label: "Card excluído", icon: X, tone: "bg-rose-50 text-rose-700" },
  comment_added: { label: "Comentário adicionado", icon: MessageSquare, tone: "bg-sky-50 text-sky-700" },
  checklist_created: { label: "Checklist criada", icon: CheckSquare, tone: "bg-indigo-50 text-indigo-700" },
  checklist_item_done: { label: "Item de checklist concluído", icon: CheckSquare, tone: "bg-emerald-50 text-emerald-700" },
  attachment_added: { label: "Anexo adicionado", icon: Paperclip, tone: "bg-slate-100 text-slate-700" },
  members_changed: { label: "Responsáveis atualizados", icon: Users, tone: "bg-blue-50 text-blue-700" },
  labels_changed: { label: "Etiquetas atualizadas", icon: Tag, tone: "bg-fuchsia-50 text-fuchsia-700" },
  custom_fields_changed: { label: "Campos personalizados atualizados", icon: FileText, tone: "bg-cyan-50 text-cyan-700" },
  automation_ran: { label: "Automação executada", icon: Activity, tone: "bg-violet-50 text-violet-700" },
  automation_scheduled: { label: "Automação agendada executada", icon: CalendarDays, tone: "bg-violet-50 text-violet-700" },
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolvePeriod(preset: PeriodPreset, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  if (preset === "tudo") return { from: null, to: null };
  if (preset === "custom") return { from: customFrom || null, to: customTo || null };

  const today = new Date();
  const to = isoDate(today);
  if (preset === "hoje") return { from: to, to };

  const days = preset === "7d" ? 6 : preset === "30d" ? 29 : 89;
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: isoDate(from), to };
}

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data indisponível";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)}h`;
  if (minutes < 43_200) return `há ${Math.floor(minutes / 1440)}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fullDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "sem valor";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (Array.isArray(value)) return value.length ? `${value.length} item(ns)` : "nenhum item";
  return String(value);
}

function eventDetail(event: TaskAuditEvent): string | null {
  if (event.action === "card_moved") {
    return `De ${event.fromColumnName || "sem coluna"} para ${event.toColumnName || "sem coluna"}.`;
  }

  if (event.action === "card_updated") {
    const changes = Object.entries(event.detail)
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
      .map(([field, value]) => {
        const change = value as { de?: unknown; para?: unknown };
        return `${field}: ${humanValue(change.de)} → ${humanValue(change.para)}`;
      });
    return changes.length ? changes.join(" · ") : "Dados do card atualizados.";
  }

  if (event.action === "card_created" && event.detail.fromTemplate) return "Criado a partir de um modelo.";
  if (event.action === "attachment_added" && event.detail.name) {
    return `${event.detail.link ? "Link" : "Arquivo"}: ${String(event.detail.name)}.`;
  }
  if (event.action === "checklist_created" && event.detail.name) return `Checklist: ${String(event.detail.name)}.`;
  if (event.action === "card_deleted") return "O card foi removido definitivamente.";
  if (event.action === "members_changed") return "Os responsáveis pelo card foram atualizados.";
  if (event.action === "labels_changed") return "As etiquetas do card foram atualizadas.";
  if (event.action === "custom_fields_changed") return "Os campos personalizados foram atualizados.";
  return null;
}

function EventRow({ event }: { event: TaskAuditEvent }) {
  const meta = ACTION_META[event.action] ?? { label: event.action, icon: Activity, tone: "bg-slate-100 text-slate-700" };
  const Icon = meta.icon;
  const detail = eventDetail(event);

  return (
    <li className="flex gap-3 px-4 py-4 sm:px-5">
      <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-semibold text-slate-900">{meta.label}</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {event.sectorName} · {event.boardName}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-cyan-800" title={event.taskTitle}>
          {event.taskTitle}
        </p>
        {detail && <p className="mt-1 text-sm leading-5 text-slate-600">{detail}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>por {event.actorName || event.actorEmail || "sistema"}</span>
          <span aria-hidden>·</span>
          <time title={fullDate(event.createdAt)}>{when(event.createdAt)}</time>
          {event.taskId && (
            <a href={`/tarefas?board=${event.boardId}&card=${event.taskId}`} className="font-semibold text-cyan-700 hover:underline">
              Abrir card
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

export default function TaskAuditClient({ options }: { options: TaskAuditFilterOptions }) {
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [board, setBoard] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<TaskAuditEvent[]>([]);
  const [summary, setSummary] = useState<TaskAuditSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const buildParams = useCallback(
    (offset: number, withSummary: boolean) => {
      const { from, to } = resolvePeriod(preset, customFrom, customTo);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (board) params.set("board", board);
      if (action) params.set("actions", action);
      if (actor) params.set("actor", actor);
      if (search) params.set("q", search);
      if (withSummary) params.set("summary", "1");
      return params;
    },
    [action, actor, board, customFrom, customTo, preset, search]
  );

  const loadFirstPage = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/audit?${buildParams(0, true).toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (currentRequest !== requestId.current) return;
      if (!response.ok || data.error) throw new Error(data.error || "Falha ao carregar a auditoria.");
      setEvents(data.events ?? []);
      setSummary(data.summary ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch (loadError) {
      if (currentRequest === requestId.current) setError(loadError instanceof Error ? loadError.message : "Falha ao carregar a auditoria.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/tasks/audit?${buildParams(events.length, false).toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Falha ao carregar mais eventos.");
      setEvents((current) => [...current, ...(data.events ?? [])]);
      setHasMore(Boolean(data.hasMore));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar mais eventos.");
    } finally {
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setPreset("30d");
    setCustomFrom("");
    setCustomTo("");
    setBoard("");
    setAction("");
    setActor("");
    setSearchInput("");
    setSearch("");
  }

  const activeFilters = (preset !== "30d" ? 1 : 0) + (board ? 1 : 0) + (action ? 1 : 0) + (actor ? 1 : 0) + (search ? 1 : 0);
  const metrics = [
    { label: "Eventos", value: summary?.totalEvents ?? 0, icon: Activity, tone: "text-cyan-700 bg-cyan-50" },
    { label: "Cards afetados", value: summary?.cardsAffected ?? 0, icon: ClipboardPenLine, tone: "text-blue-700 bg-blue-50" },
    { label: "Quadros", value: summary?.boardsAffected ?? 0, icon: FolderKanban, tone: "text-violet-700 bg-violet-50" },
    { label: "Pessoas ativas", value: summary?.activeActors ?? 0, icon: UserRound, tone: "text-emerald-700 bg-emerald-50" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/tarefas" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-cyan-700">
            <ArrowLeft className="size-3.5" /> Voltar para tarefas
          </a>
          <h1 className="text-xl font-bold tracking-tight text-slate-950">Registro de auditoria de tarefas</h1>
          <p className="mt-1 text-sm text-slate-600">Todas as mudanças registradas nos cards e quadros que você pode acessar.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800">
          <Activity className="size-4" /> Histórico consolidado
        </span>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className={`flex size-9 items-center justify-center rounded-xl ${metric.tone}`}><Icon className="size-4" /></span>
                <strong className="text-2xl font-black tracking-tight text-slate-950">{metric.value}</strong>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Filter className="size-4 text-cyan-700" /> Filtros</div>
          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900">
              <X className="size-3.5" /> Limpar filtros ({activeFilters})
            </button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Período
            <select value={preset} onChange={(event) => setPreset(event.target.value as PeriodPreset)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100">
              {PERIODS.map((period) => <option key={period.key} value={period.key}>{period.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Quadro
            <select value={board} onChange={(event) => setBoard(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100">
              <option value="">Todos os quadros</option>
              {options.boards.map((item) => <option key={item.id} value={item.id}>{item.sectorName} · {item.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Ação
            <select value={action} onChange={(event) => setAction(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100">
              <option value="">Todas as ações</option>
              {options.actions.map((item) => <option key={item} value={item}>{ACTION_META[item]?.label ?? item}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Responsável pela ação
            <select value={actor} onChange={(event) => setActor(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100">
              <option value="">Todas as pessoas</option>
              {options.actors.map((item) => <option key={item.email} value={item.email}>{item.name}</option>)}
            </select>
          </label>
          <form
            className="grid gap-1 text-xs font-semibold text-slate-600"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            Buscar card
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nome do card" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100" />
            </div>
          </form>
        </div>
        {preset === "custom" && (
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-600">De<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400" /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">Até<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400" /></label>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-bold text-slate-900">Linha do tempo</h2>
          {!loading && <span className="text-xs text-slate-500">{events.length} evento(s) exibido(s)</span>}
        </div>
        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando auditoria…</div>
        ) : error ? (
          <div className="p-5"><p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p><button type="button" onClick={() => void loadFirstPage()} className="mt-3 text-sm font-semibold text-cyan-700 hover:underline">Tentar novamente</button></div>
        ) : events.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center"><Activity className="size-9 text-slate-300" /><p className="mt-3 font-semibold text-slate-700">Nenhuma ação encontrada</p><p className="mt-1 text-sm text-slate-500">Ajuste os filtros ou aguarde as próximas movimentações nos cards.</p></div>
        ) : (
          <>
            <ol className="divide-y divide-slate-100">{events.map((event) => <EventRow key={event.id} event={event} />)}</ol>
            {hasMore && <div className="border-t border-slate-100 p-3 text-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loadingMore && <Loader2 className="size-4 animate-spin" />} Carregar mais</button></div>}
          </>
        )}
      </section>
    </div>
  );
}
