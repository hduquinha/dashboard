"use client";

import { useState } from "react";
import { Copy, Loader2, Trash2, X } from "lucide-react";
import { WEEKDAY_LABELS, describeSchedule } from "@/lib/academicRules";
import { Field, inputClass } from "./TurmasUI";
import type { CourseOption, TeacherOption } from "./TurmasClient";
import type {
  AcademicClass,
  AcademicClassScheduleInput,
  AcademicRoom,
  ClassModality,
} from "@/types/academic";

/**
 * Cadastro da turma: dados, grade de horário e a ponte opcional com o treinamento
 * antigo.
 *
 * O formulário é deliberadamente curto. Curso saiu porque nesta escola turma e curso
 * são a mesma coisa (o nome da turma já é a oferta) e dois cadastros para um conceito
 * só geram divergência; nível e professor saíram porque não são operados hoje; e a
 * situação virou consequência da ação "Encerrar turma" em vez de um campo que alguém
 * precisa lembrar de mudar. As colunas continuam no banco e são preservadas pelo
 * PATCH — o que sumiu foi a pergunta, não o dado.
 *
 * A grade continua sendo salva junto com a turma (e não numa tela à parte) porque é
 * ela que define choque de sala: separar as duas telas permitiria salvar uma turma
 * "válida" que só descobre o conflito no próximo passo.
 */
/**
 * Horário padrão de uma turma nova.
 *
 * A VozUP dá aula à noite; começar com 19:00–20:30 preenchido poupa dois
 * cliques e continua editável. Não é regra de negócio, é o palpite mais provável.
 */
const DEFAULT_START_TIME = "19:00";
const DEFAULT_END_TIME = "20:30";

