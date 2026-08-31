"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, RefreshCw, X } from "lucide-react";
import { pickAppointmentColumn } from "@/lib/scheduleStage";

export interface ScheduleTaskTarget {
  id: number;
  nome: string | null;
}

interface BoardOption {
  id: number;
  name: string;
  sectorName: string;
  columns: Array<{ id: number; name: string; completes: boolean }>;
}

interface ScheduleTaskModalProps {
  lead: ScheduleTaskTarget;
  /** Tarefa criada: o lead pode ficar em Agendado. */
  onCreated: () => void;
  /**
   * Desistiu de agendar. Quem chama **precisa** devolver o lead para a etapa
   * anterior — é o que garante que não exista lead em Agendado sem data.
   */
  onCancel: () => void;
}

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Cobrança da tarefa quando o lead entra em "Agendado".
 *
 * Regra da operação: agendamento sem data não existe. Por isso a data é
 * obrigatória e fechar o modal desfaz o movimento — o vendedor não consegue
 * deixar o lead parado em Agendado sem um compromisso marcado.
 *
 * Quando essa data vencer, a tarefa aparece em vermelho na agenda e o
 * `ScheduleOutcomeModal` cobra o que aconteceu.
 */
export function ScheduleTaskModal({ lead, onCreated, onCancel }: ScheduleTaskModalProps) {
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [title, setTitle] = useState(`Retorno do agendamento — ${lead.nome ?? `Lead #${lead.id}`}`);
  const [dueDate, setDueDate] = useState(isoInDays(1));
  const [dueTime, setDueTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBoards = useCallback(async () => {
    try {
      const response = await fetch(`/api/leads/${lead.id}/tasks`);
      const data = (await response.json().catch(() => ({}))) as { boards?: BoardOption[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar os quadros.");
      setBoards(data.boards ?? []);
      setBoardId(data.boards?.[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os quadros.");
    } finally {
      setLoading(false);
    }
  }, [lead.id]);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  async function submit() {
    if (!title.trim()) {
      setError("Escreva o que ficou combinado.");
      return;
    }
    if (!dueDate) {
      setError("A data é obrigatória — é ela que faz a cobrança aparecer depois.");
      return;
    }
    if (!boardId) {
      setError("Escolha o quadro onde a tarefa vai ficar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const board = boards.find((item) => item.id === boardId);
      // Compromisso nasce na coluna de lead do quadro (ver pickAppointmentColumn),
      // não no backlog de ideias do time.
      const column = pickAppointmentColumn(board?.columns ?? []);
      const response = await fetch(`/api/leads/${lead.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          boardId,
          columnId: column?.id ?? null,
          dueDate,
          dueTime: dueTime || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao criar a tarefa.");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar a tarefa.");
      setSaving(false);
    }
  }

  const inputClass =
    "rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-800 focus:border-cyan-400 focus:outline-none";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-6 py-4">
          <div className="flex items-start gap-2.5">
            <CalendarPlus className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-bold text-neutral-900">Quando é o compromisso?</p>
              <p className="text-xs text-neutral-400">
                {lead.nome ?? `Lead #${lead.id}`} foi para Agendado.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
            aria-label="Cancelar e voltar o lead"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Todo lead em Agendado precisa de uma tarefa com data. Se fechar sem criar, ele volta
            para a etapa anterior.
          </p>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              O que ficou combinado
            </label>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={`w-full ${inputClass}`}
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Data *
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Hora
              </label>
              <input
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                title="Com horário, o responsável recebe um lembrete na hora marcada"
                className={inputClass}
              />
            </div>
            {boards.length > 1 && (
              <div className="min-w-0 flex-1">
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Quadro
                </label>
                <select
                  value={boardId ?? ""}
                  onChange={(event) => setBoardId(Number(event.target.value))}
                  className={`w-full ${inputClass}`}
                >
                  {boards.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sectorName} · {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {!loading && boards.length === 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Você não tem acesso a nenhum quadro de tarefas — peça a um administrador para liberar
              um setor em /tarefas.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Cancelar movimento
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || loading || boards.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            Agendar
          </button>
        </div>
      </div>
    </div>
  );
}
