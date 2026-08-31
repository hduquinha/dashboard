"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, CalendarSync, Check, Loader2, RefreshCw, Save, X } from "lucide-react";
import { humanizeName } from "@/lib/utils";
import { formatDateBR, inputClass } from "./TurmasUI";
import type {
  AcademicClass,
  AcademicClassLesson,
  AcademicClassRosterRow,
  AttendanceStatus,
  LessonAttendanceMark,
  LessonMakeup,
  MakeupOption,
} from "@/types/academic";

interface AttendanceResponse {
  lessons?: AcademicClassLesson[];
  attendance?: LessonAttendanceMark[];
  makeups?: LessonMakeup[];
  options?: MakeupOption[];
  lessonId?: number;
  error?: string;
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  presente: "Presente",
  falta: "Falta",
  justificada: "Justificada",
};

/** Letra do mapa de presença: a coluna é estreita e a legenda fica no rodapé. */
const STATUS_LETTER: Record<AttendanceStatus, string> = {
  presente: "P",
  falta: "F",
  justificada: "J",
};

const STATUS_TONE: Record<AttendanceStatus, string> = {
  presente: "bg-emerald-100 text-emerald-800",
  falta: "bg-rose-100 text-rose-800",
  justificada: "bg-amber-100 text-amber-800",
};

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function weekdayOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return "";
  return WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Chave da marcação em memória — o par (aula, aluno) é a identidade da chamada. */
function markKey(lessonId: number, studentId: number): string {
  return `${lessonId}:${studentId}`;
}

/**
 * Diário de aula: chamada por aula e mapa de presença da turma.
 *
 * A tela responde duas perguntas que a operação faz em momentos diferentes:
 * "quem veio hoje" (a chamada, uma aula por vez) e "quem está faltando" (o
 * mapa, a turma inteira de uma vez). Por isso as duas vivem no mesmo painel —
 * quem vê a falta no mapa é quem marca a reposição, e mandar essa pessoa para
 * outra tela é o que faz a reposição não acontecer.
 *
 * A conta de presença considera **só as aulas com chamada lançada**: turma com
 * quadro de 24 aulas geradas não pode nascer com 100% de falta porque as aulas
 * futuras já existem como linha.
 */
