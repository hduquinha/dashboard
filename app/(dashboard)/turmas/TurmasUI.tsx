"use client";

import type { ReactNode } from "react";
import { CLASS_STATUS_LABELS, CLASS_STUDENT_STATUS_LABELS } from "@/lib/academicRules";
import type { ClassStatus, ClassStudentStatus, StudentStatus } from "@/types/academic";

/**
 * Peças visuais compartilhadas pela tela de Turmas.
 *
 * Ficam num arquivo só porque etiqueta de situação e barra de ocupação aparecem em
 * quatro lugares (card, detalhe, grade, lista de alunos) — duplicar as cores foi
 * como a mesma situação já apareceu verde numa tela e cinza na outra no Financeiro.
 */

export const inputClass =
  "w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-[10px] text-neutral-400">{hint}</span> : null}
    </label>
  );
}

/**
 * Situação da turma como binário: ativa ou encerrada.
 *
 * "Planejada" existe no banco (e em turmas criadas antes de a tela parar de perguntar
 * a situação), mas deixou de ser um estado que alguém escolhe — turma nasce ativa e só
 * sai disso pela ação "Encerrar turma". Mostrar três rótulos para dois estados
 * possíveis faria a pessoa procurar onde muda o terceiro.
 */
export function ClassStatusPill({ status }: { status: ClassStatus }) {
  const closed = status === "encerrada";
  return (
    <span
      className={`flex-none rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
        closed ? "bg-neutral-200 text-neutral-600" : "bg-emerald-100 text-emerald-800"
      }`}
    >
      {closed ? CLASS_STATUS_LABELS.encerrada : CLASS_STATUS_LABELS.ativa}
    </span>
  );
}

const LINK_STATUS_TONES: Record<ClassStudentStatus, string> = {
  ativa: "bg-emerald-100 text-emerald-800",
  trancada: "bg-amber-100 text-amber-900",
  cancelada: "bg-rose-100 text-rose-700",
  concluida: "bg-sky-100 text-sky-800",
};

export function LinkStatusPill({ status }: { status: ClassStudentStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${LINK_STATUS_TONES[status]}`}>
      {CLASS_STUDENT_STATUS_LABELS[status]}
    </span>
  );
}

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  trancado: "Trancado",
  concluido: "Concluído",
};

/**
 * Barra de ocupação. Turma sem capacidade definida não mostra barra: 0% e "sem
 * limite" são coisas diferentes, e desenhar uma barra vazia diria que a turma está
 * às moscas quando ela só não tem teto cadastrado.
 */
export function OccupancyBar({
  capacity,
  activeStudents,
  compact = false,
}: {
  capacity: number | null;
  activeStudents: number;
  compact?: boolean;
}) {
  if (capacity === null || capacity <= 0) {
    return (
      <p className={`text-[11px] text-[rgb(var(--slate-9))] ${compact ? "" : "mt-1"}`}>
        {activeStudents} aluno(s) · sem limite de vagas
      </p>
    );
  }
  const percent = Math.min(100, Math.round((activeStudents / capacity) * 100));
  const tone = percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={compact ? "" : "mt-1"}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--slate-4))]">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-[rgb(var(--slate-10))]">
        {activeStudents}/{capacity} vagas · {percent}%
        {percent >= 100 ? " · lotada" : ""}
      </p>
    </div>
  );
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : "—";
}

export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
