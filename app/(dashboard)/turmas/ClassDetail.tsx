"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  History,
  Loader2,
  MessageCircle,
  Pencil,
  Search,
  Trash2,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import {
  CLASS_STUDENT_STATUS_LABELS,
  WEEKDAY_SHORT,
  describeSchedule,
  expandClassSessions,
  formatCpf,
  formatMinutes,
} from "@/lib/academicRules";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import { AttendancePanel } from "./AttendancePanel";
import { LessonPlanPanel } from "./LessonPlanPanel";
import {
  ClassStatusPill,
  Field,
  LinkStatusPill,
  OccupancyBar,
  formatDateBR,
  formatDateTimeBR,
  inputClass,
  money,
} from "./TurmasUI";
import { StudentDrawer } from "./StudentDrawer";
import type {
  AcademicCalendarDay,
  AcademicClass,
  AcademicClassHistoryEvent,
  AcademicClassRosterRow,
  AcademicRosterPayment,
  AcademicUnlinkedEnrollment,
  ClassStudentStatus,
} from "@/types/academic";

export interface StudentOption {
  id: number;
  name: string;
  cpf: string | null;
  phone: string | null;
  activeClasses: Array<{ classId: number; className: string }>;
  contractsCount: number;
}

type Tab = "visao" | "alunos" | "grade" | "diario" | "historico";

/**
 * Detalhe da turma escolhida: dados, alunos, grade e histórico.
 *
 * A lista de alunos vive AQUI e não numa janela solta porque toda ação sobre o aluno
 * (trancar, transferir, tirar) depende de ver a ocupação da turma no mesmo instante —
 * era o que faltava quando a alocação morava num modal sem contexto.
 */
