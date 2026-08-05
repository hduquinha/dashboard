"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FolderKanban, LayoutGrid, Users } from "lucide-react";
import type { BoardData, TaskCard, TaskOverviewTask } from "@/lib/tasks";
import type { Member } from "./CardModal";

/**
 * As visões alternativas do quadro (Tabela, Calendário, Timeline, Dashboard e
 * Workspace). Todas leem a MESMA lista de cards já filtrada pelo cliente — se
 * cada visão refizesse o próprio filtro, o filtro do topo mentiria em uma
 * delas.
 */

const PRIORITY_COLOR: Record<string, string> = {
  baixa: "#94a3b8",
  media: "#3b82f6",
  alta: "#f59e0b",
  urgente: "#ef4444",
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtDay(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** completedAt é TIMESTAMPTZ (ISO), não uma data pura como due_date/start_date. */
function fmtStamp(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ── Tabela (visão de planilha) ───────────────────────────────────────────────

export function TableView({
  board,
  tasks,
  memberById,
  onOpen,
}: {
  board: BoardData;
  tasks: TaskCard[];
  memberById: Map<number, Member>;
  onOpen: (task: TaskCard) => void;
}) {
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: "due", asc: true });
  const columnName = (id: number | null) => board.columns.find((c) => c.id === id)?.name ?? "—";

  const sorted = useMemo(() => {
    const list = [...tasks];
    const dir = sort.asc ? 1 : -1;
    list.sort((a, b) => {
      switch (sort.key) {
        case "title":
          return a.title.localeCompare(b.title) * dir;
        case "column":
          return columnName(a.columnId).localeCompare(columnName(b.columnId)) * dir;
        case "priority": {
          const order = ["baixa", "media", "alta", "urgente"];
          return (order.indexOf(a.priority) - order.indexOf(b.priority)) * dir;
        }
        default:
          return ((a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")) * dir;
      }
    });
    return list;
    // columnName depende de board, que já está nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sort, board]);

  const header = (key: string, label: string) => (
    <th
      onClick={() => setSort((cur) => ({ key, asc: cur.key === key ? !cur.asc : true }))}
      className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500 hover:text-slate-900"
    >
      {label} {sort.key === key ? (sort.asc ? "▲" : "▼") : ""}
    </th>
  );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              {header("title", "Tarefa")}
              {header("column", "Coluna")}
              {header("priority", "Prioridade")}
              {header("due", "Prazo")}
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Concluída em</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Responsáveis</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Etiquetas</th>
              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">Checklist</th>
              {board.customFields.map((field) => (
                <th key={field.id} className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((task) => (
              <tr
                key={task.id}
                onClick={() => onOpen(task)}
                className="cursor-pointer border-b border-slate-100 transition hover:bg-cyan-50/50"
              >
                <td className="px-3 py-2 font-bold text-slate-800">
                  {task.completedAt && <span className="mr-1 text-emerald-600">✓</span>}
                  {task.title}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{columnName(task.columnId)}</td>
                <td className="px-3 py-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-black text-white"
                    style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}
                  >
                    {task.priority}
                  </span>
                </td>
                <td className={`whitespace-nowrap px-3 py-2 ${task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && !task.completedAt ? "font-bold text-rose-600" : "text-slate-600"}`}>
                  {fmtDay(task.dueDate)}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 ${task.completedAt ? "font-semibold text-emerald-700" : "text-slate-400"}`}>
                  {fmtStamp(task.completedAt)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {task.assigneeIds.map((id) => memberById.get(id)?.name.split(" ")[0]).filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {task.labelIds.map((id) => {
                      const label = board.labels.find((l) => l.id === id);
                      return label ? (
                        <span key={id} className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: label.color }}>
                          {label.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                  {task.checklistTotal > 0 ? `${task.checklistDone}/${task.checklistTotal}` : "—"}
                </td>
                {board.customFields.map((field) => (
                  <td key={field.id} className="px-3 py-2 text-xs text-slate-600">
                    {task.customValues?.[field.id] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8 + board.customFields.length} className="px-3 py-8 text-center text-sm text-slate-400">
                  Nenhuma tarefa com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Calendário ───────────────────────────────────────────────────────────────

export function CalendarView({
  tasks,
  board,
  onOpen,
}: {
  tasks: TaskCard[];
  board: BoardData;
  onOpen: (task: TaskCard) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY_MS));
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, TaskCard[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      map.set(task.dueDate, [...(map.get(task.dueDate) ?? []), task]);
    }
    return map;
  }, [tasks]);

  const today = new Date().toISOString().slice(0, 10);
  const noDue = tasks.filter((task) => !task.dueDate);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h3 className="text-sm font-black capitalize text-slate-800">
          {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </h3>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          Hoje
        </button>
        {noDue.length > 0 && (
          <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
            {noDue.length} sem prazo (não aparecem no calendário)
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-1.5 text-center text-[10px] font-black uppercase text-slate-500">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, index) => {
            const iso = date.toISOString().slice(0, 10);
            const items = byDay.get(iso) ?? [];
            const outside = date.getMonth() !== cursor.getMonth();
            return (
              <div
                key={index}
                className={`min-h-24 border-b border-r border-slate-100 p-1 ${outside ? "bg-slate-50/60" : ""} ${
                  iso === today ? "bg-cyan-50/70 ring-1 ring-inset ring-cyan-300" : ""
                }`}
              >
                <p className={`mb-0.5 text-[10px] font-bold ${outside ? "text-slate-300" : "text-slate-500"}`}>
                  {date.getDate()}
                </p>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((task) => {
                    const label = board.labels.find((l) => task.labelIds.includes(l.id));
                    return (
                      <button
                        key={task.id}
                        onClick={() => onOpen(task)}
                        style={{ borderLeftColor: label?.color ?? PRIORITY_COLOR[task.priority] }}
                        className={`block w-full truncate rounded border-l-4 bg-white px-1 py-0.5 text-left text-[10px] font-bold shadow-sm hover:bg-slate-50 ${
                          task.completedAt ? "text-slate-400 line-through" : "text-slate-700"
                        }`}
                      >
                        {task.title}
                      </button>
                    );
                  })}
                  {items.length > 3 && <p className="px-1 text-[9px] font-bold text-slate-400">+{items.length - 3}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Timeline (Gantt) ─────────────────────────────────────────────────────────

export function TimelineView({
  tasks,
  board,
  memberById,
  onOpen,
}: {
  tasks: TaskCard[];
  board: BoardData;
  memberById: Map<number, Member>;
  onOpen: (task: TaskCard) => void;
}) {
  // Mantém a referência de "agora" estável durante a sessão da visualização,
  // evitando que uma renderização intermediária desloque a linha de hoje.
  const [timelineNow] = useState(() => new Date().getTime());
  // Cada card vira uma barra do início até o prazo. Sem data de início a barra
  // é o próprio dia do prazo — melhor um traço no dia certo do que sumir.
  const rows = useMemo(
    () =>
      tasks
        .filter((task) => task.dueDate || task.startDate)
        .map((task) => {
          const end = task.dueDate ?? task.startDate!;
          const start = task.startDate ?? end;
          return { task, start: start <= end ? start : end, end: start <= end ? end : start };
        })
        .sort((a, b) => a.start.localeCompare(b.start)),
    [tasks]
  );

  const bounds = useMemo(() => {
    if (rows.length === 0) return null;
    const min = rows.reduce((acc, row) => (row.start < acc ? row.start : acc), rows[0].start);
    const max = rows.reduce((acc, row) => (row.end > acc ? row.end : acc), rows[0].end);
    const from = new Date(`${min}T00:00:00`).getTime() - DAY_MS;
    const to = new Date(`${max}T00:00:00`).getTime() + DAY_MS;
    return { from, to, days: Math.max(1, Math.round((to - from) / DAY_MS)) };
  }, [rows]);

  if (!bounds) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Nenhuma tarefa com data — defina início ou prazo para ver a linha do tempo.
      </div>
    );
  }

  const todayOffset = ((timelineNow - bounds.from) / (bounds.to - bounds.from)) * 100;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="min-w-[720px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative mb-2 flex justify-between border-b border-slate-100 pb-1 text-[10px] font-bold text-slate-400">
          <span>{fmtDay(new Date(bounds.from).toISOString().slice(0, 10))}</span>
          <span>{bounds.days} dias</span>
          <span>{fmtDay(new Date(bounds.to).toISOString().slice(0, 10))}</span>
        </div>
        <div className="relative space-y-1.5">
          {todayOffset >= 0 && todayOffset <= 100 && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400"
              style={{ left: `calc(220px + (100% - 220px) * ${todayOffset / 100})` }}
            />
          )}
          {rows.map(({ task, start, end }) => {
            const left = ((new Date(`${start}T00:00:00`).getTime() - bounds.from) / (bounds.to - bounds.from)) * 100;
            const width = Math.max(
              1.5,
              ((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime() + DAY_MS) /
                (bounds.to - bounds.from)) *
                100
            );
            const label = board.labels.find((l) => task.labelIds.includes(l.id));
            return (
              <div key={task.id} className="flex items-center gap-2">
                <button
                  onClick={() => onOpen(task)}
                  className="w-[212px] flex-shrink-0 truncate text-left text-xs font-bold text-slate-700 hover:text-cyan-700"
                  title={task.title}
                >
                  {task.title}
                  <span className="ml-1 font-medium text-slate-400">
                    {task.assigneeIds.map((id) => memberById.get(id)?.name.split(" ")[0]).filter(Boolean).join(", ")}
                  </span>
                </button>
                <div className="relative h-5 flex-1 rounded bg-slate-50">
                  <button
                    onClick={() => onOpen(task)}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: label?.color ?? PRIORITY_COLOR[task.priority],
                    }}
                    className={`absolute inset-y-0 rounded px-1 text-left text-[9px] font-black text-white transition hover:brightness-110 ${
                      task.completedAt ? "opacity-40" : ""
                    }`}
                    title={`${fmtDay(start)} → ${fmtDay(end)}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard (gráficos) ─────────────────────────────────────────────────────

export function DashboardView({
  tasks,
  board,
  memberById,
}: {
  tasks: TaskCard[];
  board: BoardData;
  memberById: Map<number, Member>;
}) {
  const byColumn = board.columns.map((column) => ({
    name: column.name,
    total: tasks.filter((task) => task.columnId === column.id).length,
    color: column.color ?? "#64748b",
  }));

  const byPriority = (["urgente", "alta", "media", "baixa"] as const).map((priority) => ({
    name: priority,
    value: tasks.filter((task) => task.priority === priority).length,
  }));

  const byMember = useMemo(() => {
    const counts = new Map<number, { open: number; done: number }>();
    for (const task of tasks) {
      for (const id of task.assigneeIds) {
        const current = counts.get(id) ?? { open: 0, done: 0 };
        if (task.completedAt) current.done += 1;
        else current.open += 1;
        counts.set(id, current);
      }
    }
    return [...counts.entries()]
      .map(([id, value]) => ({ name: memberById.get(id)?.name.split(" ")[0] ?? `#${id}`, ...value }))
      .sort((a, b) => b.open + b.done - (a.open + a.done))
      .slice(0, 10);
  }, [tasks, memberById]);

  const today = new Date().toISOString().slice(0, 10);
  const done = tasks.filter((task) => task.completedAt).length;
  const overdue = tasks.filter((task) => task.dueDate && task.dueDate < today && !task.completedAt).length;
  const unassigned = tasks.filter((task) => task.assigneeIds.length === 0 && !task.completedAt).length;
  const rate = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Taxa de conclusão" value={`${rate}%`} tone="emerald" />
        <Kpi label="Em atraso" value={overdue} tone="rose" />
        <Kpi label="Sem responsável" value={unassigned} tone="amber" />
        <Kpi label="Total no quadro" value={tasks.length} tone="cyan" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Distribuição por coluna">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byColumn} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {byColumn.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Por prioridade">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byPriority} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {byPriority.map((entry) => (
                  <Cell key={entry.name} fill={PRIORITY_COLOR[entry.name]} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Produtividade por pessoa" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byMember} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="open" name="Em aberto" stackId="a" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
              <Bar dataKey="done" name="Concluídas" stackId="a" fill="#22c55e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone: "emerald" | "rose" | "amber" | "cyan" }) {
  const tones = {
    emerald: "text-emerald-700 bg-emerald-50",
    rose: "text-rose-700 bg-rose-50",
    amber: "text-amber-700 bg-amber-50",
    cyan: "text-cyan-700 bg-cyan-50",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 inline-block rounded-lg px-2 py-0.5 text-2xl font-black ${tones}`}>{value}</p>
    </div>
  );
}

function ChartCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${className}`}>
      <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

// ── Geral (todos os quadros) ─────────────────────────────────────────────────

const GENERAL_PRIORITY: Record<TaskOverviewTask["priority"], { label: string; className: string; order: number }> = {
  urgente: { label: "Urgente", className: "bg-rose-100 text-rose-700", order: 0 },
  alta: { label: "Alta", className: "bg-amber-100 text-amber-700", order: 1 },
  media: { label: "Média", className: "bg-blue-100 text-blue-700", order: 2 },
  baixa: { label: "Baixa", className: "bg-slate-100 text-slate-600", order: 3 },
};

function dueText(dueDate: string | null, today: string): { text: string; className: string; order: number } {
  if (!dueDate) return { text: "Sem prazo", className: "text-slate-400", order: 3 };
  if (dueDate < today) return { text: `Atrasada · ${fmtDay(dueDate)}`, className: "text-rose-700", order: 0 };
  if (dueDate === today) return { text: "Vence hoje", className: "text-amber-700", order: 1 };
  return { text: `Prazo · ${fmtDay(dueDate)}`, className: "text-slate-500", order: 2 };
}

/** Painel consolidado: mostra o que exige atenção em todos os quadros visíveis. */
export function GeneralView({
  boards,
  tasks,
  memberById,
  onOpenTask,
  onOpenBoard,
}: {
  boards: WorkspaceBoardItem[];
  tasks: TaskOverviewTask[];
  memberById: Map<number, Member>;
  onOpenTask: (task: TaskOverviewTask) => void;
  onOpenBoard: (boardId: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((task) => !task.completedAt);
  const overdue = openTasks.filter((task) => task.dueDate && task.dueDate < today).length;
  const dueToday = openTasks.filter((task) => task.dueDate === today).length;
  const unassigned = openTasks.filter((task) => task.assigneeIds.length === 0).length;
  const done = tasks.filter((task) => task.completedAt).length;

  const focusTasks = useMemo(
    () =>
      [...openTasks]
        .sort((a, b) => {
          const aDue = dueText(a.dueDate, today);
          const bDue = dueText(b.dueDate, today);
          if (aDue.order !== bDue.order) return aDue.order - bDue.order;
          if (GENERAL_PRIORITY[a.priority].order !== GENERAL_PRIORITY[b.priority].order) {
            return GENERAL_PRIORITY[a.priority].order - GENERAL_PRIORITY[b.priority].order;
          }
          return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
        })
        .slice(0, 8),
    [openTasks, today]
  );

  const sectors = useMemo(() => {
    const all = new Map<number, { id: number; name: string; color: string; open: number; done: number; overdue: number }>();
    for (const task of tasks) {
      const current = all.get(task.sectorId) ?? {
        id: task.sectorId,
        name: task.sectorName,
        color: task.sectorColor,
        open: 0,
        done: 0,
        overdue: 0,
      };
      if (task.completedAt) current.done += 1;
      else {
        current.open += 1;
        if (task.dueDate && task.dueDate < today) current.overdue += 1;
      }
      all.set(task.sectorId, current);
    }
    return [...all.values()].sort((a, b) => b.open + b.overdue - (a.open + a.overdue));
  }, [tasks, today]);

  const sortedBoards = useMemo(
    () => [...boards].sort((a, b) => b.overdueCount - a.overdueCount || b.openCount - a.openCount || a.name.localeCompare(b.name)),
    [boards]
  );

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">Painel Geral</p>
          <h2 className="text-lg font-black tracking-tight text-slate-900">Tudo o que precisa de atenção</h2>
          <p className="text-xs text-slate-500">Resumo dos quadros que você pode acessar.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          {boards.length} {boards.length === 1 ? "quadro" : "quadros"} · {tasks.length} {tasks.length === 1 ? "tarefa" : "tarefas"}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <GeneralKpi icon={<Clock3 />} label="Em aberto" value={openTasks.length} tone="cyan" />
        <GeneralKpi icon={<AlertTriangle />} label="Em atraso" value={overdue} tone="rose" />
        <GeneralKpi icon={<Clock3 />} label="Vencem hoje" value={dueToday} tone="amber" />
        <GeneralKpi icon={<Users />} label="Sem responsável" value={unassigned} tone="violet" />
        <GeneralKpi icon={<CheckCircle2 />} label="Concluídas" value={done} tone="emerald" />
      </div>

      {tasks.length === 0 ? (
        <div className="flex min-h-60 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-slate-400">
          <FolderKanban className="size-8" />
          <p className="text-sm font-semibold">Nenhuma tarefa ativa nos seus quadros.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:col-span-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-800">Foco do dia</h3>
                <p className="text-[11px] text-slate-400">Atrasadas, com prazo próximo e maior prioridade primeiro.</p>
              </div>
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">{overdue} atraso(s)</span>
            </div>
            <div className="divide-y divide-slate-100">
              {focusTasks.length === 0 && <p className="py-6 text-center text-sm font-semibold text-emerald-700">Tudo em dia por aqui.</p>}
              {focusTasks.map((task) => {
                const due = dueText(task.dueDate, today);
                const people = task.assigneeIds.map((id) => memberById.get(id)?.name.split(" ")[0]).filter(Boolean);
                return (
                  <button
                    key={task.id}
                    onClick={() => onOpenTask(task)}
                    className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-cyan-50/60"
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: task.sectorColor }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{task.title}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {task.sectorName} · {task.boardName}{task.columnName ? ` · ${task.columnName}` : ""}
                      </p>
                    </div>
                    <div className="hidden min-w-24 text-right sm:block">
                      <p className={`text-[11px] font-bold ${due.className}`}>{due.text}</p>
                      <p className="text-[10px] text-slate-400">{people.length > 0 ? people.join(", ") : "Sem responsável"}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${GENERAL_PRIORITY[task.priority].className}`}>
                      {GENERAL_PRIORITY[task.priority].label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:col-span-2">
            <h3 className="text-sm font-black text-slate-800">Ritmo por setor</h3>
            <p className="mb-3 text-[11px] text-slate-400">Pendências e entregas em cada área.</p>
            <div className="space-y-3">
              {sectors.map((sector) => {
                const total = sector.open + sector.done;
                const completion = total > 0 ? Math.round((sector.done / total) * 100) : 0;
                return (
                  <div key={sector.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 font-bold text-slate-700">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: sector.color }} />
                        <span className="truncate">{sector.name}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-slate-400">{sector.open} abertas · {completion}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${completion}%`, backgroundColor: sector.color }} />
                    </div>
                    {sector.overdue > 0 && <p className="mt-0.5 text-[10px] font-bold text-rose-600">{sector.overdue} em atraso</p>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:col-span-5">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-800">Quadros</h3>
                <p className="text-[11px] text-slate-400">Abra um quadro para organizar ou criar tarefas.</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedBoards.map((board) => (
                <button
                  key={board.id}
                  onClick={() => onOpenBoard(board.id)}
                  className="rounded-xl border border-slate-200 p-2.5 text-left transition hover:border-cyan-300 hover:bg-cyan-50/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: board.sectorColor }} />
                    <p className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{board.name}</p>
                  </div>
                  <p className="mt-0.5 truncate pl-4 text-[10px] font-semibold text-slate-400">{board.sectorName}</p>
                  <div className="mt-2 flex gap-1.5 text-[10px] font-black">
                    <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-700">{board.openCount} abertas</span>
                    {board.overdueCount > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">{board.overdueCount} atraso</span>}
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{board.doneCount} ok</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function GeneralKpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "cyan" | "rose" | "amber" | "violet" | "emerald" }) {
  const tones = {
    cyan: "bg-cyan-50 text-cyan-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    emerald: "bg-emerald-50 text-emerald-700",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className={`mb-2 inline-flex size-7 items-center justify-center rounded-lg ${tones}`}>{icon}</div>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}

// ── Workspace (vários quadros juntos) ────────────────────────────────────────

export interface WorkspaceBoardItem {
  id: number;
  sectorId: number;
  name: string;
  sectorName: string;
  sectorColor: string;
  openCount: number;
  overdueCount: number;
  doneCount: number;
}

export function WorkspaceView({
  boards,
  onOpenBoard,
}: {
  boards: WorkspaceBoardItem[];
  onOpenBoard: (boardId: number) => void;
}) {
  const bySector = useMemo(() => {
    const map = new Map<string, WorkspaceBoardItem[]>();
    for (const board of boards) {
      map.set(board.sectorName, [...(map.get(board.sectorName) ?? []), board]);
    }
    return [...map.entries()];
  }, [boards]);

  return (
    <div className="h-full space-y-5 overflow-auto p-4">
      {bySector.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
          <LayoutGrid className="size-8" />
          <p className="text-sm font-semibold">Nenhum quadro visível ainda.</p>
        </div>
      )}
      {bySector.map(([sector, items]) => (
        <section key={sector}>
          <div className="mb-2 flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: items[0]?.sectorColor }} />
            <h3 className="text-sm font-black text-slate-800">{sector}</h3>
            <span className="text-xs font-semibold text-slate-400">{items.length} quadro(s)</span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((board) => (
              <button
                key={board.id}
                onClick={() => onOpenBoard(board.id)}
                className="rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 text-cyan-600" />
                  <p className="truncate text-sm font-black text-slate-800">{board.name}</p>
                </div>
                <div className="mt-2 flex gap-1.5 text-[10px] font-black">
                  <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-700">{board.openCount} abertas</span>
                  {board.overdueCount > 0 && (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">{board.overdueCount} atrasadas</span>
                  )}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{board.doneCount} ok</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
