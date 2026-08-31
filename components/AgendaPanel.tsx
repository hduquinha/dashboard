"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  ScheduleOutcomeModal,
  type ScheduleOutcomeTarget,
} from "@/components/ScheduleOutcomeModal";
import { RescheduleTaskModal, type RescheduleTarget } from "@/components/RescheduleTaskModal";
import { RegisterSaleModal, type RegisterSaleTarget } from "@/components/RegisterSaleModal";
import { isScheduledStage } from "@/lib/scheduleStage";
import { useAutoRefresh } from "@/components/useAutoRefresh";

interface AgendaTask {
  id: number;
  title: string;
  boardId: number;
  boardName: string;
  columnId: number | null;
  columnName: string | null;
  priority: string;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  createdAt: string | null;
  inscricaoId: number | null;
  leadName: string | null;
  leadPhone: string | null;
  leadMissing: boolean;
  /** Etapa comercial do lead — define se cabe cobrar o resultado do compromisso. */
  leadStage: string | null;
  assignees: string[];
  bucket: "atrasada" | "hoje" | "proxima" | "sem_data" | "concluida";
}

interface AgendaColumn {
  id: number;
  name: string;
  boardId: number;
  completes: boolean;
}

interface Agenda {
  tasks: AgendaTask[];
  columns: AgendaColumn[];
  counts: { atrasada: number; hoje: number; proxima: number; semData: number };
}

interface AgendaPanelProps {
  /** Abre a ficha do lead ao clicar na tarefa — mesma do Kanban. */
  onSelectLead?: (id: number) => void;
  /** Incrementar força recarregar (ex.: depois de criar tarefa na ficha). */
  refreshToken?: number;
  /**
   * O registro de um resultado move o lead de etapa — quem desenha o Kanban
   * precisa saber para refazer o board, senão o card fica visualmente parado
   * em Agendado mesmo já tendo mudado no banco.
   */
  onLeadChanged?: () => void;
}

const GROUPS: Array<{ bucket: AgendaTask["bucket"]; label: string; tone: string }> = [
  { bucket: "atrasada", label: "Atrasadas", tone: "text-rose-700" },
  { bucket: "hoje", label: "Hoje", tone: "text-amber-700" },
  { bucket: "proxima", label: "Próximas", tone: "text-cyan-700" },
  { bucket: "sem_data", label: "Sem data", tone: "text-neutral-500" },
];

/**
 * Prioridade nunca é comunicada só por cor: o rótulo em texto acompanha o
 * ponto colorido, para quem não distingue as cores continuar lendo a urgência.
 */