export function AttendancePanel({
  turma,
  roster,
  canManage,
  initialLessonId = null,
}: {
  turma: AcademicClass;
  roster: AcademicClassRosterRow[];
  canManage: boolean;
  /** Aula que veio no link da tela de Chamada — abre direto nela. */
  initialLessonId?: number | null;
}) {
  const [lessons, setLessons] = useState<AcademicClassLesson[]>([]);
  const [marks, setMarks] = useState<Map<string, AttendanceStatus>>(new Map());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [makeupDate, setMakeupDate] = useState<string | null>(null);
  const [makeups, setMakeups] = useState<LessonMakeup[]>([]);
  /** Falta que está sendo remarcada agora: o aluno e a aula que ele perdeu. */
  const [remarcando, setRemarcando] = useState<{ studentId: number; lessonId: number } | null>(null);
  const [options, setOptions] = useState<MakeupOption[] | null>(null);

  const students = useMemo(() => roster.filter((row) => row.status === "ativa"), [roster]);

  const applyResponse = useCallback((data: AttendanceResponse) => {
    const nextLessons = data.lessons ?? [];
    setLessons(nextLessons);
    const nextMarks = new Map<string, AttendanceStatus>();
    const nextNotes = new Map<string, string>();
    for (const mark of data.attendance ?? []) {
      nextMarks.set(markKey(mark.lessonId, mark.studentId), mark.status);
      if (mark.note) nextNotes.set(markKey(mark.lessonId, mark.studentId), mark.note);
    }
    setMarks(nextMarks);
    setNotes(nextNotes);
    setMakeups(data.makeups ?? []);
    return nextLessons;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/academic/classes/${turma.id}/attendance`);
      const data = (await response.json().catch(() => ({}))) as AttendanceResponse;
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar o diário.");
      const nextLessons = applyResponse(data);
      // A aula do link manda; sem link, abre na que a pessoa veio lançar — a
      // última que já aconteceu.
      const hoje = today();
      const passadas = nextLessons.filter((lesson) => lesson.date <= hoje);
      const doLink = nextLessons.find((lesson) => lesson.id === initialLessonId);
      setSelectedLessonId(
        (doLink ?? passadas[passadas.length - 1] ?? nextLessons[0])?.id ?? null
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o diário.");
    } finally {
      setLoading(false);
    }
  }, [turma.id, initialLessonId, applyResponse]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = lessons.find((lesson) => lesson.id === selectedLessonId) ?? null;

  /**
   * Rótulo da coluna: nº da aula, ou R1, R2… para reposição.
   *
   * A reposição vive numa faixa alta de sequência para não brigar com o quadro
   * regular (ver `createMakeupLesson`), e mostrar "1001" no cabeçalho não diria
   * nada a quem lê o mapa.
   */
  const lessonLabels = useMemo(() => {
    const labels = new Map<number, string>();
    let makeups = 0;
    for (const lesson of lessons) {
      labels.set(
        lesson.id,
        lesson.status === "reposicao" ? `R${(makeups += 1)}` : String(lesson.sequence)
      );
    }
    return labels;
  }, [lessons]);

  /**
   * Quem é chamado nesta aula: os alunos da turma mais os **visitantes** —
   * gente de outra turma que veio repor aqui. Sem eles na lista, a presença da
   * reposição não teria onde ser marcada e a falta nunca fecharia.
   */
  const chamadaList = useMemo(() => {
    const base = students.map((student) => ({
      studentId: student.studentId,
      name: student.studentName,
      visiting: null as LessonMakeup | null,
    }));
    if (!selected) return base;
    const próprios = new Set(base.map((row) => row.studentId));
    const visitantes = makeups
      .filter((makeup) => makeup.makeupLessonId === selected.id && !próprios.has(makeup.studentId))
      .map((makeup) => ({
        studentId: makeup.studentId,
        name: makeup.studentName,
        visiting: makeup,
      }));
    return [...base, ...visitantes];
  }, [students, makeups, selected]);

  /** Reposição marcada para uma falta específica (aluno + aula perdida). */
  const makeupFor = useCallback(
    (studentId: number, lessonId: number) =>
      makeups.find(
        (makeup) => makeup.studentId === studentId && makeup.missedLessonId === lessonId
      ) ?? null,
    [makeups]
  );

  /** Aulas que entram na conta: as que já têm chamada lançada. */
  const launched = useMemo(() => {
    const ids = new Set<number>();
    for (const key of marks.keys()) ids.add(Number(key.split(":")[0]));
    return lessons.filter((lesson) => ids.has(lesson.id));
  }, [lessons, marks]);

  const summary = useMemo(() => {
    return students.map((student) => {
      let presente = 0;
      let falta = 0;
      let justificada = 0;
      let reposta = 0;
      for (const lesson of launched) {
        const status = marks.get(markKey(lesson.id, student.studentId));
        if (!status) continue;
        if (status === "presente") {
          presente += 1;
          if (lesson.status === "reposicao") reposta += 1;
        } else if (status === "falta") falta += 1;
        else justificada += 1;
      }
      const total = presente + falta + justificada;
      // Falta em aberto é a que ainda não foi reposta: só a presença na aula de
      // destino fecha. Marcada mas não cursada continua pendente — é o número
      // que decide se o aluno pode se formar.
      const emAberto = launched.filter((lesson) => {
        const status = marks.get(markKey(lesson.id, student.studentId));
        if (status !== "falta" && status !== "justificada") return false;
        return makeupFor(student.studentId, lesson.id)?.result !== "presente";
      }).length;
      return {
        student,
        presente,
        falta,
        justificada,
        reposta,
        emAberto,
        total,
        rate: total > 0 ? Math.round((presente / total) * 100) : null,
      };
    });
  }, [students, launched, marks, makeupFor]);

  /**
   * O que falta para cada aluno se formar: toda falta ainda não reposta, com a
   * reposição marcada quando existe. É a lista que a coordenação persegue.
   */
  const pendencias = useMemo(() => {
    const rows: Array<{
      studentId: number;
      name: string;
      lesson: AcademicClassLesson;
      makeup: LessonMakeup | null;
    }> = [];
    for (const student of students) {
      for (const lesson of launched) {
        const status = marks.get(markKey(lesson.id, student.studentId));
        if (status !== "falta" && status !== "justificada") continue;
        const makeup = makeupFor(student.studentId, lesson.id);
        if (makeup?.result === "presente") continue;
        rows.push({
          studentId: student.studentId,
          name: student.studentName,
          lesson,
          makeup,
        });
      }
    }
    return rows;
  }, [students, launched, marks, makeupFor]);

  function setMark(lessonId: number, studentId: number, status: AttendanceStatus | null) {
    setMarks((current) => {
      const next = new Map(current);
      if (status === null) next.delete(markKey(lessonId, studentId));
      else next.set(markKey(lessonId, studentId), status);
      return next;
    });
  }

  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/academic/classes/${turma.id}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as AttendanceResponse;
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar.");
      applyResponse(data);
      if (data.lessonId) setSelectedLessonId(data.lessonId);
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  /** Abre o remarcar de uma falta e busca onde ela pode ser reposta. */
  async function abrirRemarcar(studentId: number, lessonId: number) {
    setRemarcando({ studentId, lessonId });
    setOptions(null);
    try {
      const response = await fetch(
        `/api/academic/classes/${turma.id}/attendance?opcoes=${lessonId}`
      );
      const data = (await response.json().catch(() => ({}))) as AttendanceResponse;
      if (!response.ok) throw new Error(data.error ?? "Falha ao buscar as aulas de reposição.");
      setOptions(data.options ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao buscar as aulas de reposição.");
      setRemarcando(null);
    }
  }

  async function saveChamada() {
    if (!selected) return;
    await post(
      {
        lessonId: selected.id,
        entries: chamadaList.map((row) => ({
          studentId: row.studentId,
          status: marks.get(markKey(selected.id, row.studentId)) ?? null,
          note: notes.get(markKey(selected.id, row.studentId)) ?? null,
        })),
      },
      `Chamada de ${lessonLabels.get(selected.id) ?? selected.sequence} salva.`
    );
  }

  const totalStudents = students.length;

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[rgb(var(--slate-9))]">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando o diário…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>
      ) : null}

      {lessons.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-8 text-center text-xs text-[rgb(var(--slate-9))]">
          Esta turma ainda não tem quadro de aulas. Gere o quadro em <strong>Grade e aulas</strong> — a
          chamada é por aula, então ela precisa das datas primeiro.
        </p>
      ) : (
        <>
          {/* ── Chamada de uma aula ─────────────────────────────────────── */}
          <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                Chamada
              </p>
              <span className="text-[11px] text-[rgb(var(--slate-9))]">
                {launched.length} de {lessons.length} aulas com chamada lançada
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {lessons.map((lesson) => {
                const done = launched.some((item) => item.id === lesson.id);
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    onClick={() => setSelectedLessonId(lesson.id)}
                    title={`${weekdayOf(lesson.date)} ${formatDateBR(lesson.date)}${
                      lesson.status === "reposicao" ? " · reposição" : ""
                    }`}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      lesson.id === selectedLessonId
                        ? "bg-[rgb(var(--slate-12))] text-white"
                        : done
                          ? "bg-emerald-50 text-emerald-800"
                          : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
                    }`}
                  >
                    {lessonLabels.get(lesson.id) ?? lesson.sequence}
                  </button>
                );
              })}
            </div>

            {selected ? (
              <>
                <p className="mt-2 text-xs font-semibold text-[rgb(var(--slate-12))]">
                  {selected.status === "reposicao" ? "Reposição" : `Aula ${selected.sequence}`} ·{" "}
                  {weekdayOf(selected.date)} {formatDateBR(selected.date)}
                  {selected.startTime ? ` · ${selected.startTime}` : ""}
                  {selected.status === "reposicao" ? " · reposição" : ""}
                  {selected.status === "cancelada" ? " · cancelada" : ""}
                </p>

                {totalStudents === 0 ? (
                  <p className="mt-2 text-xs text-[rgb(var(--slate-9))]">
                    Nenhum aluno ativo na turma para chamar.
                  </p>
                ) : (
                  <>
                    <ul className="mt-2 divide-y divide-[rgb(var(--border-weak))]">
                      {chamadaList.map((row) => {
                        const key = markKey(selected.id, row.studentId);
                        const status = marks.get(key) ?? null;
                        const marcada = row.visiting ? null : makeupFor(row.studentId, selected.id);
                        const escolhendo =
                          remarcando?.studentId === row.studentId &&
                          remarcando?.lessonId === selected.id;
                        return (
                          <li key={row.studentId} className="flex flex-wrap items-center gap-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs text-[rgb(var(--slate-12))]">
                              {humanizeName(row.name) || row.name}
                              {row.visiting ? (
                                <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                                  repondo a aula {row.visiting.missedSequence} da{" "}
                                  {row.visiting.missedClassName}
                                </span>
                              ) : null}
                            </span>
                            {status && status !== "presente" ? (
                              <input
                                value={notes.get(key) ?? ""}
                                disabled={!canManage || busy}
                                onChange={(event) =>
                                  setNotes((current) => {
                                    const next = new Map(current);
                                    next.set(key, event.target.value);
                                    return next;
                                  })
                                }
                                placeholder="motivo (opcional)"
                                className={`${inputClass} h-7 max-w-[14rem] flex-none py-0 text-xs`}
                              />
                            ) : null}
                            <div className="flex flex-none gap-1">
                              {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  title={STATUS_LABELS[option]}
                                  disabled={!canManage || busy}
                                  onClick={() =>
                                    setMark(selected.id, row.studentId, status === option ? null : option)
                                  }
                                  className={`rounded-md px-2 py-1 text-[11px] font-bold disabled:opacity-40 ${
                                    status === option
                                      ? STATUS_TONE[option]
                                      : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-9))]"
                                  }`}
                                >
                                  {STATUS_LETTER[option]}
                                </button>
                              ))}
                            </div>

                            {/* Remarcar: só faz sentido para quem faltou nesta
                                turma — o visitante já está repondo. */}
                            {!row.visiting && status && status !== "presente" ? (
                              marcada ? (
                                <span className="flex w-full items-center gap-1.5 text-[10px] text-[rgb(var(--slate-9))]">
                                  <CalendarSync className="h-3 w-3" />
                                  {marcada.result === "presente" ? (
                                    <span className="font-semibold text-emerald-700">
                                      reposta em {formatDateBR(marcada.makeupDate)} ·{" "}
                                      {marcada.makeupClassName}
                                    </span>
                                  ) : (
                                    <>
                                      repõe em {formatDateBR(marcada.makeupDate)} ·{" "}
                                      {marcada.makeupClassName}
                                    </>
                                  )}
                                  {canManage ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void post(
                                          { action: "desmarcar", makeupId: marcada.id },
                                          "Reposição desmarcada."
                                        )
                                      }
                                      className="text-rose-600 underline"
                                    >
                                      desmarcar
                                    </button>
                                  ) : null}
                                </span>
                              ) : canManage ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void abrirRemarcar(row.studentId, selected.id)}
                                  className="inline-flex h-6 flex-none items-center gap-1 rounded-md border border-[rgb(var(--border-weak))] px-2 text-[10px] font-semibold text-[rgb(var(--slate-11))]"
                                >
                                  <CalendarSync className="h-3 w-3" /> Remarcar aula
                                </button>
                              ) : null
                            ) : null}

                            {escolhendo ? (
                              <div className="w-full rounded-lg border border-sky-200 bg-sky-50/60 p-2">
                                {options === null ? (
                                  <p className="flex items-center gap-1.5 text-[11px] text-sky-900">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Procurando onde repor…
                                  </p>
                                ) : options.length === 0 ? (
                                  <p className="text-[11px] text-sky-900">
                                    Nenhuma turma do mesmo curso ainda vai dar a aula {selected.sequence}.
                                    Crie uma <strong>aula de reposição</strong> no mapa abaixo e remarque
                                    para ela.
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {options.map((option) => (
                                      <li key={option.lessonId}>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={async () => {
                                            await post(
                                              {
                                                action: "remarcar",
                                                studentId: row.studentId,
                                                missedLessonId: selected.id,
                                                makeupLessonId: option.lessonId,
                                              },
                                              "Aula remarcada."
                                            );
                                            setRemarcando(null);
                                          }}
                                          className="w-full rounded-md bg-white px-2 py-1 text-left text-[11px] text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                                        >
                                          <span className="font-semibold">
                                            {weekdayOf(option.date)} {formatDateBR(option.date)}
                                          </span>
                                          {option.startTime ? ` ${option.startTime}` : ""} ·{" "}
                                          {option.sameClass
                                            ? "aula extra desta turma"
                                            : `${option.className} · aula ${option.sequence}`}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setRemarcando(null)}
                                  className="mt-1 text-[10px] font-semibold text-sky-900 underline"
                                >
                                  fechar
                                </button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>

                    {canManage ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setMarks((current) => {
                              const next = new Map(current);
                              for (const row of chamadaList) {
                                next.set(markKey(selected.id, row.studentId), "presente");
                              }
                              return next;
                            })
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-[11px] font-semibold text-[rgb(var(--slate-11))] disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" /> Todos presentes
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveChamada()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Salvar chamada
                        </button>
                        <span className="text-[10px] text-[rgb(var(--slate-9))]">
                          Salvar conclui a aula (planejada vira realizada).
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : null}
          </div>

          {/* ── Mapa de presença ────────────────────────────────────────── */}
          <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                Mapa de presença
              </p>
              {canManage ? (
                makeupDate === null ? (
                  <button
                    type="button"
                    onClick={() => setMakeupDate(today())}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-2.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" /> Aula de reposição
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={makeupDate}
                      onChange={(event) => setMakeupDate(event.target.value)}
                      className={`${inputClass} h-7 w-auto py-0 text-xs`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        await post(
                          {
                            action: "reposicao",
                            date: makeupDate,
                            startTime: turma.schedule[0]?.startTime ?? null,
                            endTime: turma.schedule[0]?.endTime ?? null,
                          },
                          "Aula de reposição criada."
                        );
                        setMakeupDate(null);
                      }}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-neutral-900 px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Criar
                    </button>
                    <button
                      type="button"
                      onClick={() => setMakeupDate(null)}
                      className="grid h-7 w-7 place-items-center rounded-lg border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-9))]"
                      aria-label="Cancelar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )
              ) : null}
            </div>

            {launched.length === 0 ? (
              <p className="mt-2 text-xs text-[rgb(var(--slate-9))]">
                Nenhuma chamada lançada ainda. O mapa aparece a partir da primeira.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
                      <th className="sticky left-0 bg-[rgb(var(--surface-1))] pb-1 pr-2 text-left font-semibold">
                        Aluno
                      </th>
                      {launched.map((lesson) => (
                        <th
                          key={lesson.id}
                          title={`${weekdayOf(lesson.date)} ${formatDateBR(lesson.date)}`}
                          className="px-1 pb-1 text-center font-semibold"
                        >
                          {lessonLabels.get(lesson.id) ?? lesson.sequence}
                        </th>
                      ))}
                      <th className="px-1 pb-1 text-right font-semibold">Presença</th>
                      <th className="px-1 pb-1 text-right font-semibold">Faltas</th>
                      <th className="px-1 pb-1 text-right font-semibold">A repor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                    {summary.map((row) => (
                      <tr key={row.student.studentId}>
                        <td className="sticky left-0 max-w-[12rem] truncate bg-[rgb(var(--surface-1))] py-1 pr-2 text-[rgb(var(--slate-12))]">
                          {humanizeName(row.student.studentName) || row.student.studentName}
                        </td>
                        {launched.map((lesson) => {
                          const status = marks.get(markKey(lesson.id, row.student.studentId));
                          return (
                            <td key={lesson.id} className="px-1 py-1 text-center">
                              {status ? (
                                <span
                                  className={`inline-block w-5 rounded font-bold ${STATUS_TONE[status]}`}
                                >
                                  {STATUS_LETTER[status]}
                                </span>
                              ) : (
                                <span className="text-[rgb(var(--slate-9))]">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-1 py-1 text-right font-semibold text-[rgb(var(--slate-12))]">
                          {row.rate === null ? "—" : `${row.rate}%`}
                        </td>
                        <td className="px-1 py-1 text-right">
                          <span className={row.falta > 0 ? "font-semibold text-rose-700" : ""}>
                            {row.falta}
                          </span>
                          {row.justificada > 0 ? (
                            <span className="text-amber-700"> +{row.justificada}J</span>
                          ) : null}
                          {row.reposta > 0 ? (
                            <span className="text-emerald-700"> ·{row.reposta}R</span>
                          ) : null}
                        </td>
                        <td className="px-1 py-1 text-right">
                          {row.emAberto > 0 ? (
                            <span className="font-semibold text-rose-700">{row.emAberto}</span>
                          ) : row.total > 0 ? (
                            <span className="text-emerald-700">em dia</span>
                          ) : (
                            <span className="text-[rgb(var(--slate-9))]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-[10px] text-[rgb(var(--slate-9))]">
                      <td className="sticky left-0 bg-[rgb(var(--surface-1))] pt-1 pr-2 font-semibold">
                        Presentes
                      </td>
                      {launched.map((lesson) => (
                        <td key={lesson.id} className="px-1 pt-1 text-center">
                          {
                            students.filter(
                              (student) =>
                                marks.get(markKey(lesson.id, student.studentId)) === "presente"
                            ).length
                          }
                        </td>
                      ))}
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {pendencias.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                <p className="text-[11px] font-bold text-amber-900">
                  Faltam repor · {pendencias.length} aula(s)
                </p>
                <p className="mt-0.5 text-[10px] text-amber-800">
                  Nesta escola o aluno só se forma assistindo a todas as aulas. Enquanto a aula
                  estiver aqui, ela não foi reposta — remarcar sozinho não fecha, o que fecha é a
                  presença na aula de destino.
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {pendencias.map((pendencia) => (
                    <li
                      key={`${pendencia.studentId}:${pendencia.lesson.id}`}
                      className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-amber-900"
                    >
                      <span className="font-semibold">
                        {humanizeName(pendencia.name) || pendencia.name}
                      </span>
                      <span>
                        aula {pendencia.lesson.sequence} de {formatDateBR(pendencia.lesson.date)}
                      </span>
                      {pendencia.makeup ? (
                        <span className="rounded bg-white px-1.5 py-0.5 font-semibold">
                          marcada: {formatDateBR(pendencia.makeup.makeupDate)} ·{" "}
                          {pendencia.makeup.makeupClassName}
                          {pendencia.makeup.result === "falta" ||
                          pendencia.makeup.result === "justificada"
                            ? " · faltou de novo"
                            : ""}
                        </span>
                      ) : (
                        <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-rose-700">
                          sem reposição marcada
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="mt-2 text-[10px] text-[rgb(var(--slate-9))]">
              <strong>P</strong> presente · <strong>F</strong> falta · <strong>J</strong> falta
              justificada · <strong>R1, R2…</strong> aula de reposição · <strong>—</strong> chamada
              não lançada. A porcentagem considera só as aulas já lançadas para o aluno.{" "}
              <strong>A repor</strong> é o que falta para ele se formar: falta sem presença numa
              aula de reposição, marcada ou não.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