export function ClassDetail({
  turma,
  classes,
  students,
  unlinkedEnrollments,
  calendarDays,
  canManage,
  canManageStudents,
  canDeleteStudents,
  initialTab = null,
  initialLessonId = null,
  onChanged,
  onSelectClass,
  onEdit,
  onDuplicate,
}: {
  turma: AcademicClass;
  classes: AcademicClass[];
  students: StudentOption[];
  unlinkedEnrollments: AcademicUnlinkedEnrollment[];
  calendarDays: AcademicCalendarDay[];
  canManage: boolean;
  canManageStudents: boolean;
  canDeleteStudents: boolean;
  initialTab?: Tab | null;
  initialLessonId?: number | null;
  onChanged: (message: string | null) => void;
  onSelectClass: (classId: number) => void;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "visao");
  const [roster, setRoster] = useState<AcademicClassRosterRow[]>([]);
  const [history, setHistory] = useState<AcademicClassHistoryEvent[]>([]);
  const [includeFinance, setIncludeFinance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [allocateQuery, setAllocateQuery] = useState("");
  const [editingDates, setEditingDates] = useState<AcademicClassRosterRow | null>(null);
  const [transferring, setTransferring] = useState<AcademicClassRosterRow | null>(null);
  const [openStudentId, setOpenStudentId] = useState<number | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [enrolling, setEnrolling] = useState<AcademicUnlinkedEnrollment | null>(null);
  /**
   * Quem comprou ESTA turma e não está no diário dela. A matrícula guarda a
   * turma vendida numa coluna própria, mas quem entra no diário é a ficha do
   * aluno — sem ficha criada, a chamada abre vazia no dia da aula e nada na
   * tela explica por quê.
   */
  const [pendingSeats, setPendingSeats] = useState<
    Array<{ enrollmentId: number; name: string; studentId: number | null; additional: boolean; courseName: string | null }>
  >([]);
  const [seating, setSeating] = useState<number | null>(null);

  const loadPendingSeats = useCallback(() => {
    return fetch(`/api/academic/classes/${turma.id}/students`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { pending?: typeof pendingSeats } | null) => setPendingSeats(data?.pending ?? []))
      .catch(() => setPendingSeats([]));
  }, [turma.id]);

  useEffect(() => {
    void loadPendingSeats();
  }, [loadPendingSeats]);

  const load = useCallback(
    (options: { silent?: boolean } = {}) => {
      if (!options.silent) setLoading(true);
      return fetch(`/api/academic/classes/${turma.id}`)
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            data: {
              roster?: AcademicClassRosterRow[];
              history?: AcademicClassHistoryEvent[];
              includeFinance?: boolean;
            } | null
          ) => {
            setRoster(data?.roster ?? []);
            setHistory(data?.history ?? []);
            setIncludeFinance(Boolean(data?.includeFinance));
            setLoading(false);
          }
        )
        .catch(() => setLoading(false));
    },
    [turma.id]
  );

  useEffect(() => {
    let cancelled = false;
    setTab("visao");
    fetch(`/api/academic/classes/${turma.id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            roster?: AcademicClassRosterRow[];
            history?: AcademicClassHistoryEvent[];
            includeFinance?: boolean;
          } | null
        ) => {
          if (cancelled) return;
          setRoster(data?.roster ?? []);
          setHistory(data?.history ?? []);
          setIncludeFinance(Boolean(data?.includeFinance));
          setLoading(false);
        }
      )
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [turma.id]);

  const activeRoster = roster.filter((row) => row.status === "ativa");
  const visibleRoster = useMemo(() => {
    const term = rosterSearch.trim().toLocaleLowerCase("pt-BR");
    return roster
      .filter((row) => (showInactive ? true : row.status === "ativa"))
      .filter((row) =>
        term
          ? [row.studentName, row.cpf, row.phone, row.email]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term))
          : true
      );
  }, [roster, rosterSearch, showInactive]);

  /**
   * Situação de pagamento dos alunos da turma.
   *
   * É sobre OS ALUNOS, não sobre a turma: o total contratado soma todos os contratos
   * de cada aluno (quem faz dois cursos aparece com os dois). Rotular isso como
   * "receita da turma" seria inventar um número que ninguém consegue conferir — a
   * pergunta que a tela responde é "quem daqui está devendo".
   */
  const paymentSummary = useMemo(() => {
    const rows = roster.filter((row) => row.status === "ativa" && row.payment);
    return rows.reduce(
      (acc, row) => {
        const payment = row.payment!;
        acc.considered += 1;
        acc.contracted += row.contractedAmount ?? 0;
        acc.paid += row.paidAmount ?? 0;
        if (payment.status === "atrasado") {
          acc.late += 1;
          acc.lateAmount += payment.uncoveredAmount;
          acc.worstDaysLate = Math.max(acc.worstDaysLate, payment.daysLate);
        } else if (payment.status === "a_conciliar") acc.toReconcile += 1;
        else if (payment.status === "sem_cronograma") acc.withoutSchedule += 1;
        return acc;
      },
      {
        considered: 0,
        contracted: 0,
        paid: 0,
        late: 0,
        lateAmount: 0,
        toReconcile: 0,
        withoutSchedule: 0,
        worstDaysLate: 0,
      }
    );
  }, [roster]);

  const sessions = useMemo(
    () =>
      expandClassSessions({
        schedule: turma.schedule,
        startDate: turma.startDate,
        endDate: turma.endDate,
        calendar: calendarDays,
        from: new Date().toISOString().slice(0, 10),
        limit: 8,
      }),
    [turma.schedule, turma.startDate, turma.endDate, calendarDays]
  );

  const allocationCandidates = useMemo(() => {
    const term = allocateQuery.trim().toLocaleLowerCase("pt-BR");
    const alreadyActive = new Set(activeRoster.map((row) => row.studentId));
    return students
      .filter((student) => !alreadyActive.has(student.id))
      .filter((student) =>
        term
          ? [student.name, student.cpf, student.phone]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term))
          : true
      )
      .sort((left, right) => {
        // Quem tem contrato e nenhuma turma aparece primeiro: é a fila que a
        // logística precisa esvaziar ("matriculado, aguardando alocação").
        const leftWaiting = left.contractsCount > 0 && left.activeClasses.length === 0 ? 0 : 1;
        const rightWaiting = right.contractsCount > 0 && right.activeClasses.length === 0 ? 0 : 1;
        return leftWaiting - rightWaiting || left.name.localeCompare(right.name, "pt-BR");
      })
      .slice(0, 8);
  }, [students, allocateQuery, activeRoster]);

  const waitingCount = students.filter(
    (student) => student.contractsCount > 0 && student.activeClasses.length === 0
  ).length;

  async function call(endpoint: string, init: RequestInit, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
      // A rota devolve a lista já atualizada; só quando não devolve é que vale um
      // GET a mais. O histórico, esse sim, precisa do GET para incluir o evento novo.
      if (Array.isArray(data.roster)) setRoster(data.roster);
      await load({ silent: true });
      // A contagem de alunos vive no card da turma: sem avisar o pai, a ocupação da
      // esquerda discordaria da lista da direita.
      onChanged(successMessage);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Não foi possível concluir a operação.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    // A mesma planilha serve para a chamada e para a cobrança — as duas colunas de
    // pagamento só saem para quem pode ver dinheiro (o servidor nem manda o resto).
    const header = ["Aluno", "CPF", "Telefone", "E-mail", "Situação", "Entrada", "Saída"];
    if (includeFinance) header.push("Pagamento", "Em atraso (R$)");
    const lines = visibleRoster.map((row) =>
      [
        row.studentName,
        row.cpf ? formatCpf(row.cpf) : "",
        row.phone ?? "",
        row.email ?? "",
        CLASS_STUDENT_STATUS_LABELS[row.status],
        formatDateBR(row.startDate),
        formatDateBR(row.endDate),
        ...(includeFinance
          ? [
              row.payment ? PAYMENT_LABELS[row.payment.status] : "—",
              row.payment && row.payment.uncoveredAmount > 0
                ? row.payment.uncoveredAmount.toFixed(2).replace(".", ",")
                : "",
            ]
          : []),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(";")
    );
    // BOM na frente porque o Excel em pt-BR abre UTF-8 sem BOM como Latin-1 e
    // transforma "Ação" em "AÃ§Ã£o" — a planilha da chamada chega errada na mão de
    // quem imprime.
    const blob = new Blob([`﻿${[header.join(";"), ...lines].join("\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `turma-${turma.name.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function closeClassNow(linkStatus: "concluida" | "cancelada") {
    setShowClose(false);
    await call(
      `/api/academic/classes/${turma.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkStatus }),
      },
      "Turma encerrada."
    );
  }

  return (
    <section className="flex min-h-[28rem] flex-col rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
      <header className="border-b border-[rgb(var(--border-weak))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[rgb(var(--slate-12))]">{turma.name}</h2>
              <ClassStatusPill status={turma.status} />
              {turma.trainingId ? (
                <span className="rounded bg-[rgb(var(--slate-3))] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--slate-11))]">
                  treinamento: {turma.trainingId}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">
              {turma.modality === "modular" ? "Modular" : "Cíclica"}
              {turma.roomName ? ` · ${turma.roomName}` : " · sem sala"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={exportCsv}
              title="Baixar a lista de alunos em CSV (lista de chamada)"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-2.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]"
            >
              <Download className="h-3.5 w-3.5" /> Lista
            </button>
            {canManage ? (
              <>
                <button
                  type="button"
                  onClick={onDuplicate}
                  title="Criar uma turma nova com os mesmos dados e grade"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-2.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]"
                >
                  <Copy className="h-3.5 w-3.5" /> Duplicar
                </button>
                {turma.status !== "encerrada" ? (
                  <button
                    type="button"
                    onClick={() => setShowClose(true)}
                    disabled={busy}
                    title="Encerrar a turma e fechar os vínculos dos alunos ativos"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-800 disabled:opacity-40"
                  >
                    Encerrar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-[11px] font-semibold text-white"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
              </>
            ) : null}
          </div>
        </div>

        <nav className="mt-3 flex flex-wrap gap-1">
          {(
            [
              ["visao", "Visão geral", ClipboardList],
              ["alunos", `Alunos (${activeRoster.length})`, Users],
              ["grade", "Grade e aulas", CalendarClock],
              ["diario", "Diário", ClipboardCheck],
              ["historico", "Histórico", History],
            ] as Array<[Tab, string, typeof Users]>
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                tab === key
                  ? "bg-[rgb(var(--slate-12))] text-white"
                  : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 p-4">
        {error ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

        {tab === "visao" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">Ocupação</p>
                <OccupancyBar capacity={turma.capacity} activeStudents={turma.activeStudents} />
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[rgb(var(--slate-11))]">
                  {(Object.keys(turma.studentsByStatus) as ClassStudentStatus[])
                    .filter((status) => turma.studentsByStatus[status] > 0)
                    .map((status) => (
                      <span key={status} className="inline-flex items-center gap-1">
                        <LinkStatusPill status={status} /> {turma.studentsByStatus[status]}
                      </span>
                    ))}
                </div>
              </div>

              {turma.linkedContracts > 0 && turma.capacity !== null && turma.linkedContracts > turma.capacity ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                  {turma.linkedContracts} contratos apontam para esta turma, que tem {turma.capacity} vagas. A
                  capacidade só é checada na hora de alocar — alguém vai ficar sem lugar.
                </p>
              ) : null}

              {paymentSummary.considered > 0 ? (
                <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                      Pagamento dos alunos
                    </p>
                    <a
                      href={`/matriculas?turma=${turma.id}`}
                      className="text-[11px] font-semibold text-[rgb(var(--blue-9))] hover:underline"
                    >
                      ver em Matrículas
                    </a>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <span className={paymentSummary.late > 0 ? "font-bold text-rose-700" : "text-[rgb(var(--slate-11))]"}>
                      {paymentSummary.late} em atraso
                      {paymentSummary.late > 0
                        ? ` · ${money(paymentSummary.lateAmount)} · até ${paymentSummary.worstDaysLate} dias`
                        : ""}
                    </span>
                    {paymentSummary.toReconcile > 0 ? (
                      <span className="font-bold text-amber-700">{paymentSummary.toReconcile} a conciliar</span>
                    ) : null}
                    <span className="text-[rgb(var(--slate-11))]">
                      {paymentSummary.considered - paymentSummary.late - paymentSummary.toReconcile} em dia
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-[rgb(var(--slate-9))]">
                    {money(paymentSummary.paid)} recebidos de {money(paymentSummary.contracted)} contratados — soma
                    TODOS os contratos destes alunos, inclusive de outros cursos. Não é a receita desta turma.
                  </p>
                </div>
              ) : null}

              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-[rgb(var(--border-weak))] p-3 text-xs">
                <Detail label="Início" value={formatDateBR(turma.startDate)} />
                <Detail label="Término" value={turma.modality === "ciclica" ? "Turma cíclica" : formatDateBR(turma.endDate)} />
                <Detail label="Carga semanal" value={formatMinutes(turma.weeklyMinutes)} />
                <Detail label="Encontros por semana" value={String(turma.schedule.length)} />
                <Detail label="Sala padrão" value={turma.roomName ?? "—"} />
                <Detail
                  label="Contratos na turma"
                  value={turma.linkedContracts === 0 ? "nenhum" : String(turma.linkedContracts)}
                />
              </dl>

              {turma.notes ? (
                <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">Observações</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[rgb(var(--slate-11))]">{turma.notes}</p>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">Grade</p>
                <p className="mt-1 text-xs text-[rgb(var(--slate-11))]">{describeSchedule(turma.schedule)}</p>
              </div>
              <NextSessions sessions={sessions} hasSchedule={turma.schedule.length > 0} />
            </div>
          </div>
        ) : null}

        {tab === "alunos" ? (
          <div className="space-y-3">
            {/* Comprou e não está na chamada. Vem antes da busca de alocação
                porque é uma pendência com nome e sobrenome, e não uma tarefa
                que alguém precisa lembrar de procurar. */}
            {pendingSeats.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-900">
                  {pendingSeats.length} pessoa(s) compraram esta turma e não estão no diário
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  Quem entra no diário é a ficha do aluno. Enquanto ela não existir, a matrícula aponta para a
                  turma e a chamada continua vazia.
                </p>
                <ul className="mt-2 space-y-1">
                  {pendingSeats.map((seat) => (
                    <li
                      key={`${seat.enrollmentId}-${seat.studentId ?? "novo"}-${seat.additional ? "co" : "pg"}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[rgb(var(--slate-12))]">
                          {humanizeName(seat.name) || seat.name}
                          {seat.additional && (
                            <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                              2º do contrato
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[10px] text-[rgb(var(--slate-9))]">
                          Matrícula #{seat.enrollmentId}
                          {seat.courseName ? ` · ${seat.courseName}` : ""}
                          {seat.studentId ? " · ficha existe, falta a cadeira" : " · falta criar a ficha"}
                        </p>
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          disabled={seating === seat.enrollmentId}
                          onClick={() => {
                            setSeating(seat.enrollmentId);
                            void fetch("/api/contracts/intake", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ modo: "rapido", enrollmentId: seat.enrollmentId }),
                            })
                              .then(() => Promise.all([load({ silent: true }), loadPendingSeats()]))
                              .finally(() => setSeating(null));
                          }}
                          className="flex-none rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {seating === seat.enrollmentId ? "Colocando…" : "Colocar no diário"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canManage ? (
              <div className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[rgb(var(--slate-12))]">Alocar aluno nesta turma</p>
                  <p className="text-[11px] text-[rgb(var(--slate-9))]">
                    {waitingCount > 0 ? `${waitingCount} aluno(s) com contrato aguardando turma` : "Ninguém aguardando alocação"}
                  </p>
                </div>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={allocateQuery}
                    onChange={(event) => setAllocateQuery(event.target.value)}
                    placeholder="Buscar aluno por nome, CPF ou telefone…"
                    className={`${inputClass} pl-8`}
                  />
                </div>
                <ul className="mt-2 space-y-1">
                  {allocationCandidates.length === 0 ? (
                    <li className="py-2 text-center text-[11px] text-neutral-400">
                      Nenhum aluno encontrado. O cadastro do aluno nasce em Gestão de Alunos, depois da venda.
                    </li>
                  ) : (
                    allocationCandidates.map((student) => (
                      <li
                        key={student.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-[rgb(var(--border-weak))] px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[rgb(var(--slate-12))]">
                            {humanizeName(student.name) || student.name}
                          </p>
                          <p className="truncate text-[10px] text-[rgb(var(--slate-9))]">
                            {student.activeClasses.length > 0
                              ? `já em ${student.activeClasses.map((item) => item.className).join(", ")}`
                              : student.contractsCount > 0
                                ? "matriculado, aguardando alocação"
                                : "sem contrato registrado"}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void call(
                              `/api/academic/classes/${turma.id}/students`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ studentId: student.id }),
                              },
                              `${student.name} alocado na turma.`
                            )
                          }
                          className="inline-flex h-7 flex-none items-center gap-1 rounded-md bg-neutral-900 px-2 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          <UserRoundPlus className="h-3 w-3" /> Alocar
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}

            {canManage && canManageStudents && unlinkedEnrollments.length > 0 ? (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-900">
                  Matriculados ainda sem ficha de aluno ({unlinkedEnrollments.length})
                </p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  O contrato existe no Financeiro, mas quem entra na turma é a ficha do aluno — é ela que guarda CPF,
                  contato e responsável. Cadastre aqui e a pessoa já entra nesta turma, com o contrato vinculado.
                </p>
                <ul className="mt-2 space-y-1">
                  {unlinkedEnrollments.slice(0, 10).map((enrollment) => (
                    <li
                      key={enrollment.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-amber-950">
                          {humanizeName(enrollment.studentName) || enrollment.studentName}
                        </p>
                        <p className="truncate text-[10px] text-amber-800">
                          {enrollment.courseName ?? "Sem curso"} · venda {formatDateBR(enrollment.saleDate)}
                          {enrollment.leadInscricaoId ? ` · lead #${enrollment.leadInscricaoId}` : " · sem lead"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEnrolling(enrollment)}
                        className="inline-flex h-7 flex-none items-center gap-1 rounded-md bg-amber-600 px-2 text-[11px] font-semibold text-white"
                      >
                        <UserRoundPlus className="h-3 w-3" /> Cadastrar e alocar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  value={rosterSearch}
                  onChange={(event) => setRosterSearch(event.target.value)}
                  placeholder="Buscar na lista da turma…"
                  className={`${inputClass} pl-8`}
                />
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Mostrar trancados, concluídos e cancelados
              </label>
            </div>

            {loading ? (
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-neutral-300" />
            ) : visibleRoster.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-8 text-center text-xs text-[rgb(var(--slate-9))]">
                {roster.length === 0 ? "Nenhum aluno alocado nesta turma." : "Nenhum aluno com esse filtro."}
              </p>
            ) : (
              <ul className="divide-y divide-[rgb(var(--border-weak))]">
                {visibleRoster.map((row) => (
                  <li key={row.linkId} className="py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenStudentId(row.studentId)}
                            className="truncate text-sm font-semibold text-[rgb(var(--slate-12))] hover:underline"
                          >
                            {humanizeName(row.studentName) || row.studentName}
                          </button>
                          <LinkStatusPill status={row.status} />
                          {row.studentStatus !== "ativo" ? (
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                              aluno {row.studentStatus}
                            </span>
                          ) : null}
                          {row.otherActiveClasses.map((other) => (
                            <button
                              key={other.classId}
                              type="button"
                              onClick={() => onSelectClass(other.classId)}
                              title="Abrir a outra turma deste aluno"
                              className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"
                            >
                              também em {other.className}
                            </button>
                          ))}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--slate-10))]">
                          {row.cpf ? formatCpf(row.cpf) : "sem CPF"}
                          {row.phone ? ` · ${row.phone}` : ""}
                          {row.email ? ` · ${row.email}` : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[rgb(var(--slate-9))]">
                          Entrada {formatDateBR(row.startDate)}
                          {row.endDate ? ` · saída ${formatDateBR(row.endDate)}` : ""}
                          {row.guardianName ? ` · responsável: ${row.guardianName}` : ""}
                          {includeFinance && row.contractsCount !== null
                            ? ` · ${row.contractsCount > 0 ? `${money(row.paidAmount)} pagos de ${money(row.contractedAmount)}` : "sem contrato"}`
                            : ""}
                        </p>
                        {row.payment ? <PaymentPill payment={row.payment} /> : null}
                      </div>

                      <div className="flex flex-none flex-wrap items-center gap-1">
                        {row.phone ? (
                          <a
                            href={buildWhatsAppWebUrl(row.phone)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => openWhatsAppOnMobile(event, row.phone)}
                            title="WhatsApp"
                            className="grid h-7 w-7 place-items-center rounded-md border border-[rgb(var(--border-weak))] text-emerald-700 hover:bg-emerald-50"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        {canManage ? (
                          <>
                            <select
                              value={row.status}
                              disabled={busy}
                              onChange={(event) =>
                                void call(
                                  `/api/academic/classes/${turma.id}/students`,
                                  {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ linkId: row.linkId, status: event.target.value }),
                                  },
                                  "Situação do aluno na turma atualizada."
                                )
                              }
                              className="h-7 rounded-md border border-[rgb(var(--border-weak))] px-1.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]"
                              title="Situação do aluno nesta turma"
                            >
                              {(Object.keys(CLASS_STUDENT_STATUS_LABELS) as ClassStudentStatus[]).map((status) => (
                                <option key={status} value={status}>
                                  {CLASS_STUDENT_STATUS_LABELS[status]}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setEditingDates(row)}
                              title="Editar datas de entrada e saída"
                              className="grid h-7 w-7 place-items-center rounded-md border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-3))]"
                            >
                              <CalendarDays className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setTransferring(row)}
                              title="Transferir para outra turma"
                              className="grid h-7 w-7 place-items-center rounded-md border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-3))]"
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Tirar ${row.studentName} da turma ${turma.name}?\n\nIsto apaga o vínculo e o histórico dele NESTA turma. Para manter o registro, use a situação "Cancelado".`
                                  )
                                ) {
                                  return;
                                }
                                void call(
                                  `/api/academic/classes/${turma.id}/students?linkId=${row.linkId}`,
                                  { method: "DELETE" },
                                  "Aluno removido da turma."
                                );
                              }}
                              title="Remover o vínculo com esta turma"
                              className="grid h-7 w-7 place-items-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "grade" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">
                Horários da semana
              </p>
              {turma.schedule.length === 0 ? (
                <p className="mt-2 text-xs text-[rgb(var(--slate-9))]">
                  Sem grade definida. Edite a turma para incluir os horários — sem eles não há projeção de aulas.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {turma.schedule.map((slot) => (
                    <li key={slot.id} className="flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--slate-11))]">
                      <span className="w-16 flex-none font-bold text-[rgb(var(--slate-12))]">
                        {WEEKDAY_SHORT[slot.weekday]}
                      </span>
                      <span>{slot.startTime}–{slot.endTime}</span>
                      <span className="text-[rgb(var(--slate-9))]">
                        {slot.roomName ?? turma.roomName ?? "sem sala"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-[rgb(var(--slate-9))]">
                Carga semanal: {formatMinutes(turma.weeklyMinutes)}
              </p>
            </div>
            <NextSessions sessions={sessions} hasSchedule={turma.schedule.length > 0} limit={12} />
            {/* O quadro real (aulas com data gravadas) fica ao lado da projeção:
                a projeção é o que a grade sugere, o quadro é o que vale. */}
            <div className="lg:col-span-2">
              <LessonPlanPanel turma={turma} canManage={canManage} onChanged={() => onChanged("")} />
            </div>
          </div>
        ) : null}

        {tab === "diario" ? (
          <AttendancePanel
            turma={turma}
            roster={roster}
            canManage={canManage}
            initialLessonId={initialLessonId}
          />
        ) : null}

        {tab === "historico" ? (
          <div>
            {history.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-8 text-center text-xs text-[rgb(var(--slate-9))]">
                Nada registrado ainda. Criação, edição e movimentação de aluno aparecem aqui.
              </p>
            ) : (
              <ul className="space-y-2">
                {history.map((event) => (
                  <li key={event.id} className="flex gap-3 text-xs">
                    <span className="w-32 flex-none text-[11px] text-[rgb(var(--slate-9))]">
                      {formatDateTimeBR(event.createdAt)}
                    </span>
                    <span className="text-[rgb(var(--slate-11))]">
                      <strong className="text-[rgb(var(--slate-12))]">{ACTION_LABELS[event.action] ?? event.action}</strong>
                      {event.entity === "turma_aluno" ? " · aluno" : " · turma"}
                      {event.label ? ` · ${event.label}` : ""}
                      {event.actorName ? ` · por ${event.actorName}` : ""}
                      {event.note && event.entity === "turma" ? ` — ${event.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {enrolling ? (
        <EnrollFromContractModal
          enrollment={enrolling}
          turma={turma}
          onClose={() => setEnrolling(null)}
          onDone={async (message) => {
            setEnrolling(null);
            await load({ silent: true });
            onChanged(message);
          }}
        />
      ) : null}

      {showClose ? (
        <ModalShell title={`Encerrar ${turma.name}`} onClose={() => setShowClose(false)}>
          <p className="text-xs text-neutral-600">
            A turma passa para <strong>encerrada</strong> e os {activeRoster.length} aluno(s) ativos têm o vínculo
            fechado com a data de hoje. Escolha como registrar esse fechamento — é o que vai constar na ficha de
            cada aluno.
          </p>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void closeClassNow("concluida")}
              className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-xs font-semibold text-sky-900 disabled:opacity-40"
            >
              Concluíram o curso
              <span className="mt-0.5 block font-normal text-sky-800">
                Fim normal do módulo — é isto que sustenta certificado e declaração.
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void closeClassNow("cancelada")}
              className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs font-semibold text-rose-900 disabled:opacity-40"
            >
              Turma cancelada
              <span className="mt-0.5 block font-normal text-rose-800">
                A turma não foi até o fim — os alunos precisam ser realocados.
              </span>
            </button>
          </div>
        </ModalShell>
      ) : null}

      {editingDates ? (
        <LinkDatesModal
          row={editingDates}
          busy={busy}
          onClose={() => setEditingDates(null)}
          onSave={async (dates) => {
            await call(
              `/api/academic/classes/${turma.id}/students`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkId: editingDates.linkId, ...dates }),
              },
              "Datas do vínculo atualizadas."
            );
            setEditingDates(null);
          }}
        />
      ) : null}

      {transferring ? (
        <TransferModal
          row={transferring}
          fromClass={turma}
          classes={classes}
          busy={busy}
          onClose={() => setTransferring(null)}
          onConfirm={async (payload) => {
            await call(
              `/api/academic/classes/${turma.id}/students`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkId: transferring.linkId, ...payload }),
              },
              "Aluno transferido de turma."
            );
            setTransferring(null);
          }}
        />
      ) : null}

      {openStudentId ? (
        <StudentDrawer
          studentId={openStudentId}
          canManageStudents={canManageStudents}
          canDeleteStudents={canDeleteStudents}
          onClose={() => setOpenStudentId(null)}
          onChanged={(message) => {
            onChanged(message);
            void load({ silent: true });
          }}
        />
      ) : null}
    </section>
  );
}

const PAYMENT_LABELS: Record<AcademicRosterPayment["status"], string> = {
  em_dia: "Em dia",
  atrasado: "Em atraso",
  a_conciliar: "Pago, falta vincular",
  quitado: "Quitado",
  sem_cronograma: "Sem cronograma",
};

/**
 * Situação de pagamento do aluno dentro da lista de chamada.
 *
 * Só aparece para quem pode ver dinheiro. "Pago, falta vincular" existe separado de
 * "Em atraso" porque cobrar quem já pagou é o erro caro aqui — a mesma regra da
 * carteira de matrículas (`classifyPaymentHealth`).
 */
function PaymentPill({ payment }: { payment: AcademicRosterPayment }) {
  if (payment.status === "atrasado") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
        Em atraso {payment.daysLate}d · {money(payment.uncoveredAmount)}
      </span>
    );
  }
  if (payment.status === "a_conciliar") {
    return (
      <span
        className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900"
        title="O contrato já recebeu dinheiro que não está aplicado na parcela vencida. Conciliação, não inadimplência."
      >
        Pago, falta vincular
      </span>
    );
  }
  if (payment.status === "sem_cronograma") return null;
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
      {payment.status === "quitado" ? "Quitado" : "Em dia"}
    </span>
  );
}

const ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Alteração",
  delete: "Exclusão",
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">{label}</dt>
      <dd className="mt-0.5 text-[rgb(var(--slate-12))]">{value}</dd>
    </div>
  );
}

function NextSessions({
  sessions,
  hasSchedule,
  limit = 8,
}: {
  sessions: ReturnType<typeof expandClassSessions>;
  hasSchedule: boolean;
  limit?: number;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--slate-9))]">Próximas aulas</p>
      {!hasSchedule ? (
        <p className="mt-2 text-xs text-[rgb(var(--slate-9))]">Sem grade de horário — nada a projetar.</p>
      ) : sessions.length === 0 ? (
        <p className="mt-2 text-xs text-[rgb(var(--slate-9))]">
          Nenhuma aula no horizonte: a turma já terminou ou ainda não começou.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {sessions.slice(0, limit).map((session, index) => (
            <li
              key={`${session.date}-${session.startTime}-${index}`}
              className={`flex flex-wrap items-center gap-2 text-xs ${
                session.status === "aula" ? "text-[rgb(var(--slate-11))]" : "text-amber-700"
              }`}
            >
              <span className="w-24 flex-none font-semibold">
                {WEEKDAY_SHORT[session.weekday]} {formatDateBR(session.date)}
              </span>
              <span>{session.startTime}–{session.endTime}</span>
              {session.status === "aula" ? (
                <span className="text-[rgb(var(--slate-9))]">{session.roomName ?? ""}</span>
              ) : (
                <span className="font-semibold">
                  sem aula · {session.status === "recesso" ? "recesso" : "feriado"}
                  {session.label ? ` (${session.label})` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-[rgb(var(--slate-9))]">
        Projeção pela grade + calendário institucional. A chamada de cada aula fica na aba Diário.
      </p>
    </div>
  );
}

function LinkDatesModal({
  row,
  busy,
  onClose,
  onSave,
}: {
  row: AcademicClassRosterRow;
  busy: boolean;
  onClose: () => void;
  onSave: (dates: { startDate: string | null; endDate: string | null }) => Promise<void>;
}) {
  const [startDate, setStartDate] = useState(row.startDate ?? "");
  const [endDate, setEndDate] = useState(row.endDate ?? "");

  return (
    <ModalShell title={`Datas de ${row.studentName}`} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Entrada na turma">
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Saída" hint="Preenchida sozinha ao cancelar ou concluir.">
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600">
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSave({ startDate: startDate || null, endDate: endDate || null })}
          className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Salvar datas
        </button>
      </div>
    </ModalShell>
  );
}

function TransferModal({
  row,
  fromClass,
  classes,
  busy,
  onClose,
  onConfirm,
}: {
  row: AcademicClassRosterRow;
  fromClass: AcademicClass;
  classes: AcademicClass[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (payload: { toClassId: number; previousStatus: string; startDate: string | null }) => Promise<void>;
}) {
  const [toClassId, setToClassId] = useState("");
  const [previousStatus, setPreviousStatus] = useState("cancelada");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  const targets = classes.filter((item) => item.id !== fromClass.id && item.status !== "encerrada");

  return (
    <ModalShell title={`Transferir ${row.studentName}`} onClose={onClose}>
      <p className="mb-3 text-[11px] text-neutral-500">
        O vínculo com <strong>{fromClass.name}</strong> é encerrado e vira histórico — a passagem do aluno por esta
        turma continua registrada.
      </p>
      <div className="grid gap-3">
        <Field label="Turma de destino *">
          <select value={toClassId} onChange={(event) => setToClassId(event.target.value)} className={inputClass}>
            <option value="">Escolher turma…</option>
            {targets.map((item) => (
              <option key={item.id} value={item.id} disabled={item.seatsLeft === 0}>
                {item.name}
                {item.seatsLeft === null ? "" : item.seatsLeft === 0 ? " (lotada)" : ` (${item.seatsLeft} vaga(s))`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Como encerrar o vínculo antigo">
          <select value={previousStatus} onChange={(event) => setPreviousStatus(event.target.value)} className={inputClass}>
            <option value="cancelada">Cancelado — saiu no meio do módulo</option>
            <option value="concluida">Concluído — terminou o módulo e subiu de nível</option>
          </select>
        </Field>
        <Field label="Entrada na turma nova">
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600">
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy || !toClassId}
          onClick={() => void onConfirm({ toClassId: Number(toClassId), previousStatus, startDate: startDate || null })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" /> Transferir
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * Matriculado → ficha de aluno → turma, num passo só.
 *
 * A ficha é obrigatória porque é ela que carrega CPF, contato e responsável — o
 * contrato do Financeiro guarda só o nome em texto. O caminho existia (a fila em
 * `/alunos`), mas obrigava a sair da turma, cadastrar, voltar e procurar a pessoa: era
 * onde a alocação parava de acontecer. CPF e e-mail são exigidos por padrão porque é
 * deles que depende emitir cobrança; a regra é configurável pela secretaria e quem
 * responde é o servidor, então o erro que aparecer aqui é o texto dele.
 */
function EnrollFromContractModal({
  enrollment,
  turma,
  onClose,
  onDone,
}: {
  enrollment: AcademicUnlinkedEnrollment;
  turma: AcademicClass;
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const [fullName, setFullName] = useState(enrollment.studentName);
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(enrollment.leadPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const studentResponse = await fetch("/api/academic/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          cpf,
          email,
          phone,
          financeEnrollmentId: enrollment.id,
          // Com lead, o cadastro herda o payload dele e grava o vínculo lead → aluno,
          // que é o que permite remontar a jornada sem conciliar por nome depois.
          fromLeadId: enrollment.leadInscricaoId ?? undefined,
        }),
      });
      const studentData = await studentResponse.json().catch(() => ({}));
      if (!studentResponse.ok) throw new Error(studentData.error ?? "Falha ao cadastrar o aluno.");

      const allocateResponse = await fetch(`/api/academic/classes/${turma.id}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: studentData.id, financeEnrollmentId: enrollment.id }),
      });
      const allocateData = await allocateResponse.json().catch(() => ({}));
      if (!allocateResponse.ok) {
        // O aluno já existe a esta altura: dizer só "falhou" faria a pessoa tentar
        // cadastrar de novo e esbarrar em CPF duplicado.
        throw new Error(
          `${allocateData.error ?? "Falha ao alocar."} O cadastro do aluno foi criado — aloque pela busca acima.`
        );
      }
      await onDone(`${fullName} cadastrado e alocado em ${turma.name}.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Falha ao cadastrar o aluno.");
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Cadastrar e alocar" onClose={onClose}>
      <p className="mb-3 text-[11px] text-neutral-500">
        Contrato de <strong>{enrollment.studentName}</strong>
        {enrollment.courseName ? ` · ${enrollment.courseName}` : ""} · venda {formatDateBR(enrollment.saleDate)}. Entra
        na turma <strong>{turma.name}</strong>.
      </p>
      {error ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome *" className="sm:col-span-2">
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} className={inputClass} />
        </Field>
        <Field label="CPF" hint="Exigido para emitir cobrança.">
          <input value={cpf} onChange={(event) => setCpf(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Telefone">
          <input value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} />
        </Field>
        <Field label="E-mail" hint="Exigido para emitir cobrança." className="sm:col-span-2">
          <input value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={saving || !fullName.trim()}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRoundPlus className="h-3.5 w-3.5" />}
          Cadastrar e alocar
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-16 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-neutral-900">{title}</p>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
