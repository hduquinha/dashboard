"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GraduationCap, Loader2, X } from "lucide-react";
import type { AcademicClass, EnrollmentClassTag } from "@/types/academic";

/**
 * Etiqueta "em que turma este matriculado está", na carteira de matrículas.
 *
 * Aluno-na-turma e contrato são coisas separadas por decisão de projeto (a venda
 * fecha antes de existir vaga na agenda), e o preço dessa separação era não dar para
 * ver, olhando a matrícula, se a pessoa já foi encaixada em algum horário. A etiqueta
 * paga esse preço: mostra a turma quando existe e diz exatamente o que falta quando
 * não existe — "aluno não cadastrado" e "aguardando turma" são pendências de áreas
 * diferentes e não podem virar o mesmo rótulo.
 */
export function EnrollmentClassBadge({
  tag,
  canViewClasses,
  canManageClasses,
  canViewStudents,
  onAllocate,
}: {
  tag: EnrollmentClassTag | undefined;
  canViewClasses: boolean;
  canManageClasses: boolean;
  canViewStudents: boolean;
  onAllocate: (tag: EnrollmentClassTag) => void;
}) {
  if (!tag || tag.studentId === null) {
    // Quem entra na turma é a ficha do aluno, não o contrato — então o link leva para
    // onde a pendência se resolve, em vez de deixar o rótulo como beco sem saída.
    const label = (
      <>
        <GraduationCap size={13} /> Aluno não cadastrado
      </>
    );
    const title = "O contrato ainda não aponta para uma ficha de aluno — é ela que entra na turma. Cadastre em Alunos ou pela própria turma.";
    return canViewStudents ? (
      <Link
        href="/alunos"
        title={title}
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
      >
        {label}
      </Link>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600" title={title}>
        {label}
      </span>
    );
  }

  const active = tag.studentClasses.filter((item) => item.status === "ativa");
  const locked = tag.studentClasses.filter((item) => item.status === "trancada");

  if (active.length === 0 && locked.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
          <GraduationCap size={13} /> Aguardando turma
        </span>
        {/* Alocar exige as duas permissões: a POST pede `classes.manage` e a lista de
            turmas do modal pede `view.classes`. Mostrar o botão para quem só tem uma
            delas entregaria um modal vazio. */}
        {canManageClasses && canViewClasses ? (
          <button
            type="button"
            onClick={() => onAllocate(tag)}
            className="rounded-full border border-amber-300 px-2 py-1 text-xs font-bold text-amber-800 hover:bg-amber-50"
          >
            Definir turma
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {[...active, ...locked].map((item) => {
        const label = `${item.className}${item.status === "trancada" ? " (trancada)" : ""}`;
        const tone =
          item.status === "ativa" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900";
        return canViewClasses ? (
          <Link
            key={item.classId}
            href={`/turmas?turma=${item.classId}`}
            title={item.courseName ? `Curso da turma: ${item.courseName}` : "Abrir a turma"}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold hover:underline ${tone}`}
          >
            <GraduationCap size={13} /> {label}
          </Link>
        ) : (
          <span key={item.classId} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${tone}`}>
            <GraduationCap size={13} /> {label}
          </span>
        );
      })}
      {/* Divergência entre o que foi vendido e onde o aluno está é informação, não
          erro: turma no contrato costuma ser a combinada na venda, e a troca de
          horário depois é rotina. Some quando as duas coincidem. */}
      {tag.contractClassId && !active.some((item) => item.classId === tag.contractClassId) ? (
        <span
          className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600"
          title="Turma registrada no contrato, diferente da turma em que o aluno está hoje."
        >
          contrato: {tag.contractClassName}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Escolher a turma direto da matrícula.
 *
 * Vale a pena existir aqui (e não só em /turmas) porque quem acabou de cadastrar o
 * contrato é quem sabe o horário combinado com o aluno — mandar essa pessoa para
 * outra tela é onde a informação se perdia. A alocação em si passa pela MESMA rota
 * de /turmas, com a checagem de vaga no servidor.
 */
export function AllocateClassModal({
  tag,
  onClose,
  onDone,
}: {
  tag: EnrollmentClassTag;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classId, setClassId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/academic/classes")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { classes?: AcademicClass[] } | null) => {
        if (cancelled) return;
        setClasses((data?.classes ?? []).filter((item) => item.status !== "encerrada"));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirm() {
    if (!classId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/academic/classes/${classId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: tag.studentId, financeEnrollmentId: tag.enrollmentId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao alocar o aluno.");
      onDone(`${tag.studentName ?? "Aluno"} alocado na turma.`);
    } catch (allocateError) {
      setError(allocateError instanceof Error ? allocateError.message : "Falha ao alocar o aluno.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-16 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-black text-slate-950">Definir turma</p>
            <p className="text-xs text-slate-500">{tag.studentName ?? `Matrícula #${tag.enrollmentId}`}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {error ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}

        {loading ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" />
        ) : classes.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            Nenhuma turma aberta. Crie a turma em Turmas antes de alocar.
          </p>
        ) : (
          <select
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-500"
          >
            <option value="">Escolher turma…</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id} disabled={item.seatsLeft === 0}>
                {item.name}
                {item.seatsLeft === null ? "" : item.seatsLeft === 0 ? " (lotada)" : ` (${item.seatsLeft} vaga(s))`}
              </option>
            ))}
          </select>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !classId}
            onClick={() => void confirm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-1.5 text-xs font-black text-white disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Alocar na turma
          </button>
        </div>
      </div>
    </div>
  );
}
