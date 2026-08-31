"use client";

import { useState } from "react";
import { CalendarClock, RefreshCw, X } from "lucide-react";
import {
  RESCHEDULE_REASONS,
  RESCHEDULE_REASON_DEFS,
  type RescheduleReason,
} from "@/lib/scheduleStage";

export interface RescheduleTarget {
  leadId: number;
  leadName: string | null;
  taskId: number;
  taskTitle: string;
  dueDate: string | null;
  dueTime: string | null;
}

interface RescheduleTaskModalProps {
  target: RescheduleTarget;
  onSaved: () => void;
  onClose: () => void;
}

const TONE: Record<RescheduleReason, string> = {
  cliente: "border-amber-400 bg-amber-50 text-amber-800",
  correcao: "border-sky-400 bg-sky-50 text-sky-800",
};

/**
 * Nova data/hora de um compromisso já marcado.
 *
 * O motivo é obrigatório porque as duas situações que levam à mesma edição são
 * opostas na leitura do lead: cliente que remarca é sinal comercial (e vira
 * remarcação na linha do tempo), data digitada errada é só conserto de
 * cadastro. Sem perguntar, as duas viravam a mesma alteração silenciosa.
 *
 * Quem conclui o compromisso é o `ScheduleOutcomeModal` — aqui a tarefa
 * continua aberta e o lead continua em Agendado.
 */
export function RescheduleTaskModal({ target, onSaved, onClose }: RescheduleTaskModalProps) {
  const [dueDate, setDueDate] = useState(target.dueDate ?? "");
  const [dueTime, setDueTime] = useState(target.dueTime ?? "");
  const [reason, setReason] = useState<RescheduleReason | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!dueDate) {
      setError("Informe a nova data.");
      return;
    }
    if (!reason) {
      setError("Diga por que a data mudou.");
      return;
    }
    if (dueDate === (target.dueDate ?? "") && (dueTime || "") === (target.dueTime ?? "")) {
      setError("A data e a hora continuam as mesmas.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/leads/${target.leadId}/tasks/${target.taskId}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate, dueTime: dueTime || null, reason, note }),
        }
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao remarcar o compromisso.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remarcar o compromisso.");
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
            <CalendarClock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-bold text-neutral-900">Mudar data do compromisso</p>
              <p className="text-xs text-neutral-400">
                {target.leadName ?? `Lead #${target.leadId}`}
                {target.dueDate
                  ? ` · hoje marcado para ${target.dueDate}${target.dueTime ? ` às ${target.dueTime}` : ""}`
                  : ""}
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

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Nova data *
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
                title="Com horário, o lembrete toca de novo na hora nova"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Por que mudou? *
            </p>
            {RESCHEDULE_REASONS.map((key) => {
              const def = RESCHEDULE_REASON_DEFS[key];
              const active = reason === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(key)}
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

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Observação (opcional)
            </label>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ex.: cliente pediu para segunda de manhã"
              className={`w-full ${inputClass}`}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !reason}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            Salvar nova data
          </button>
        </div>
      </div>
    </div>
  );
}
