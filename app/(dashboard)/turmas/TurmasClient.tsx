"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarRange,
  DoorOpen,
  LayoutGrid,
  Plus,
  Search,
  UserRoundPlus,
  Users,
} from "lucide-react";
import {
  WEEKDAY_LABELS,
  describeClassPeriod,
  describeSchedule,
  humanizeClassSearch,
} from "@/lib/academicRules";
import { humanizeName } from "@/lib/utils";
import { ClassDetail, type StudentOption } from "./ClassDetail";
import { ClassForm } from "./ClassForm";
import { AcademicSettingsPanel } from "./AcademicSettingsPanel";
import { WeeklyGrid } from "./WeeklyGrid";
import { ClassStatusPill, OccupancyBar, inputClass } from "./TurmasUI";
import type {
  AcademicCalendarDay,
  AcademicClass,
  AcademicRoom,
  AcademicUnlinkedEnrollment,
  ClassStatus,
} from "@/types/academic";

/**
 * Turmas: lista com filtros à esquerda, turma escolhida à direita.
 *
 * O desenho mudou de "grade de cards + modal" para mestre-detalhe porque toda
 * operação real da secretaria é sobre UMA turma (quem está nela, quem entra, quem
 * sai, quando ela encontra) — e um modal por ação fazia perder o contexto a cada
 * clique. A turma escolhida vive na URL (`?turma=`), então o link pode ser mandado
 * pro professor.
 */

interface TurmasClientProps {
  initialClasses: AcademicClass[];
  initialRooms: AcademicRoom[];
  initialCalendarDays: AcademicCalendarDay[];
  students: StudentOption[];
  /** Contratos do Financeiro que ainda não viraram ficha de aluno (fila de entrada). */
  unlinkedEnrollments: AcademicUnlinkedEnrollment[];
  /** Cursos ativos: a turma precisa de um para saber quantas aulas gerar. */
  courses: CourseOption[];
  /** Quadro de funcionários que pode ser professor da turma. */
  teachers: TeacherOption[];
  canManage: boolean;
  canManageStudents: boolean;
  canDeleteStudents: boolean;
  initialClassId: number | null;
  /** `?aba=diario&aula=` — o link que a tela de Chamada manda para cá. */
  initialTab?: "diario" | null;
  initialLessonId?: number | null;
}

export interface CourseOption {
  id: number;
  name: string;
  lessonsCount: number | null;
  /** Quantas aulas por semana — define quantos dias a grade automática cria. */
  lessonsPerWeek: number;
}

export interface TeacherOption {
  id: number;
  name: string;
}

type ViewMode = "turmas" | "grade" | "ajustes";

