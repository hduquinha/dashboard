"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileSpreadsheet,
  FolderKanban,
  Loader2,
  MessageSquare,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import IconTile, { type IconTileTone } from "@/components/IconTile";
import Markdown from "../Markdown";
import type { ArchiveMonth, ArchiveSummary, ArchivedTaskRow } from "@/lib/tasksArchive";

const PAGE_SIZE = 60;

interface BoardOption {
  id: number;
  name: string;
  sectorName: string;
}

/** "2026-08" → "Agosto de 2026". */
function monthLabel(month: string): string {
  const date = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  const text = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "2026-08-07" → "sex, 07/08". */
function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const PRIORITY_TONE: Record<string, string> = {
  urgente: "bg-rose-50 text-rose-700",
  alta: "bg-amber-50 text-amber-700",
  media: "bg-slate-100 text-slate-600",
  baixa: "bg-slate-100 text-slate-500",
};

function TaskRow({ task }: { task: ArchivedTaskRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(task.description?.trim()) || task.checklistTotal > 0 || task.commentCount > 0;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => hasDetail && setOpen((value) => !value)}
              className={`text-left font-semibold text-slate-900 ${hasDetail ? "hover:text-cyan-700" : "cursor-default"}`}
            >
              {task.title}
              {hasDetail && (
                <ChevronDown className={`ml-1 inline size-3.5 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
              )}
            </button>
            {task.dueTime && (
              <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-800">
                <Clock className="size-3" /> {task.dueTime}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.media}`}>
              {task.priority}
            </span>
            {!task.archived && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                ainda no quadro
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">
              {task.sectorName} · {task.boardName}
            </span>
            {task.columnName && (
              <>
                <span aria-hidden>·</span>
                <span>{task.columnName}</span>
              </>
            )}
            {task.assignees.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  <UserRound className="size-3" /> {task.assignees.join(", ")}
                </span>
              </>
            )}
            {task.checklistTotal > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  checklist {task.checklistDone}/{task.checklistTotal}
                </span>
              </>
            )}
            {task.commentCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="size-3" /> {task.commentCount}
                </span>
              </>
            )}
          </div>

          {open && task.description?.trim() && (
            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <Markdown source={task.description} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ArquivoClient({
  boards,
  months,
  members,
}: {
  boards: BoardOption[];
  months: ArchiveMonth[];
  members: Array<{ id: number; name: string }>;
}) {
  // Abre no mês mais recente que tem tarefa concluída; sem histórico, no atual.
  const [month, setMonth] = useState<string>(months[0]?.month ?? currentMonth());
  const [board, setBoard] = useState("");
  const [member, setMember] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<ArchivedTaskRow[]>([]);
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const buildParams = useCallback(
    (offset: number, withSummary: boolean) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (month) params.set("month", month);
      if (board) params.set("board", board);
      if (member) params.set("member", member);
      if (search) params.set("q", search);
      if (withSummary) params.set("summary", "1");
      return params;
    },
    [board, member, month, search]
  );

  const loadFirstPage = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/archive?${buildParams(0, true).toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (current !== requestId.current) return;
      if (!response.ok || data.error) throw new Error(data.error || "Falha ao carregar o arquivo.");
      setTasks(data.tasks ?? []);
      setSummary(data.summary ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch (loadError) {
      if (current === requestId.current) {
        setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o arquivo.");
      }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/tasks/archive?${buildParams(tasks.length, false).toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Falha ao carregar mais tarefas.");
      setTasks((current) => [...current, ...(data.tasks ?? [])]);
      setHasMore(Boolean(data.hasMore));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar mais tarefas.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Agrupa por dia da conclusão: o relato do time é diário, e ler o mês em
  // blocos de dia é o que devolve a rotina que aconteceu.
  const byDay = useMemo(() => {
    const groups = new Map<string, ArchivedTaskRow[]>();
    for (const task of tasks) {
      const list = groups.get(task.completedDay);
      if (list) list.push(task);
      else groups.set(task.completedDay, [task]);
    }
    return [...groups.entries()];
  }, [tasks]);

  const csvHref = `/api/tasks/archive?${buildParams(0, false).toString()}&format=csv`;
  const activeFilters = (board ? 1 : 0) + (member ? 1 : 0) + (search ? 1 : 0);
  const topMembers = (summary?.byMember ?? []).slice(0, 8);
  const maxMember = topMembers[0]?.count ?? 0;

  const metrics = [
    { label: "Concluídas no mês", value: summary?.total ?? 0, icon: CheckCircle2, tone: "teal" as IconTileTone },
    { label: "No arquivo", value: summary?.archived ?? 0, icon: Archive, tone: "amber" as IconTileTone },
    { label: "Ainda no quadro", value: summary?.onBoard ?? 0, icon: FolderKanban, tone: "brand" as IconTileTone },
    { label: "Pessoas", value: (summary?.byMember ?? []).filter((item) => item.memberId !== null).length, icon: Users, tone: "slate" as IconTileTone },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/tarefas" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-cyan-700">
            <ArrowLeft className="size-3.5" /> Voltar para tarefas
          </a>
          <h1 className="text-xl font-bold tracking-tight text-slate-950">Arquivo mensal de tarefas</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tudo que foi concluído, mês a mês. Na virada do mês as tarefas concluídas saem do kanban sozinhas e ficam
            guardadas aqui.
          </p>
        </div>
        <a
          href={csvHref}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          <FileSpreadsheet className="size-4 text-emerald-600" /> Baixar planilha do mês
        </a>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
          <CalendarDays className="size-4 text-cyan-700" /> Mês
        </div>
        {months.length === 0 ? (
          <p className="text-sm text-slate-500">Ainda não há tarefa concluída registrada.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {months.map((item) => (
              <button
                key={item.month}
                type="button"
                onClick={() => setMonth(item.month)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${
                  month === item.month
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {monthLabel(item.month)}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    month === item.month ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.total}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <IconTile icon={Icon} tone={metric.tone} size="md" />
                <strong className="text-2xl font-black tracking-tight text-slate-950">{metric.value}</strong>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Search className="size-4 text-cyan-700" /> Filtros
          </div>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setBoard("");
                setMember("");
                setSearchInput("");
                setSearch("");
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              <X className="size-3.5" /> Limpar filtros ({activeFilters})
            </button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Quadro
            <select
              value={board}
              onChange={(event) => setBoard(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              <option value="">Todos os quadros</option>
              {boards.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sectorName} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Responsável
            <select
              value={member}
              onChange={(event) => setMember(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              <option value="">Todas as pessoas</option>
              {members.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <form
            className="grid gap-1 text-xs font-semibold text-slate-600"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            Buscar tarefa
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Título ou descrição"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm font-normal text-slate-800 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
            </div>
          </form>
        </div>
      </section>

      {topMembers.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
            <Users className="size-4 text-violet-700" /> Entregas por pessoa
          </h2>
          <ul className="space-y-2">
            {topMembers.map((item) => (
              <li key={`${item.memberId ?? "sem"}`} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm font-semibold text-slate-700">{item.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-cyan-500"
                    style={{ width: `${maxMember > 0 ? Math.round((item.count / maxMember) * 100) : 0}%` }}
                  />
                </span>
                <strong className="w-10 shrink-0 text-right text-sm font-black text-slate-900">{item.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-bold text-slate-900">{monthLabel(month)}</h2>
          {!loading && <span className="text-xs text-slate-500">{tasks.length} tarefa(s) exibida(s)</span>}
        </div>
        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Carregando o arquivo…
          </div>
        ) : error ? (
          <div className="p-5">
            <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>
            <button
              type="button"
              onClick={() => void loadFirstPage()}
              className="mt-3 text-sm font-semibold text-cyan-700 hover:underline"
            >
              Tentar novamente
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
            <Archive className="size-9 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-700">Nenhuma tarefa concluída neste mês</p>
            <p className="mt-1 text-sm text-slate-500">Troque o mês ou limpe os filtros.</p>
          </div>
        ) : (
          <>
            {byDay.map(([day, items]) => (
              <div key={day}>
                <div className="flex items-center justify-between gap-2 bg-slate-50 px-4 py-2 sm:px-5">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">{dayLabel(day)}</span>
                  <span className="text-xs text-slate-400">{items.length}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {items.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </ul>
              </div>
            ))}
            {hasMore && (
              <div className="border-t border-slate-100 p-3 text-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Carregar
                  mais
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
