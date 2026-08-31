"use client";

import { WEEKDAY_LABELS } from "@/lib/academicRules";
import type { AcademicClass } from "@/types/academic";

/**
 * A semana inteira da escola numa tabela: cada coluna é um dia, cada bloco é um
 * horário de turma.
 *
 * Responde a pergunta que a lista de turmas não responde — "o que acontece na terça
 * às 19h e onde" — que é como se decide onde encaixar uma turma nova sem esbarrar em
 * sala ocupada. Respeita os filtros do topo de propósito: filtrar por sala vira a
 * agenda daquela sala.
 */
export function WeeklyGrid({
  classes,
  selectedClassId,
  onSelectClass,
}: {
  classes: AcademicClass[];
  selectedClassId: number | null;
  onSelectClass: (classId: number) => void;
}) {
  const blocks = classes.flatMap((turma) =>
    turma.schedule.map((slot) => ({
      key: `${turma.id}-${slot.id}`,
      classId: turma.id,
      className: turma.name,
      status: turma.status,
      weekday: slot.weekday,
      startTime: slot.startTime,
      endTime: slot.endTime,
      roomName: slot.roomName ?? turma.roomName,
    }))
  );

  if (blocks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-8 text-center text-sm text-[rgb(var(--slate-9))]">
        Nenhum horário cadastrado nas turmas deste filtro.
      </p>
    );
  }

  // Domingo só aparece quando alguma turma usa o dia — a escola não abre aos
  // domingos e uma coluna sempre vazia só rouba largura das outras seis.
  const usedWeekdays = new Set(blocks.map((block) => block.weekday));
  const weekdays = [1, 2, 3, 4, 5, 6, 0].filter((weekday) => usedWeekdays.has(weekday));

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[54rem] gap-2" style={{ gridTemplateColumns: `repeat(${weekdays.length}, minmax(0, 1fr))` }}>
        {weekdays.map((weekday) => {
          const dayBlocks = blocks
            .filter((block) => block.weekday === weekday)
            .sort((left, right) => left.startTime.localeCompare(right.startTime));
          return (
            <div key={weekday} className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-2">
              <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-wide text-[rgb(var(--slate-10))]">
                {WEEKDAY_LABELS[weekday]}
                <span className="ml-1 font-normal text-[rgb(var(--slate-9))]">({dayBlocks.length})</span>
              </p>
              <div className="space-y-1.5">
                {dayBlocks.map((block) => (
                  <button
                    key={block.key}
                    type="button"
                    onClick={() => onSelectClass(block.classId)}
                    className={`w-full rounded-md border p-2 text-left transition ${
                      selectedClassId === block.classId
                        ? "border-[rgb(var(--blue-9))] bg-blue-50"
                        : block.status === "encerrada"
                          ? "border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] opacity-70"
                          : "border-[rgb(var(--border-weak))] hover:bg-[rgb(var(--slate-2))]"
                    }`}
                  >
                    <p className="text-[11px] font-bold text-[rgb(var(--slate-12))]">
                      {block.startTime}–{block.endTime}
                    </p>
                    <p className="truncate text-[11px] text-[rgb(var(--slate-11))]">{block.className}</p>
                    <p className="truncate text-[10px] text-[rgb(var(--slate-9))]">
                      {block.roomName ?? "sem sala"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