export function TurmasClient({
  initialClasses,
  initialRooms,
  initialCalendarDays,
  students,
  unlinkedEnrollments,
  courses,
  teachers,
  canManage,
  canManageStudents,
  canDeleteStudents,
  initialClassId,
  initialTab = null,
  initialLessonId = null,
}: TurmasClientProps) {
  const [classes, setClasses] = useState(initialClasses);
  const [rooms, setRooms] = useState(initialRooms);
  const [calendarDays, setCalendarDays] = useState(initialCalendarDays);
  const [view, setView] = useState<ViewMode>("turmas");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<{ turma: AcademicClass | null; duplicating: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(
    initialClassId ?? initialClasses.find((item) => item.status === "ativa")?.id ?? initialClasses[0]?.id ?? null
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ClassStatus | "">("");
  const [roomId, setRoomId] = useState("");
  const [weekday, setWeekday] = useState("");
  const [seats, setSeats] = useState("");

  const router = useRouter();

  const reload = useCallback(
    async (message?: string | null) => {
      if (message !== undefined) setNotice(message);
      const response = await fetch("/api/academic/classes");
      const data = await response.json().catch(() => ({}));
      if (response.ok) setClasses(data.classes ?? []);
      // A lista de alunos (fila de alocação, "já está em outra turma") vem do
      // componente de servidor. Sem este refresh, alocar alguém deixava a fila
      // mostrando a mesma pessoa esperando — a informação errada mais fácil de crer.
      router.refresh();
    },
    [router]
  );

  function select(classId: number | null) {
    setSelectedId(classId);
    setView("turmas");
    // History API em vez de router.push: trocar de turma não é navegação nova e não
    // pode empilhar uma entrada no botão "voltar" a cada clique da secretaria.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (classId) url.searchParams.set("turma", String(classId));
      else url.searchParams.delete("turma");
      window.history.replaceState(null, "", url.toString());
    }
  }

  const filtered = useMemo(() => {
    const term = humanizeClassSearch(search);
    return classes.filter((turma) => {
      // "Ativas" inclui as poucas turmas que ficaram como planejadas antes de a tela
      // parar de perguntar a situação — para o usuário, tudo que não foi encerrado
      // está em andamento.
      if (status === "ativa" && turma.status === "encerrada") return false;
      if (status === "encerrada" && turma.status !== "encerrada") return false;
      if (roomId) {
        const uses =
          String(turma.roomId ?? "") === roomId ||
          turma.schedule.some((slot) => String(slot.roomId ?? "") === roomId);
        if (!uses) return false;
      }
      if (weekday !== "" && !turma.schedule.some((slot) => String(slot.weekday) === weekday)) return false;
      if (seats === "com_vaga" && turma.seatsLeft === 0) return false;
      if (seats === "lotada" && turma.seatsLeft !== 0) return false;
      if (term) {
        const haystack = humanizeClassSearch([turma.name, turma.roomName].filter(Boolean).join(" "));
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [classes, search, status, roomId, weekday, seats]);

  const selected = classes.find((turma) => turma.id === selectedId) ?? null;

  const kpis = useMemo(() => {
    const ativas = classes.filter((turma) => turma.status !== "encerrada");
    const alocados = classes.reduce((total, turma) => total + turma.activeStudents, 0);
    const vagas = classes
      .filter((turma) => turma.status !== "encerrada")
      .reduce((total, turma) => total + (turma.seatsLeft ?? 0), 0);
    const lotadas = classes.filter((turma) => turma.status !== "encerrada" && turma.seatsLeft === 0).length;
    const semGrade = classes.filter((turma) => turma.status !== "encerrada" && turma.schedule.length === 0).length;
    return { ativas: ativas.length, alocados, vagas, lotadas, semGrade };
  }, [classes]);

  const waiting = useMemo(
    () => students.filter((student) => student.contractsCount > 0 && student.activeClasses.length === 0),
    [students]
  );

  async function allocate(studentId: number, classId: number) {
    setError(null);
    const response = await fetch(`/api/academic/classes/${classId}/students`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Falha ao alocar o aluno.");
      return;
    }
    await reload("Aluno alocado na turma.");
  }

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[rgb(var(--slate-12))]">
            <BookOpen className="h-5 w-5 text-[rgb(var(--blue-9))]" />
            Turmas
          </h1>
          <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">
            Turma modular tem data de término (permite certificado); cíclica não tem. O curso vem da mesma tabela
            de preços do Financeiro, e o aluno entra na turma depois que a venda fecha.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormState({ turma: null, duplicating: false })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            Nova turma
          </button>
        )}
      </header>

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Turmas ativas" value={kpis.ativas} hint={`${classes.length} no total`} />
        <Kpi label="Alunos alocados" value={kpis.alocados} hint="vínculos ativos" />
        <Kpi label="Vagas livres" value={kpis.vagas} hint="só turmas com capacidade" />
        <Kpi label="Turmas lotadas" value={kpis.lotadas} tone={kpis.lotadas > 0 ? "amber" : "slate"} />
        <Kpi
          label="Aguardando alocação"
          value={waiting.length}
          hint="com contrato, sem turma"
          tone={waiting.length > 0 ? "amber" : "slate"}
        />
      </div>

      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      ) : null}
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {kpis.semGrade > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {kpis.semGrade} turma(s) em andamento sem grade de horário — elas não entram na grade semanal nem projetam
          próximas aulas.
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-1">
        {(
          [
            ["turmas", "Turmas", LayoutGrid],
            ["grade", "Grade semanal", CalendarRange],
            ["ajustes", "Salas e calendário", DoorOpen],
          ] as Array<[ViewMode, string, typeof LayoutGrid]>
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              view === key
                ? "bg-[rgb(var(--slate-12))] text-white"
                : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>

      {view !== "ajustes" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-2">
          <div className="relative min-w-[13rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar turma, curso, professor ou sala…"
              className={`${inputClass} pl-8`}
            />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value as ClassStatus | "")} className={`${inputClass} w-40`}>
            <option value="">Ativas e encerradas</option>
            <option value="ativa">Só ativas</option>
            <option value="encerrada">Só encerradas</option>
          </select>
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)} className={`${inputClass} w-36`}>
            <option value="">Todas as salas</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
          <select value={weekday} onChange={(event) => setWeekday(event.target.value)} className={`${inputClass} w-32`}>
            <option value="">Qualquer dia</option>
            {WEEKDAY_LABELS.map((label, index) => (
              <option key={label} value={index}>{label}</option>
            ))}
          </select>
          <select value={seats} onChange={(event) => setSeats(event.target.value)} className={`${inputClass} w-32`}>
            <option value="">Com e sem vaga</option>
            <option value="com_vaga">Com vaga</option>
            <option value="lotada">Lotadas</option>
          </select>
          {(search || status || roomId || weekday || seats) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatus("");
                setRoomId("");
                setWeekday("");
                setSeats("");
              }}
              className="h-9 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))]"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : null}

      {view === "turmas" ? (
        <>
          {waiting.length > 0 && canManage ? (
            <details className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <summary className="cursor-pointer text-xs font-bold text-amber-900">
                Fila de alocação — {waiting.length} aluno(s) com contrato e sem turma
              </summary>
              <p className="mt-1 text-[11px] text-amber-800">
                Estado normal: a venda fecha antes de a logística encaixar o aluno num horário. Escolha a turma na
                lista abaixo e aloque daqui.
              </p>
              <ul className="mt-2 space-y-1">
                {waiting.slice(0, 12).map((student) => (
                  <li key={student.id} className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1.5">
                    <span className="min-w-0 truncate text-xs font-semibold text-amber-950">
                      {humanizeName(student.name) || student.name}
                    </span>
                    <button
                      type="button"
                      disabled={!selected}
                      title={selected ? `Alocar em ${selected.name}` : "Escolha uma turma na lista primeiro"}
                      onClick={() => selected && void allocate(student.id, selected.id)}
                      className="inline-flex h-7 flex-none items-center gap-1 rounded-md bg-amber-600 px-2 text-[11px] font-semibold text-white disabled:opacity-40"
                    >
                      <UserRoundPlus className="h-3 w-3" />
                      {selected ? `Alocar em ${selected.name}` : "Escolha uma turma"}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-[21rem_minmax(0,1fr)]">
            <aside className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                {filtered.length} turma(s)
              </p>
              <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-6 text-center text-xs text-[rgb(var(--slate-9))]">
                    {classes.length === 0
                      ? "Nenhuma turma cadastrada ainda."
                      : "Nenhuma turma com esses filtros."}
                  </p>
                ) : (
                  filtered.map((turma) => (
                    <button
                      key={turma.id}
                      type="button"
                      onClick={() => select(turma.id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        selectedId === turma.id
                          ? "border-[rgb(var(--blue-9))] bg-blue-50/60"
                          : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] hover:bg-[rgb(var(--slate-2))]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{turma.name}</p>
                        <ClassStatusPill status={turma.status} />
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--slate-10))]">
                        {turma.modality === "modular" ? "Modular" : "Cíclica"}
                        {turma.roomName ? ` · ${turma.roomName}` : ""}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--slate-9))]">
                        {describeSchedule(turma.schedule)}
                      </p>
                      {/* Duas turmas podem ter o mesmo nome e o mesmo curso — o
                          período é o que as distingue na lista. */}
                      {describeClassPeriod(turma.startDate, turma.endDate) && (
                        <p className="mt-0.5 truncate text-[11px] font-medium text-[rgb(var(--slate-10))]">
                          {describeClassPeriod(turma.startDate, turma.endDate)}
                        </p>
                      )}
                      <div className="mt-1.5">
                        <OccupancyBar capacity={turma.capacity} activeStudents={turma.activeStudents} compact />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </aside>

            {selected ? (
              <ClassDetail
                key={selected.id}
                turma={selected}
                classes={classes}
                students={students}
                unlinkedEnrollments={unlinkedEnrollments}
                calendarDays={calendarDays}
                canManage={canManage}
                canManageStudents={canManageStudents}
                canDeleteStudents={canDeleteStudents}
                initialTab={initialTab}
                initialLessonId={initialLessonId}
                onChanged={(message) => void reload(message)}
                onSelectClass={select}
                onEdit={() => setFormState({ turma: selected, duplicating: false })}
                onDuplicate={() => setFormState({ turma: selected, duplicating: true })}
              />
            ) : (
              <div className="grid place-items-center rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-10 text-center">
                <div>
                  <Users className="mx-auto h-6 w-6 text-[rgb(var(--slate-8))]" />
                  <p className="mt-2 text-sm font-semibold text-[rgb(var(--slate-11))]">
                    Escolha uma turma na lista
                  </p>
                  <p className="mt-1 text-xs text-[rgb(var(--slate-9))]">
                    Alunos, grade, próximas aulas e histórico aparecem aqui.
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}

      {view === "grade" ? (
        <WeeklyGrid classes={filtered} selectedClassId={selectedId} onSelectClass={select} />
      ) : null}

      {view === "ajustes" ? (
        <AcademicSettingsPanel
          rooms={rooms}
          calendarDays={calendarDays}
          canManage={canManage}
          onRoomsChanged={setRooms}
          onCalendarChanged={setCalendarDays}
        />
      ) : null}

      {formState && canManage && (
        <ClassForm
          key={`${formState.turma?.id ?? "novo"}-${formState.duplicating ? "copia" : "edicao"}`}
          turma={formState.turma}
          duplicating={formState.duplicating}
          rooms={rooms}
          courses={courses}
          teachers={teachers}
          onClose={() => setFormState(null)}
          onSaved={(message, options) => {
            setFormState(null);
            if (options?.deleted) select(null);
            void reload(message);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "slate" | "amber";
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "amber"
          ? "border-amber-200 bg-amber-50"
          : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">{label}</p>
      <p className={`mt-1 text-xl font-black ${tone === "amber" ? "text-amber-900" : "text-[rgb(var(--slate-12))]"}`}>
        {value}
      </p>
      {hint ? <p className="text-[10px] text-[rgb(var(--slate-9))]">{hint}</p> : null}
    </div>
  );
}