/** Dia da semana (0–6) de uma data "AAAA-MM-DD", sem escorregar de fuso. */
function weekdayOf(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * A grade da turma calculada: dia da semana do início + quantas aulas por
 * semana o curso tem.
 *
 * Ninguém deveria montar grade à mão para o caso normal da escola — uma aula
 * por semana, sempre no mesmo dia. Turma de duas aulas semanais ganha o segundo
 * dia dois dias depois (segunda/quarta, terça/quinta), que é como as turmas se
 * organizam; quem precisar de outra combinação abre "Ajustar grade".
 */
function deriveSchedule(
  startIso: string,
  lessonsPerWeek: number,
  template: { startTime: string; endTime: string; roomId: number | null }
): AcademicClassScheduleInput[] {
  const first = weekdayOf(startIso);
  if (first === null) return [];
  const total = Math.min(7, Math.max(1, lessonsPerWeek));
  return Array.from({ length: total }, (_, index) => ({
    weekday: (first + index * 2) % 7,
    startTime: template.startTime,
    endTime: template.endTime,
    teacherEmployeeId: null,
    roomId: template.roomId,
  }));
}

export function ClassForm({
  turma,
  duplicating = false,
  rooms,
  courses,
  teachers,
  onClose,
  onSaved,
  onError,
}: {
  turma: AcademicClass | null;
  /** Abrindo a partir de "Duplicar": copia os campos e nasce como turma nova. */
  duplicating?: boolean;
  rooms: AcademicRoom[];
  courses: CourseOption[];
  teachers: TeacherOption[];
  onClose: () => void;
  /** `deleted` distingue "salvou" de "sumiu": só o segundo precisa limpar a seleção. */
  onSaved: (message: string, options?: { deleted?: boolean }) => void;
  onError: (message: string | null) => void;
}) {
  const editing = turma !== null && !duplicating;
  const [name, setName] = useState(turma ? (duplicating ? `${turma.name} (cópia)` : turma.name) : "");
  const [modality, setModality] = useState<ClassModality>(turma?.modality ?? "modular");
  const [startDate, setStartDate] = useState(duplicating ? "" : (turma?.startDate ?? ""));
  const [endDate, setEndDate] = useState(duplicating ? "" : (turma?.endDate ?? ""));
  const [capacity, setCapacity] = useState(turma?.capacity ? String(turma.capacity) : "");
  const [roomId, setRoomId] = useState(turma?.roomId ? String(turma.roomId) : "");
  const [notes, setNotes] = useState(turma?.notes ?? "");
  const [trainingId, setTrainingId] = useState(duplicating ? "" : (turma?.trainingId ?? ""));
  const [slots, setSlots] = useState<AcademicClassScheduleInput[]>(
    turma?.schedule.map((slot) => ({
      weekday: slot.weekday,
      startTime: slot.startTime,
      endTime: slot.endTime,
      teacherEmployeeId: slot.teacherEmployeeId,
      roomId: slot.roomId,
    })) ?? []
  );
  // Curso: é dele que sai o número de aulas do quadro e é por ele que a turma
  // aparece na venda. Sem curso a turma existe, mas não gera aulas nem é
  // oferecida no fechamento.
  const [courseId, setCourseId] = useState(turma?.courseId ? String(turma.courseId) : "");
  // Professores: um titular e quantos auxiliares precisar.
  const [teacherIds, setTeacherIds] = useState<number[]>(
    turma?.teachers?.map((teacher) => teacher.employeeId) ?? []
  );
  // A grade só vira formulário quando alguém pede: no caso normal ela é
  // consequência do início e do curso.
  const [advancedSchedule, setAdvancedSchedule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedCourse = courses.find((course) => String(course.id) === courseId) ?? null;

  /**
   * A grade nasce da data de início: 26/08 é uma quarta, então a turma é de
   * quarta. Antes o dia da semana era escolhido à mão e podia contradizer o
   * início — a turma começava numa quarta e o quadro de aulas era gerado nas
   * segundas.
   *
   * Horário e sala já escolhidos são preservados; o que se recalcula é o dia
   * da semana. Em "Ajustar grade" a derivação para de mandar.
   */
  function syncSchedule(nextStart: string, nextCourseId: string) {
    const course = courses.find((item) => String(item.id) === nextCourseId) ?? null;
    if (advancedSchedule) return;
    setSlots((current) => {
      const template = {
        startTime: current[0]?.startTime ?? DEFAULT_START_TIME,
        endTime: current[0]?.endTime ?? DEFAULT_END_TIME,
        roomId: current[0]?.roomId ?? null,
      };
      return deriveSchedule(nextStart, course?.lessonsPerWeek ?? 1, template);
    });
  }

  function applyStartDate(value: string) {
    setStartDate(value);
    syncSchedule(value, courseId);
  }

  function applyCourse(value: string) {
    setCourseId(value);
    syncSchedule(startDate, value);
  }

  /** Muda o horário da grade inteira — é o que a tela normal oferece. */
  function applyTime(field: "startTime" | "endTime", value: string) {
    setSlots((current) =>
      current.length > 0
        ? current.map((slot) => ({ ...slot, [field]: value }))
        : deriveSchedule(startDate, 1, {
            startTime: field === "startTime" ? value : DEFAULT_START_TIME,
            endTime: field === "endTime" ? value : DEFAULT_END_TIME,
            roomId: null,
          })
    );
  }

  async function submit() {
    setSaving(true);
    setFormError(null);
    try {
      // Só o que a tela pergunta viaja no corpo; o que fica de fora é preservado
      // pelo servidor (ver parseClassInput).
      const body = {
        name,
        modality,
        courseId: courseId || null,
        // O primeiro da lista é o titular; os demais, auxiliares.
        teachers: teacherIds.map((employeeId, index) => ({
          employeeId,
          role: index === 0 ? "titular" : "auxiliar",
        })),
        startDate: startDate || null,
        endDate: endDate || null,
        capacity: capacity || null,
        roomId: roomId || null,
        notes,
        // String vazia vira `null` explícito para permitir DESFAZER a ponte; omitir o
        // campo preservaria o vínculo antigo (ver parseClassInput).
        trainingId: trainingId.trim() ? trainingId.trim() : null,
        schedule: slots,
      };
      const response = await fetch(editing ? `/api/academic/classes/${turma!.id}` : "/api/academic/classes", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar a turma.");
      onError(null);
      // O quadro de aulas nasce junto quando curso, grade e início estão
      // preenchidos — vale dizer quantas aulas saíram.
      const aulas = Number(data.class?.lessonsTotal ?? 0);
      const sufixo = aulas > 0 ? ` Quadro com ${aulas} aulas gerado (feriados pulados).` : "";
      onSaved(`${editing ? "Turma atualizada." : "Turma criada."}${sufixo}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar a turma.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!turma || !window.confirm(`Excluir a turma ${turma.name}?`)) return;
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/academic/classes/${turma.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir a turma.");
      onSaved("Turma excluída.", { deleted: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao excluir a turma.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">
              {editing ? "Editar turma" : duplicating ? "Duplicar turma" : "Nova turma"}
            </p>
            {duplicating ? (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500">
                <Copy className="h-3 w-3" />
                Grade e dados copiados de “{turma?.name}”. Os alunos não vêm junto.
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {formError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da turma *">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
                placeholder="Oratória — Terças 19h"
              />
            </Field>
            <Field label="Curso">
              <select
                value={courseId}
                onChange={(event) => applyCourse(event.target.value)}
                className={inputClass}
              >
                <option value="">Sem curso vinculado</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                    {course.lessonsCount ? ` — ${course.lessonsCount} aulas` : " — sem nº de aulas"}
                  </option>
                ))}
              </select>
              <p
                className={`mt-1 text-[10px] ${
                  courseId ? "text-[rgb(var(--slate-9))]" : "font-semibold text-amber-700"
                }`}
              >
                {/* Turma sem curso não aparece no seletor do fechamento, que
                    filtra pelo curso vendido — foi assim que uma turma criada
                    "sumiu" na hora de fechar a venda. */}
                {!courseId
                  ? "Sem curso vinculado, esta turma NÃO aparece no fechamento da venda nem gera quadro de aulas — escolha o curso."
                  : selectedCourse?.lessonsCount
                    ? `O quadro de aulas nasce com ${selectedCourse.lessonsCount} aulas e a turma aparece no fechamento da venda.`
                    : "A turma aparece no fechamento deste curso; sem nº de aulas no curso, o quadro de aulas não é gerado."}
              </p>
            </Field>
            <Field label="Professores">
              <div className="space-y-1.5">
                {teachers.length === 0 ? (
                  <p className="text-[11px] text-[rgb(var(--slate-9))]">
                    Nenhum usuário marcado como professor. Marque a caixa “Professor” em
                    Administração → Usuários.
                  </p>
                ) : (
                  teachers.map((teacher) => {
                    const index = teacherIds.indexOf(teacher.id);
                    const checked = index >= 0;
                    return (
                      <label key={teacher.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setTeacherIds((current) =>
                              checked
                                ? current.filter((id) => id !== teacher.id)
                                : [...current, teacher.id]
                            )
                          }
                        />
                        <span className="text-[rgb(var(--slate-11))]">{teacher.name}</span>
                        {index === 0 ? (
                          <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold text-cyan-800">
                            Titular
                          </span>
                        ) : checked ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                            Auxiliar
                          </span>
                        ) : null}
                      </label>
                    );
                  })
                )}
              </div>
              <p className="mt-1 text-[10px] text-[rgb(var(--slate-9))]">
                O primeiro marcado é o titular da turma; os demais entram como auxiliares. A lista vem
                de quem está marcado como professor em Usuários.
              </p>
            </Field>
            <Field label="Modalidade">
              <select
                value={modality}
                onChange={(event) => {
                  const next = event.target.value as ClassModality;
                  setModality(next);
                  if (next === "ciclica") setEndDate("");
                }}
                className={inputClass}
              >
                <option value="modular">Modular (tem data de término)</option>
                <option value="ciclica">Cíclica (sem término definido)</option>
              </select>
            </Field>
            <Field label="Início">
              <input
                type="date"
                value={startDate}
                onChange={(event) => applyStartDate(event.target.value)}
                className={inputClass}
              />
              {slots.length > 0 && weekdayOf(startDate) !== null ? (
                <p className="mt-1 text-[10px] text-[rgb(var(--slate-9))]">
                  A grade acompanha o início: aula toda {WEEKDAY_LABELS[weekdayOf(startDate)!].toLowerCase()}.
                </p>
              ) : null}
            </Field>
            <Field label="Término">
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={modality === "ciclica"}
                required={modality === "modular"}
                className={`${inputClass} disabled:bg-neutral-100`}
              />
            </Field>
            <Field label="Capacidade" hint="Vazio = sem limite de vagas.">
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Sala">
              <select value={roomId} onChange={(event) => setRoomId(event.target.value)} className={inputClass}>
                <option value="">Sem sala</option>
                {rooms.filter((room) => room.active || String(room.id) === roomId).map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}{room.active ? "" : " (inativa)"}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Observações" hint="Combinações da turma, material usado, avisos para quem cobre a aula.">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className={inputClass}
              placeholder="Ex.: turma fechada da empresa X; entra pela portaria lateral."
            />
          </Field>

          {/* ── GRADE ──────────────────────────────────────────────
              No caso normal (uma aula por semana, sempre no mesmo dia) a grade
              é RESULTADO do início e do curso, não pergunta. Montar dia a dia
              era o que produzia turma com aula em sete dias da semana. */}
          <div className="rounded-xl border border-neutral-200 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-neutral-800">Grade de horário</p>
                <p className="text-[11px] text-neutral-500">
                  {slots.length === 0
                    ? "Escolha a data de início — a grade sai dela."
                    : describeSchedule(slots)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdvancedSchedule((value) => !value)}
                className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600"
              >
                {advancedSchedule ? "Voltar ao automático" : "Ajustar grade"}
              </button>
            </div>

            {!advancedSchedule ? (
              slots.length === 0 ? (
                <p className="text-[11px] text-neutral-500">
                  Sem data de início ainda. A turma pode ser criada assim e a grade entra depois.
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-[10px] font-semibold text-neutral-500">
                    Começa
                    <input
                      type="time"
                      value={slots[0].startTime}
                      onChange={(event) => applyTime("startTime", event.target.value)}
                      className="ml-1 rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                    />
                  </label>
                  <label className="text-[10px] font-semibold text-neutral-500">
                    Termina
                    <input
                      type="time"
                      value={slots[0].endTime}
                      onChange={(event) => applyTime("endTime", event.target.value)}
                      className="ml-1 rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                    />
                  </label>
                  <p className="text-[11px] text-neutral-500">
                    {slots.length === 1
                      ? "Uma aula por semana, no dia do início."
                      : `${slots.length} aulas por semana, conforme o curso.`}{" "}
                    Precisa de outro dia ou horário diferente por dia? Use “Ajustar grade”.
                  </p>
                </div>
              )
            ) : (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setSlots((current) => [
                        ...current,
                        {
                          weekday: current.length === 0 ? (weekdayOf(startDate) ?? 1) : current[0].weekday,
                          startTime: current[0]?.startTime ?? DEFAULT_START_TIME,
                          endTime: current[0]?.endTime ?? DEFAULT_END_TIME,
                          teacherEmployeeId: null,
                          roomId: null,
                        },
                      ])
                    }
                    className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-semibold"
                  >
                    + Horário
                  </button>
                </div>
                {slots.map((slot, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={slot.weekday}
                      onChange={(event) =>
                        setSlots((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, weekday: Number(event.target.value) } : item
                          )
                        )
                      }
                      className="rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                    >
                      {WEEKDAY_LABELS.map((label, weekday) => (
                        <option key={weekday} value={weekday}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={slot.startTime}
                      onChange={(event) =>
                        setSlots((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, startTime: event.target.value } : item
                          )
                        )
                      }
                      className="rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                    />
                    <input
                      type="time"
                      value={slot.endTime}
                      onChange={(event) =>
                        setSlots((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, endTime: event.target.value } : item
                          )
                        )
                      }
                      className="rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                    />
                    <select
                      value={slot.roomId ?? ""}
                      onChange={(event) =>
                        setSlots((current) =>
                          current.map((item, position) =>
                            position === index
                              ? { ...item, roomId: event.target.value ? Number(event.target.value) : null }
                              : item
                          )
                        )
                      }
                      className="rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                      title="Sala deste horário"
                    >
                      <option value="">Sala da turma…</option>
                      {rooms.filter((room) => room.active).map((room) => (
                        <option key={room.id} value={room.id}>{room.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setSlots((current) => current.filter((_, position) => position !== index))}
                      className="rounded p-1 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <p className="text-[10px] text-neutral-500">
                  Enquanto esta seção estiver aberta, mudar o início não refaz a grade.
                </p>
              </div>
            )}
          </div>

          <details className="rounded-xl border border-neutral-200 p-3">
            <summary className="cursor-pointer text-xs font-bold text-neutral-800">Vínculo com treinamento antigo</summary>
            <p className="mt-1 text-[11px] text-neutral-500">
              Só preencha se esta turma corresponder a um treinamento do modelo antigo (o rótulo usado em
              Instituto UP, presença e mídia paga). Deixe vazio para turmas normais da escola — a turma nova
              convive com o treinamento antigo, não o substitui.
            </p>
            <input
              value={trainingId}
              onChange={(event) => setTrainingId(event.target.value)}
              className={`${inputClass} mt-2`}
              placeholder="Ex.: Aula Exclusiva 23/07/2026"
            />
          </details>
        </div>

        <div className="flex justify-between gap-2 border-t border-neutral-100 px-5 py-4">
          <div>
            {editing && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={saving}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-40"
              >
                Excluir turma
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "Salvar turma" : "Criar turma"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