const PRIORITIES: Record<string, { label: string; dot: string; chip: string }> = {
  urgente: { label: "Urgente", dot: "bg-rose-600", chip: "bg-rose-50 text-rose-700" },
  alta: { label: "Alta", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700" },
  media: { label: "Média", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  baixa: { label: "Baixa", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
};

type FilterKey = "todas" | "atrasada" | "hoje" | "proxima" | "alta" | "media" | "baixa" | "concluida";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "atrasada", label: "Atrasadas" },
  { key: "hoje", label: "Hoje" },
  { key: "proxima", label: "Próximas" },
  { key: "alta", label: "Alta" },
  { key: "media", label: "Média" },
  { key: "baixa", label: "Baixa" },
  { key: "concluida", label: "Concluídas" },
];

function formatDate(value: string | null): string {
  if (!value) return "sem data";
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function priorityOf(value: string) {
  return PRIORITIES[value] ?? PRIORITIES.media;
}

function matchesFilter(task: AgendaTask, filter: FilterKey): boolean {
  if (filter === "todas") return task.bucket !== "concluida";
  if (filter === "concluida") return task.bucket === "concluida";
  if (filter === "alta") return task.bucket !== "concluida" && (task.priority === "alta" || task.priority === "urgente");
  if (filter === "media" || filter === "baixa") return task.bucket !== "concluida" && task.priority === filter;
  return task.bucket === filter;
}

/**
 * Agenda do vendedor espelhada em lista, ao lado do Kanban de leads.
 *
 * São as mesmas tarefas do módulo /tarefas atribuídas a ele — as de lead e as
 * do backlog do time —, agrupadas pelo que o dia exige: o que atrasou, o que é
 * de hoje e o que vem depois. A fase continua sendo a coluna do quadro, então
 * trocar pelo seletor aqui é a mesma operação de arrastar o card lá.
 *
 * Clicar na tarefa abre a ficha do lead, não os detalhes da tarefa: a lista
 * existe para o vendedor agir sobre a pessoa, e o que ele precisa é o
 * histórico e o WhatsApp dela — não os metadados do card.
 */
export function AgendaPanel({ onSelectLead, refreshToken, onLeadChanged }: AgendaPanelProps) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterKey>("todas");
  const [editingId, setEditingId] = useState<number | null>(null);
  // Compromisso vencido cujo resultado o vendedor está registrando.
  const [outcomeTarget, setOutcomeTarget] = useState<ScheduleOutcomeTarget | null>(null);
  // Compromisso cuja data está sendo trocada (com motivo obrigatório).
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  // Menu de ações e painel de detalhes, um por vez (a lista é densa demais para
  // deixar vários abertos).
  // Venda a registrar: "Fechou" leva o lead para Fechado e o valor é pedido na
  // hora, sem obrigar o vendedor a caçar o lead no board.
  const [saleLead, setSaleLead] = useState<RegisterSaleTarget | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [detailsId, setDetailsId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/tasks/agenda");
      const data = (await response.json().catch(() => ({}))) as { agenda?: Agenda; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar a agenda.");
      setAgenda(data.agenda ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  // A agenda se refaz sozinha: tarefa distribuída por outra pessoa, ou que
  // acabou de vencer, aparece sem F5. Pausa com modal aberto para não trocar a
  // lista debaixo do que o vendedor está respondendo.
  useAutoRefresh(() => void load(), {
    paused: Boolean(outcomeTarget || rescheduleTarget || saleLead || editingId || menuId),
  });

  const visible = useMemo(
    () => (agenda?.tasks ?? []).filter((task) => matchesFilter(task, filter)),
    [agenda, filter]
  );

  /**
   * Filtro por bucket ou por conclusão já é uma lista só — agrupar de novo por
   * bucket duplicaria o título. Só a visão "Todas" e as de prioridade mantêm os
   * grupos, que é onde eles ajudam a ler o dia.
   */
  const grouped = useMemo(() => {
    const agrupa = filter === "todas" || filter === "alta" || filter === "media" || filter === "baixa";
    if (!agrupa) return [{ bucket: filter, label: "", tone: "", tasks: visible }];
    return GROUPS.map((group) => ({
      ...group,
      tasks: visible.filter((task) => task.bucket === group.bucket),
    })).filter((group) => group.tasks.length > 0);
  }, [visible, filter]);

  const doneToday = useMemo(
    () => (agenda?.tasks ?? []).filter((task) => task.bucket === "concluida").length,
    [agenda]
  );

  async function patchTask(
    taskId: number,
    patch: {
      columnId?: number | null;
      completed?: boolean;
      dueDate?: string | null;
      dueTime?: string | null;
      priority?: string;
    }
  ) {
    setBusyId(taskId);
    try {
      const response = await fetch("/api/tasks/agenda", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, ...patch }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar a tarefa.");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar a tarefa.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Exclusão definitiva da tarefa, pela própria agenda.
   *
   * O aviso muda quando é compromisso de lead: apagar não é o mesmo que dizer o que
   * aconteceu, e o lead continua em "Agendado" — só que sem nada marcado, que é
   * exatamente o estado que a régua de agendamento existe para impedir. Para reunião
   * que aconteceu (ou que o cliente furou) o caminho é "Registrar resultado".
   */
  async function deleteTask(task: AgendaTask) {
    const compromisso = isScheduledStage(task.leadStage) && Boolean(task.inscricaoId);
    const aviso = compromisso
      ? `Excluir o compromisso "${task.title}"?\n\nO lead continua em Agendado, mas sem compromisso marcado — e vai voltar a ser cobrado. Se a reunião já aconteceu ou o cliente desmarcou, use "Registrar resultado".`
      : `Excluir a tarefa "${task.title}"?\n\nEla some também do quadro em Tarefas. Não dá para desfazer.`;
    if (!window.confirm(aviso)) return;

    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/agenda?taskId=${task.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir a tarefa.");
      setMenuId(null);
      setDetailsId(null);
      await load();
      onLeadChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir a tarefa.");
    } finally {
      setBusyId(null);
    }
  }

  const totalOpen = (agenda?.tasks ?? []).filter((task) => task.bucket !== "concluida").length;
  const overdue = agenda?.counts.atrasada ?? 0;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <CalendarClock className="h-4 w-4 text-neutral-400" />
        <span className="text-sm font-bold text-neutral-900">Minhas tarefas</span>
        {overdue > 0 && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
            {overdue} atrasada{overdue > 1 ? "s" : ""}
          </span>
        )}
        <span className="text-xs text-neutral-400">
          {totalOpen} em aberto
          {doneToday > 0 ? ` · ${doneToday} concluída${doneToday > 1 ? "s" : ""} hoje` : ""}
        </span>
        <span className="ml-auto text-neutral-400">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-neutral-100 px-4 py-3">
          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md bg-white px-2 py-1 font-semibold text-rose-700 hover:bg-rose-100"
              >
                Tentar de novo
              </button>
            </div>
          )}

          <div className="mb-3 flex flex-wrap gap-1">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                aria-pressed={filter === option.key}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  filter === option.key
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="flex items-center gap-2 py-2 text-xs text-neutral-400">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando…
            </p>
          ) : visible.length === 0 ? (
            <p className="py-2 text-xs text-neutral-400">
              {filter === "todas"
                ? "Você não possui tarefas pendentes. Tarefas criadas na ficha de um lead aparecem aqui."
                : "Nenhuma tarefa neste filtro."}
            </p>
          ) : (
            <div className="space-y-3">
              {grouped.map((group) => (
                <div key={group.bucket}>
                  {group.label && (
                    <p className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${group.tone}`}>
                      {group.label} · {group.tasks.length}
                    </p>
                  )}
                  <ul className="space-y-1.5">
                    {group.tasks.map((task) => {
                      const columns = (agenda?.columns ?? []).filter(
                        (column) => column.boardId === task.boardId
                      );
                      const priority = priorityOf(task.priority);
                      const atrasada = task.bucket === "atrasada";
                      const abrirLead = task.inscricaoId !== null && !task.leadMissing;
                      // Compromisso marcado que venceu: é aqui que o vendedor
                      // diz o que aconteceu e o lead sai de Agendado sozinho.
                      // Compromisso de agendamento em aberto. O resultado pode
                      // ser registrado ANTES de vencer (a reunião pode acontecer
                      // adiantada, ou o cliente avisar que não vem) — exigir o
                      // atraso era o que deixava o vendedor sem saída no dia.
                      const compromisso =
                        abrirLead && !task.completedAt && isScheduledStage(task.leadStage);

                      return (
                        <li
                          key={task.id}
                          className={`rounded-lg border px-2.5 py-1.5 ${
                            atrasada ? "border-rose-300 bg-rose-50/50" : "border-neutral-200"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`w-11 shrink-0 text-[11px] font-bold ${
                                atrasada ? "text-rose-700" : "text-neutral-700"
                              }`}
                            >
                              {task.dueTime ?? formatDate(task.dueDate)}
                            </span>

                            {/* O clique na tarefa leva ao lead — ver comentário do componente. */}
                            <button
                              type="button"
                              disabled={!abrirLead}
                              onClick={() => abrirLead && onSelectLead?.(task.inscricaoId as number)}
                              title={abrirLead ? "Abrir a ficha do lead" : undefined}
                              className={`min-w-0 flex-1 text-left ${abrirLead ? "cursor-pointer" : "cursor-default"}`}
                            >
                              <span className="flex items-center gap-1.5">
                                <span
                                  aria-hidden
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${priority.dot}`}
                                />
                                <span
                                  className={`truncate text-xs font-semibold text-neutral-900 ${
                                    abrirLead ? "hover:underline" : ""
                                  }`}
                                >
                                  {task.title}
                                </span>
                                {atrasada && (
                                  <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-700">
                                    Atrasada
                                  </span>
                                )}
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${priority.chip}`}
                                >
                                  {priority.label}
                                </span>
                              </span>

                              <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-neutral-500">
                                {task.leadMissing ? (
                                  <span className="flex items-center gap-1 text-amber-700">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    Lead #{task.inscricaoId} não encontrado
                                  </span>
                                ) : abrirLead ? (
                                  <span className="flex items-center gap-1 truncate text-cyan-700">
                                    <User className="h-2.5 w-2.5 shrink-0" />
                                    {task.leadName ?? `Lead #${task.inscricaoId}`}
                                    {task.leadPhone ? ` · ${task.leadPhone}` : ""}
                                  </span>
                                ) : (
                                  <span className="truncate">{task.boardName}</span>
                                )}
                                {task.dueDate && (
                                  // Compromisso sem a data à vista obriga a abrir
                                  // o editor só para lembrar quando é.
                                  <span className="shrink-0 text-neutral-500">
                                    · {formatDate(task.dueDate)}
                                    {task.dueTime ? ` ${task.dueTime}` : ""}
                                  </span>
                                )}
                                {task.assignees.length > 1 && (
                                  <span className="shrink-0 text-neutral-400">
                                    · {task.assignees.join(", ")}
                                  </span>
                                )}
                              </span>
                            </button>

                            {compromisso && (
                              <button
                                type="button"
                                onClick={() =>
                                  setOutcomeTarget({
                                    leadId: task.inscricaoId as number,
                                    leadName: task.leadName,
                                    taskId: task.id,
                                    taskTitle: task.title,
                                    dueDate: task.dueDate,
                                  })
                                }
                                title="Compareceu, deu bolo, remarcou, fechou…"
                                className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold ${
                                  atrasada
                                    ? "bg-rose-600 text-white hover:bg-rose-700"
                                    : "border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                                }`}
                              >
                                Registrar resultado
                              </button>
                            )}

                            {/* Menu da tarefa: o clique no texto abre o lead, então
                                tudo que é sobre a TAREFA (resultado, data, detalhes)
                                mora aqui — senão só a tarefa vencida tinha ação. */}
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={() => setMenuId(menuId === task.id ? null : task.id)}
                                aria-label="Ações da tarefa"
                                aria-expanded={menuId === task.id}
                                title="Ações da tarefa"
                                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>

                              {menuId === task.id && (
                                <>
                                  <button
                                    type="button"
                                    aria-hidden
                                    tabIndex={-1}
                                    onClick={() => setMenuId(null)}
                                    className="fixed inset-0 z-10 cursor-default"
                                  />
                                  <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                                    {compromisso && task.dueDate && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMenuId(null);
                                          setRescheduleTarget({
                                            leadId: task.inscricaoId as number,
                                            leadName: task.leadName,
                                            taskId: task.id,
                                            taskTitle: task.title,
                                            dueDate: task.dueDate,
                                            dueTime: task.dueTime,
                                          });
                                        }}
                                        className="block w-full px-3 py-2 text-left text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                                      >
                                        Mudar data/hora
                                        <span className="block text-[10px] font-normal text-neutral-400">
                                          Cliente reagendou ou erro de digitação
                                        </span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMenuId(null);
                                        setDetailsId(detailsId === task.id ? null : task.id);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                                    >
                                      {detailsId === task.id ? "Esconder detalhes" : "Ver detalhes da tarefa"}
                                    </button>
                                    {abrirLead && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMenuId(null);
                                          onSelectLead?.(task.inscricaoId as number);
                                        }}
                                        className="block w-full px-3 py-2 text-left text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                                      >
                                        Abrir ficha do lead
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Fase do quadro é assunto do módulo /tarefas. Num
                                compromisso ela só confundia o vendedor: quem move
                                o card para "Concluído" é o registro do resultado. */}
                            {!compromisso && columns.length > 0 && (
                              <select
                                value={task.columnId ?? ""}
                                disabled={busyId === task.id}
                                aria-label="Fase da tarefa"
                                onChange={(event) =>
                                  patchTask(task.id, {
                                    columnId: event.target.value ? Number(event.target.value) : null,
                                  })
                                }
                                className="max-w-[9rem] rounded-lg border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-600 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
                              >
                                {columns.map((column) => (
                                  <option key={column.id} value={column.id}>
                                    {column.name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {!compromisso && (
                            <button
                              type="button"
                              disabled={busyId === task.id}
                              onClick={() => setEditingId(editingId === task.id ? null : task.id)}
                              title="Editar prazo e prioridade"
                              aria-label="Editar prazo e prioridade"
                              className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
                            >
                              {editingId === task.id ? (
                                <X className="h-3.5 w-3.5" />
                              ) : (
                                <Pencil className="h-3.5 w-3.5" />
                              )}
                            </button>
                            )}

                            {!compromisso && (
                            <button
                              type="button"
                              disabled={busyId === task.id}
                              onClick={() => patchTask(task.id, { completed: task.bucket !== "concluida" })}
                              title={task.bucket === "concluida" ? "Reabrir" : "Marcar como concluída"}
                              aria-label={task.bucket === "concluida" ? "Reabrir tarefa" : "Marcar como concluída"}
                              className={`rounded-lg p-1 disabled:opacity-50 ${
                                task.bucket === "concluida"
                                  ? "text-emerald-600 hover:bg-neutral-100"
                                  : "text-neutral-400 hover:bg-emerald-50 hover:text-emerald-600"
                              }`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            )}

                            {/* Excluir fica VISÍVEL, ao lado do lápis e do check.
                                Dentro do menu "⋮" ninguém achava — e tarefa criada
                                errada (título trocado, lead errado, duplicada) é caso
                                de todo dia. Vale inclusive para compromisso, com o
                                aviso mais forte na confirmação. */}
                            <button
                              type="button"
                              disabled={busyId === task.id}
                              onClick={() => void deleteTask(task)}
                              title="Excluir tarefa"
                              aria-label="Excluir tarefa"
                              className="rounded-lg p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {detailsId === task.id && (
                            <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-[10px] text-neutral-600 sm:grid-cols-2">
                              <div className="sm:col-span-2">
                                <dt className="inline font-bold text-neutral-500">Tarefa: </dt>
                                <dd className="inline">{task.title}</dd>
                              </div>
                              <div>
                                <dt className="inline font-bold text-neutral-500">Quando: </dt>
                                <dd className="inline">
                                  {task.dueDate ? formatDate(task.dueDate) : "sem data"}
                                  {task.dueTime ? ` às ${task.dueTime}` : ""}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-bold text-neutral-500">Prioridade: </dt>
                                <dd className="inline">{priority.label}</dd>
                              </div>
                              <div>
                                <dt className="inline font-bold text-neutral-500">Quadro: </dt>
                                <dd className="inline">{task.boardName}</dd>
                              </div>
                              <div>
                                <dt className="inline font-bold text-neutral-500">Fase: </dt>
                                <dd className="inline">{task.columnName ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="inline font-bold text-neutral-500">Responsável: </dt>
                                <dd className="inline">
                                  {task.assignees.length > 0 ? task.assignees.join(", ") : "sem dono"}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-bold text-neutral-500">Lead: </dt>
                                <dd className="inline">
                                  {task.leadName ?? (task.inscricaoId ? `#${task.inscricaoId}` : "—")}
                                  {task.leadPhone ? ` · ${task.leadPhone}` : ""}
                                </dd>
                              </div>
                              {compromisso && (
                                <p className="flex items-center gap-1 text-[10px] text-amber-700 sm:col-span-2">
                                  <Info className="h-3 w-3 shrink-0" />
                                  Compromisso do lead: ao registrar o resultado, a tarefa é concluída
                                  e o card vai sozinho para a coluna de conclusão do quadro.
                                </p>
                              )}
                            </dl>
                          )}

                          {editingId === task.id && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2">
                              {compromisso ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(null);
                                    setRescheduleTarget({
                                      leadId: task.inscricaoId as number,
                                      leadName: task.leadName,
                                      taskId: task.id,
                                      taskTitle: task.title,
                                      dueDate: task.dueDate,
                                      dueTime: task.dueTime,
                                    });
                                  }}
                                  className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                                >
                                  Mudar data/hora ({task.dueDate ? formatDate(task.dueDate) : "sem data"}
                                  {task.dueTime ? ` ${task.dueTime}` : ""})
                                </button>
                              ) : (
                              <>
                              <label className="flex items-center gap-1 text-[10px] font-semibold text-neutral-500">
                                Data
                                <input
                                  type="date"
                                  defaultValue={task.dueDate ?? ""}
                                  disabled={busyId === task.id}
                                  onChange={(event) =>
                                    patchTask(task.id, { dueDate: event.target.value || null })
                                  }
                                  className="rounded-lg border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700 focus:border-cyan-400 focus:outline-none"
                                />
                              </label>
                              <label className="flex items-center gap-1 text-[10px] font-semibold text-neutral-500">
                                Hora
                                <input
                                  type="time"
                                  defaultValue={task.dueTime ?? ""}
                                  disabled={busyId === task.id || !task.dueDate}
                                  title={task.dueDate ? undefined : "Defina a data antes do horário."}
                                  onChange={(event) =>
                                    patchTask(task.id, { dueTime: event.target.value || null })
                                  }
                                  className="rounded-lg border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
                                />
                              </label>
                              </>
                              )}
                              <label className="flex items-center gap-1 text-[10px] font-semibold text-neutral-500">
                                Prioridade
                                <select
                                  defaultValue={task.priority}
                                  disabled={busyId === task.id}
                                  onChange={(event) => patchTask(task.id, { priority: event.target.value })}
                                  className="rounded-lg border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700 focus:border-cyan-400 focus:outline-none"
                                >
                                  <option value="urgente">Urgente</option>
                                  <option value="alta">Alta</option>
                                  <option value="media">Média</option>
                                  <option value="baixa">Baixa</option>
                                </select>
                              </label>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rescheduleTarget && (
        <RescheduleTaskModal
          target={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onSaved={() => {
            setRescheduleTarget(null);
            void load();
          }}
        />
      )}

      {outcomeTarget && (
        <ScheduleOutcomeModal
          target={outcomeTarget}
          onClose={() => setOutcomeTarget(null)}
          onSaved={(result) => {
            const lead = { id: outcomeTarget.leadId, nome: outcomeTarget.leadName };
            setOutcomeTarget(null);
            void load();
            // O lead mudou de etapa: o board tem que ser refeito, senão o card
            // continua desenhado em Agendado.
            onLeadChanged?.();
            // "Fechou" abre o registro da venda na sequência — é o mesmo modal
            // que o Kanban abre quando o card cai em Fechado.
            if (result.opensSale) setSaleLead(lead);
          }}
        />
      )}

      {saleLead && (
        <RegisterSaleModal
          lead={saleLead}
          // O lead acabou de ir para Fechado pelo resultado do compromisso: sem
          // a venda ele fica ganho sem matrícula.
          required
          onCancel={() => setSaleLead(null)}
          onSaved={() => {
            setSaleLead(null);
            onLeadChanged?.();
          }}
        />
      )}
    </section>
  );
}
