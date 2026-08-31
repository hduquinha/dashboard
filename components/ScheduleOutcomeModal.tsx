"use client";

import { useState } from "react";
import { CalendarCheck, RefreshCw, X } from "lucide-react";
import {
  pickAppointmentColumn,
  SCHEDULE_OUTCOMES,
  SCHEDULE_OUTCOME_DEFS,
  type ScheduleOutcome,
} from "@/lib/scheduleStage";

export interface ScheduleOutcomeTarget {
  leadId: number;
  leadName: string | null;
  taskId: number;
  taskTitle: string;
  dueDate: string | null;
}

interface ScheduleOutcomeModalProps {
  target: ScheduleOutcomeTarget;
  /**
   * Resultado gravado. `opensSale` vem true quando foi "Fechou": quem chama
   * abre o modal de registrar venda em seguida.
   */
  onSaved: (result: { opensSale: boolean; stageKey: string | null }) => void;
  onClose: () => void;
}

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const TONE: Record<ScheduleOutcome, string> = {
  fechamento: "border-emerald-400 bg-emerald-50 text-emerald-800",
  acompanhamento: "border-sky-400 bg-sky-50 text-sky-800",
  remarcado: "border-amber-400 bg-amber-50 text-amber-800",
  bolo: "border-rose-400 bg-rose-50 text-rose-800",
};

/**
 * Cobrança do que aconteceu num compromisso cuja data já venceu.
 *
 * O vendedor escolhe o resultado e o lead se move sozinho (ver
 * `SCHEDULE_OUTCOME_DEFS`). "Remarcou" é o único que pede data nova: cria a
 * próxima tarefa e mantém o lead em Agendado, reabrindo o mesmo ciclo.
 */
export function ScheduleOutcomeModal({ target, onSaved, onClose }: ScheduleOutcomeModalProps) {
  const [outcome, setOutcome] = useState<ScheduleOutcome | null>(null);
  const [newDate, setNewDate] = useState(isoInDays(1));
  const [newTime, setNewTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const definition = outcome ? SCHEDULE_OUTCOME_DEFS[outcome] : null;

  async function submit() {
    if (!outcome || !definition) {
      setError("Escolha o que aconteceu.");
      return;
    }
    if (definition.requiresNewDate && !newDate) {
      setError("Informe a nova data do compromisso.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 1. Conclui a tarefa vencida e move o lead conforme o resultado.
      const response = await fetch(`/api/leads/${target.leadId}/tasks/${target.taskId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        opensSale?: boolean;
        stageKey?: string | null;
      };
      if (!response.ok) throw new Error(data.error ?? "Falha ao registrar o resultado.");

      // 2. Remarcou: a próxima tarefa reabre o ciclo. Usa a rota normal de
      //    criação, que já resolve quadro, coluna inicial e dono pelo lead.
      if (definition.requiresNewDate) {
        const boardsResponse = await fetch(`/api/leads/${target.leadId}/tasks`);
        const boardsData = (await boardsResponse.json().catch(() => ({}))) as {
          boards?: Array<{ id: number; columns: Array<{ id: number; name: string; completes: boolean }> }>;
        };
        const board = boardsData.boards?.[0];
        const column = pickAppointmentColumn(board?.columns ?? []);
        if (board) {
          const created = await fetch(`/api/leads/${target.leadId}/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: target.taskTitle,
              boardId: board.id,
              columnId: column?.id ?? null,
              dueDate: newDate,
              dueTime: newTime || null,
            }),
          });
          if (!created.ok) {
            const createdData = (await created.json().catch(() => ({}))) as { error?: string };
            throw new Error(
              createdData.error ??
                "O resultado foi registrado, mas a nova tarefa não foi criada. Crie pela ficha do lead."
            );
          }
        }
      }

      onSaved({ opensSale: Boolean(data.opensSale), stageKey: data.stageKey ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar o resultado.");
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
            <CalendarCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-500" />
            <div>
              <p className="text-sm font-bold text-neutral-900">O que aconteceu?</p>
              <p className="text-xs text-neutral-400">
                {target.leadName ?? `Lead #${target.leadId}`}
                {target.dueDate ? ` · compromisso de ${target.dueDate}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          <p className="truncate rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
            {target.taskTitle}
          </p>

          <div className="grid gap-1.5">
            {SCHEDULE_OUTCOMES.map((key) => {
              const def = SCHEDULE_OUTCOME_DEFS[key];
              const active = outcome === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOutcome(key)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    active ? TONE[key] : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                  }`}
                >
                  <span className="block text-xs font-bold">{def.label}</span>
                  <span className="block text-[11px] opacity-80">{def.description}</span>
                </button>
              );
            })}
          </div>

          {definition?.requiresNewDate && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-amber-50 p-2.5">
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Nova data *
                </label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(event) => setNewDate(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Hora
                </label>
                <input
                  type="time"
                  value={newTime}
                  onChange={(event) => setNewTime(event.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Agora não
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !outcome}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            Registrar
          </button>
        </div>
      </div>
    </div>
  );
}
