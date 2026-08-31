"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Check, RefreshCw, X } from "lucide-react";
import type { AcademicClass, AcademicClassLesson, ClassLessonStatus } from "@/types/academic";

interface LessonSlotPreview {
  sequence: number;
  date: string;
  weekday: number;
  skipped?: string[];
}

interface PlanResponse {
  slots?: LessonSlotPreview[];
  skipped?: Array<{ date: string; label: string }>;
  endDate?: string | null;
  lessons?: AcademicClassLesson[];
  created?: number;
  kept?: number;
  error?: string;
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_LABELS: Record<ClassLessonStatus, string> = {
  planejada: "Planejada",
  realizada: "Realizada",
  cancelada: "Cancelada",
  reposicao: "Reposição",
};

const STATUS_TONE: Record<ClassLessonStatus, string> = {
  planejada: "bg-slate-100 text-slate-700",
  realizada: "bg-emerald-100 text-emerald-800",
  cancelada: "bg-rose-100 text-rose-800",
  reposicao: "bg-amber-100 text-amber-800",
};

function formatDateBR(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Quadro de aulas da turma: as datas de verdade, uma por aula.
 *
 * A grade semanal diz "terça às 19h"; este painel diz em que terças. O número
 * de aulas vem do cadastro do curso e os feriados são pulados na geração — é o
 * que fazia a turma terminar numa data diferente da combinada com o aluno
 * quando a conta era feita na mão.
 */
export function LessonPlanPanel({
  turma,
  canManage,
  onChanged,
}: {
  turma: AcademicClass;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [lessons, setLessons] = useState<AcademicClassLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanResponse | null>(null);
  const [startDate, setStartDate] = useState(turma.startDate ?? new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/academic/classes/${turma.id}/lessons`);
      const data = (await response.json().catch(() => ({}))) as PlanResponse;
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar o quadro de aulas.");
      setLessons(data.lessons ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o quadro de aulas.");
    } finally {
      setLoading(false);
    }
  }, [turma.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const weekdays = [...new Set(turma.schedule.map((slot) => slot.weekday))];
  const firstSlot = turma.schedule[0] ?? null;

  async function call(action: "preview" | "save") {
    if (weekdays.length === 0) {
      setError("Defina os horários da semana antes de gerar as aulas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/academic/classes/${turma.id}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          startDate,
          weekdays,
          startTime: firstSlot?.startTime ?? null,
          endTime: firstSlot?.endTime ?? null,
          teacherEmployeeId: turma.teacherEmployeeId,
          roomId: turma.roomId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as PlanResponse;
      if (!response.ok) throw new Error(data.error ?? "Falha ao gerar o quadro de aulas.");

      if (action === "save") {
        setPreview(null);
        setLessons(data.lessons ?? []);
        onChanged?.();
      } else {
        setPreview(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar o quadro de aulas.");
    } finally {
      setBusy(false);
    }
  }

  async function patchLesson(lessonId: number, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/academic/classes/${turma.id}/lessons`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, ...patch }),
      });
      const data = (await response.json().catch(() => ({}))) as PlanResponse;
      if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar a aula.");
      setLessons(data.lessons ?? []);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar a aula.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "rounded-lg border border-[rgb(var(--border-weak))] px-2 py-1 text-xs text-[rgb(var(--slate-12))]";

  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
          Quadro de aulas
        </p>
        {lessons.length > 0 && (
          <span className="text-[11px] text-[rgb(var(--slate-9))]">
            {lessons.filter((lesson) => lesson.status === "realizada").length} de {lessons.length} aulas
            dadas
          </span>
        )}
      </div>

      {error ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

      {canManage && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-semibold text-[rgb(var(--slate-9))]">
            Primeira aula
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={`ml-1 ${inputClass}`}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void call("preview")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-[11px] font-semibold text-[rgb(var(--slate-11))] disabled:opacity-50"
          >
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
            {lessons.length > 0 ? "Refazer quadro" : "Gerar quadro de aulas"}
          </button>
          <span className="text-[10px] text-[rgb(var(--slate-9))]">
            {weekdays.map((day) => WEEKDAY_SHORT[day]).join(", ") || "sem grade"} · nº de aulas vem do curso
          </span>
        </div>
      )}

      {/* Confirmação: as datas aparecem ANTES de gravar, com os feriados que
          empurraram cada aula. */}
      {preview?.slots && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
          <p className="text-xs font-bold text-amber-900">
            {preview.slots.length} aulas · última em {preview.endDate ? formatDateBR(preview.endDate) : "—"}
          </p>
          {preview.skipped && preview.skipped.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-800">
              Pulou {preview.skipped.map((item) => `${formatDateBR(item.date)} (${item.label})`).join(", ")}
            </p>
          )}
          <div className="mt-2 max-h-40 overflow-y-auto">
            <ul className="grid gap-x-4 gap-y-1 text-[11px] text-amber-900 sm:grid-cols-3">
              {preview.slots.map((slot) => (
                <li key={slot.sequence}>
                  <span className="font-semibold">{slot.sequence}.</span> {WEEKDAY_SHORT[slot.weekday]}{" "}
                  {formatDateBR(slot.date)}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void call("save")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Salvar quadro
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-[11px] font-semibold text-amber-900"
            >
              <X className="h-3.5 w-3.5" /> Cancelar
            </button>
          </div>
          <p className="mt-1 text-[10px] text-amber-800">
            Aula já marcada como realizada ou cancelada é preservada.
          </p>
        </div>
      )}

      {loading ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[rgb(var(--slate-9))]">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </p>
      ) : lessons.length === 0 ? (
        <p className="mt-2 text-xs text-[rgb(var(--slate-9))]">
          Nenhuma aula gerada ainda. O número de aulas vem do cadastro do curso; os feriados são pulados
          automaticamente.
        </p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {lessons.map((lesson) => (
            <li
              key={lesson.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[rgb(var(--border-weak))] px-2 py-1.5 text-xs"
            >
              <span className="w-6 flex-none font-bold text-[rgb(var(--slate-12))]">
                {lesson.status === "reposicao" ? "R" : lesson.sequence}
              </span>
              {canManage ? (
                <input
                  type="date"
                  value={lesson.date}
                  disabled={busy}
                  onChange={(event) => void patchLesson(lesson.id, { date: event.target.value })}
                  className={inputClass}
                />
              ) : (
                <span className="font-semibold">{formatDateBR(lesson.date)}</span>
              )}
              <span className="text-[rgb(var(--slate-9))]">
                {lesson.startTime ? `${lesson.startTime}–${lesson.endTime ?? ""}` : ""}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[lesson.status]}`}>
                {STATUS_LABELS[lesson.status]}
              </span>
              {lesson.teacherName ? (
                <span className="text-[rgb(var(--slate-9))]">{lesson.teacherName}</span>
              ) : null}
              {canManage && (
                <select
                  value={lesson.status}
                  disabled={busy}
                  aria-label="Situação da aula"
                  onChange={(event) => void patchLesson(lesson.id, { status: event.target.value })}
                  className={`ml-auto ${inputClass}`}
                >
                  {(Object.keys(STATUS_LABELS) as ClassLessonStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
