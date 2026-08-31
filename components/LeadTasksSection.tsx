"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  ScheduleOutcomeModal,
  type ScheduleOutcomeTarget,
} from "@/components/ScheduleOutcomeModal";
import { RescheduleTaskModal, type RescheduleTarget } from "@/components/RescheduleTaskModal";
import { isScheduledStage } from "@/lib/scheduleStage";

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
  bucket: "atrasada" | "hoje" | "proxima" | "sem_data" | "concluida";
}

interface BoardOption {
  id: number;
  name: string;
  sectorName: string;
  columns: Array<{ id: number; name: string; completes: boolean }>;
}

interface LeadTasksSectionProps {
  leadId: number;
  canManage: boolean;
  leadName?: string | null;
  /** Etapa comercial: em "Agendado", tarefa vencida cobra o resultado aqui também. */
  leadStage?: string | null;
  /**
   * O resultado do compromisso pode mover o lead (e, em "Fechou", pedir a
   * venda). A ficha precisa recarregar e abrir o registro da venda — este
   * componente não conhece nem um nem outro.
   */
  onLeadChanged?: (result: { opensSale: boolean }) => void;
}

/** Atalhos do dia a dia comercial — evitam digitar o mesmo título toda vez. */
const QUICK_TITLES = ["Retornar ligação", "Agendar consultoria", "Enviar proposta", "Confirmar presença"];

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatDate(value: string | null): string {
  if (!value) return "sem data";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

const BUCKET_STYLE: Record<AgendaTask["bucket"], { label: string; className: string }> = {
  atrasada: { label: "Atrasada", className: "bg-rose-50 text-rose-700" },
  hoje: { label: "Hoje", className: "bg-amber-50 text-amber-700" },
  proxima: { label: "Agendada", className: "bg-cyan-50 text-cyan-700" },
  sem_data: { label: "Sem data", className: "bg-neutral-100 text-neutral-500" },
  concluida: { label: "Concluída", className: "bg-emerald-50 text-emerald-700" },
};

/**
 * Tarefas e compromissos do lead. São tarefas do módulo /tarefas com este lead
 * vinculado — o que é criado aqui aparece no quadro escolhido e na agenda do
 * responsável, e o que muda lá muda aqui.
 */
export function LeadTasksSection({
  leadId,
  canManage,
  leadName = null,
  leadStage = null,
  onLeadChanged,
}: LeadTasksSectionProps) {
  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Compromisso vencido cujo resultado está sendo registrado (só faz sentido
  // com o lead em "Agendado" — ver `SCHEDULE_OUTCOME_DEFS`).
  const [outcomeTarget, setOutcomeTarget] = useState<ScheduleOutcomeTarget | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  const cobraResultado = isScheduledStage(leadStage);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [dueTime, setDueTime] = useState("");
  const [boardId, setBoardId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leads/${leadId}/tasks`);
      const data = (await response.json().catch(() => ({}))) as {
        tasks?: AgendaTask[];
        boards?: BoardOption[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar as tarefas.");
      setTasks(data.tasks ?? []);
      setBoards(data.boards ?? []);
      setBoardId((current) => current ?? data.boards?.[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar as tarefas.");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const board = useMemo(() => boards.find((item) => item.id === boardId) ?? null, [boards, boardId]);

  // Tarefa nova nasce sempre como "a fazer": a primeira coluna do quadro que não
  // seja de conclusão. Quem cria uma tarefa aqui está registrando algo pendente
  // — deixar escolher a etapa (inclusive "Concluído") só abria espaço para erro.
  // Mudar de etapa e concluir é papel da lista, logo acima.
  //
  // As colunas já vêm sem as arquivadas e ordenadas por posição
  // (`listColumnsForBoards`), então a primeira é de fato o começo do fluxo.
  const initialColumnId = useMemo(() => {
    if (!board) return null;
    const pending = board.columns.find((column) => !column.completes);
    return (pending ?? board.columns[0])?.id ?? null;
  }, [board]);

  async function submit() {
    if (!title.trim()) {
      setError("Escreva o que precisa ser feito.");
      return;
    }
    if (!boardId) {
      setError("Escolha o quadro onde a tarefa vai ficar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          boardId,
          columnId: initialColumnId,
          dueDate: dueDate || null,
          dueTime: dueTime || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao criar a tarefa.");
      setTitle("");
      setDueTime("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar a tarefa.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Exclusão definitiva — a mesma tarefa some do quadro em /tarefas.
   *
   * Para compromisso o aviso é outro: apagar deixa o lead em "Agendado" sem nada
   * marcado, que é o estado que a régua de agendamento existe para impedir. Reunião
   * que aconteceu (ou que o cliente furou) se resolve em "Registrar resultado".
   */
  async function deleteTask(task: { id: number; title: string; leadStage?: string | null }, compromisso: boolean) {
    const aviso = compromisso
      ? `Excluir o compromisso "${task.title}"?\n\nO lead continua em Agendado, mas sem compromisso marcado. Se a reunião já aconteceu ou foi desmarcada, use "Registrar resultado".`
      : `Excluir a tarefa "${task.title}"?\n\nEla some também do quadro em Tarefas. Não dá para desfazer.`;
    if (!window.confirm(aviso)) return;
    setError(null);
    try {
      const response = await fetch(`/api/tasks/agenda?taskId=${task.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir a tarefa.");
      await load();
      // A ficha precisa saber: sem compromisso, o lead em "Agendado" volta a ser
      // cobrado pela régua de agendamento. Nada de venda para abrir aqui.
      onLeadChanged?.({ opensSale: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir a tarefa.");
    }
  }

  async function patchTask(taskId: number, patch: { columnId?: number | null; completed?: boolean }) {
    setError(null);
    try {
      const response = await fetch("/api/tasks/agenda", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, ...patch }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar a tarefa.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar a tarefa.");
    }
  }

  const inputClass =
    "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-cyan-400 focus:outline-none";

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-1 py-3 text-xs text-slate-400">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando tarefas…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {tasks.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhuma tarefa para este lead ainda.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const style = BUCKET_STYLE[task.bucket];
            const taskBoard = boards.find((item) => item.id === task.boardId);
            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
              >
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${style.className}`}>
                  {style.label}
                </span>
                <span
                  className={`flex-1 truncate text-sm ${
                    task.completedAt ? "text-slate-400 line-through" : "font-semibold text-slate-900"
                  }`}
                >
                  {task.title}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {formatDate(task.dueDate)}
                  {task.dueTime ? ` · ${task.dueTime}` : ""}
                </span>

                {/* Fase = coluna do quadro onde a tarefa mora. Mudar aqui é a
                    mesma coisa que arrastar o card em /tarefas. */}
                {cobraResultado && !task.completedAt ? (
                  // Compromisso: a fase do quadro é automática (o resultado
                  // conclui e move o card), então o seletor só confundiria.
                  <span className="text-xs text-slate-400">Compromisso</span>
                ) : canManage && taskBoard && taskBoard.columns.length > 0 ? (
                  <select
                    value={task.columnId ?? ""}
                    onChange={(event) =>
                      patchTask(task.id, { columnId: event.target.value ? Number(event.target.value) : null })
                    }
                    className="rounded-lg border border-slate-200 px-1.5 py-1 text-xs text-slate-600 focus:border-cyan-400 focus:outline-none"
                  >
                    {taskBoard.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-slate-400">{task.columnName ?? "—"}</span>
                )}

                {/* Compromisso de lead em Agendado: em vez de só concluir, o
                    vendedor diz o que aconteceu e o lead se move sozinho. Vale
                    antes de vencer também — a reunião pode ter acontecido hoje
                    de manhã, ou o cliente já ter avisado que não vem. */}
                {canManage && cobraResultado && !task.completedAt && (
                  <button
                    type="button"
                    onClick={() =>
                      setOutcomeTarget({
                        leadId,
                        leadName,
                        taskId: task.id,
                        taskTitle: task.title,
                        dueDate: task.dueDate,
                      })
                    }
                    className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-rose-700"
                  >
                    Registrar resultado
                  </button>
                )}

                {/* Data de compromisso não muda no silêncio: o modal cobra se
                    foi o cliente que reagendou ou se foi engano no cadastro. */}
                {canManage && cobraResultado && !task.completedAt && task.dueDate && (
                  <button
                    type="button"
                    onClick={() =>
                      setRescheduleTarget({
                        leadId,
                        leadName,
                        taskId: task.id,
                        taskTitle: task.title,
                        dueDate: task.dueDate,
                        dueTime: task.dueTime,
                      })
                    }
                    className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                  >
                    Mudar data
                  </button>
                )}

                {canManage && !task.completedAt && !cobraResultado && (
                  <button
                    type="button"
                    onClick={() => patchTask(task.id, { completed: true })}
                    title="Marcar como concluída"
                    className="rounded-lg p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}

                {canManage && (
                  <button
                    type="button"
                    onClick={() => void deleteTask(task, cobraResultado)}
                    title="Excluir tarefa"
                    aria-label="Excluir tarefa"
                    className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && boards.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Você não tem acesso a nenhum quadro de tarefas — peça a um administrador para liberar um setor em /tarefas.
        </p>
      )}

      {canManage && boards.length > 0 && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </button>
      )}

      {canManage && showForm && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TITLES.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => setTitle(quick)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
              >
                {quick}
              </button>
            ))}
          </div>

          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="O que precisa ser feito?"
            className={`w-full ${inputClass}`}
          />

          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={inputClass}
            />
            <input
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              title="Horário — com ele o responsável recebe um lembrete na hora marcada"
              className={inputClass}
            />
            <select
              value={boardId ?? ""}
              onChange={(event) => setBoardId(Number(event.target.value))}
              className={inputClass}
            >
              {boards.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sectorName} · {item.name}
                </option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-slate-400">
            Entra como <strong className="font-semibold text-slate-500">a fazer</strong> e vai para a agenda de
            quem cuida deste lead. Com horário, ele recebe um lembrete na hora marcada. Para concluir, use a
            lista acima.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              Criar tarefa
            </button>
          </div>
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
            setOutcomeTarget(null);
            void load();
            onLeadChanged?.({ opensSale: Boolean(result.opensSale) });
          }}
        />
      )}
    </div>
  );
}
