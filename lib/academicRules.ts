import type {
  AcademicClassSession,
  AcademicRegistrationRules,
  AcademicRosterSummary,
  AcademicStudentInput,
  CalendarDayKind,
  CalendarDayScope,
  ClassModality,
  ClassStatus,
  ClassStudentStatus,
} from "@/types/academic";

/**
 * Regras puras do módulo acadêmico — CPF, idade, alocação, vagas e grade.
 *
 * Vive separado das libs de persistência porque as TELAS precisam destas funções:
 * importar `academicStudents`/`academicClasses` de um componente cliente arrastaria
 * `lib/db.ts` (e o `pg`) para o bundle do browser, o que quebra o build.
 */

/** Só dígitos. CPF vazio vira null para não colidir no índice único parcial. */
export function normalizeCpf(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function formatCpf(value: string | null | undefined): string {
  const digits = normalizeCpf(value);
  if (!digits || digits.length !== 11) return digits ?? "";
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Validação de CPF pelos dígitos verificadores. String vazia é "não informado", não inválido. */
export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = normalizeCpf(value);
  if (cpf === null) return true;
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  for (const [length, position] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (position - index);
    }
    const rest = (sum * 10) % 11;
    const digit = rest === 10 ? 0 : rest;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}

export function ageOn(birthDate: string | null | undefined, reference = new Date()): number | null {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = reference.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Menor de idade exige responsável legal — é ele quem assina o contrato (vinculado
 * ao CPF dele, nunca ao do aluno menor nem ao CNPJ da escola).
 *
 * Sem data de nascimento a resposta é `false`, não um erro: o cadastro não pode
 * travar por um campo que a secretaria ainda não tem. A tela sinaliza o dado
 * faltando em vez de bloquear.
 */
export function requiresGuardian(birthDate: string | null | undefined, reference = new Date()): boolean {
  const age = ageOn(birthDate, reference);
  return age !== null && age < 18;
}

export const DEFAULT_ACADEMIC_REGISTRATION_RULES: AcademicRegistrationRules = {
  studentCpfRequired: true,
  studentEmailRequired: true,
  studentBirthDateRequired: false,
  studentPhoneRequired: false,
  guardianRequiredForMinor: true,
  guardianCpfRequired: true,
  guardianEmailRequired: true,
  guardianBirthDateRequired: false,
  guardianPhoneRequired: false,
};

/**
 * Valida apenas obrigatoriedade configurável. Formato de CPF continua sendo uma
 * invariante separada: desligar "CPF obrigatório" permite vazio, nunca CPF inválido.
 */
export function validateStudentRegistration(
  input: AcademicStudentInput,
  rules: AcademicRegistrationRules,
  reference = new Date()
): string | null {
  const present = (value: string | null | undefined) => Boolean(value?.trim());
  if (rules.studentCpfRequired && !normalizeCpf(input.cpf)) return "Informe o CPF do aluno.";
  if (rules.studentEmailRequired && !present(input.email)) return "Informe o e-mail do aluno.";
  if (rules.studentBirthDateRequired && !present(input.birthDate)) return "Informe a data de nascimento do aluno.";
  if (rules.studentPhoneRequired && !present(input.phone)) return "Informe o telefone do aluno.";

  if (!requiresGuardian(input.birthDate, reference)) return null;
  if (rules.guardianRequiredForMinor && !input.guardian && !input.guardianId) {
    return "Aluno menor de idade precisa de responsável legal.";
  }
  if (!input.guardian) return null;
  if (rules.guardianCpfRequired && !normalizeCpf(input.guardian.cpf)) return "Informe o CPF do responsável legal.";
  if (rules.guardianEmailRequired && !present(input.guardian.email)) return "Informe o e-mail do responsável legal.";
  if (rules.guardianBirthDateRequired && !present(input.guardian.birthDate)) {
    return "Informe a data de nascimento do responsável legal.";
  }
  if (rules.guardianPhoneRequired && !present(input.guardian.phone)) return "Informe o telefone do responsável legal.";
  return null;
}

/**
 * Estado de alocação do aluno.
 *
 * "Aguardando alocação" é estado NORMAL, não erro: a venda fecha o contrato antes de
 * a logística encaixar o aluno num horário (ver docs/plano-substituicao-sponte.md §8).
 */
export type AllocationState = "alocado" | "aguardando_alocacao" | "sem_contrato";

export function allocationState(input: {
  activeClasses: number;
  contractsCount: number;
}): AllocationState {
  if (input.activeClasses > 0) return "alocado";
  return input.contractsCount > 0 ? "aguardando_alocacao" : "sem_contrato";
}

export const ALLOCATION_LABELS: Record<AllocationState, string> = {
  alocado: "Alocado em turma",
  aguardando_alocacao: "Matriculado, aguardando alocação",
  sem_contrato: "Sem turma e sem contrato",
};

/**
 * Contagem de alunos por turma para relatório.
 *
 * O aluno sem turma entra numa linha PRÓPRIA (`awaitingAllocation`) e o total é a
 * soma das duas partes: sem isso, "alunos por turma" ou perderia o não alocado ou o
 * jogaria numa turma qualquer — os dois jeitos de mentir com a mesma tabela.
 */
export function summarizeRoster(
  students: Array<{
    classes: Array<{ classId: number; className: string; status: string }>;
    contractsCount: number;
  }>
): AcademicRosterSummary {
  const byClass = new Map<number, { classId: number; className: string; students: number }>();
  let awaitingAllocation = 0;
  let withoutContractOrClass = 0;

  for (const student of students) {
    const active = student.classes.filter((link) => link.status === "ativa");
    if (active.length === 0) {
      if (student.contractsCount > 0) awaitingAllocation += 1;
      else withoutContractOrClass += 1;
      continue;
    }
    for (const link of active) {
      const current = byClass.get(link.classId) ?? {
        classId: link.classId,
        className: link.className,
        students: 0,
      };
      current.students += 1;
      byClass.set(link.classId, current);
    }
  }

  return {
    classes: Array.from(byClass.values()).sort((left, right) => right.students - left.students),
    awaitingAllocation,
    withoutContractOrClass,
    total: students.length,
  };
}


export const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/* ── Regras puras ────────────────────────────────────────────────────────── */

/** Vagas restantes; null quando a turma não tem capacidade definida (não é "zero"). */
export function seatsLeft(capacity: number | null, activeStudents: number): number | null {
  if (capacity === null || !Number.isFinite(capacity)) return null;
  return Math.max(0, capacity - activeStudents);
}

/**
 * Turma modular tem data de término (e por isso suporta certificado/formatura);
 * cíclica, não. Validar aqui evita turma "modular" sem fim, que depois trava o
 * fechamento automático de contrato.
 */
export function validateClassDates(input: {
  modality: ClassModality;
  startDate: string | null;
  endDate: string | null;
}): string | null {
  if (input.modality === "modular" && !input.endDate) {
    return "Turma modular precisa de data de término — ela delimita certificado e encerramento.";
  }
  if (input.modality === "ciclica" && input.endDate) {
    return "Turma cíclica não tem data de término — deixe o campo vazio ou marque como modular.";
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return "A data de término é anterior à de início.";
  }
  return null;
}

/** Dois horários no mesmo dia que se sobrepõem — professor/sala não se clonam. */
export function findScheduleConflict(
  slots: Array<{ weekday: number; startTime: string; endTime: string }>
): string | null {
  const byDay = new Map<number, Array<{ startTime: string; endTime: string }>>();
  for (const slot of slots) {
    if (slot.endTime <= slot.startTime) {
      return `${WEEKDAY_LABELS[slot.weekday] ?? "Dia"}: o horário de término precisa ser depois do de início.`;
    }
    const list = byDay.get(slot.weekday) ?? [];
    for (const other of list) {
      if (slot.startTime < other.endTime && other.startTime < slot.endTime) {
        return `${WEEKDAY_LABELS[slot.weekday] ?? "Dia"}: dois horários se sobrepõem (${other.startTime}–${other.endTime} e ${slot.startTime}–${slot.endTime}).`;
      }
    }
    list.push({ startTime: slot.startTime, endTime: slot.endTime });
    byDay.set(slot.weekday, list);
  }
  return null;
}

/* ── Rótulos e leitura da grade ──────────────────────────────────────────── */

export const CLASS_STATUS_LABELS: Record<ClassStatus, string> = {
  planejada: "Planejada",
  ativa: "Ativa",
  encerrada: "Encerrada",
};

export const CLASS_STUDENT_STATUS_LABELS: Record<ClassStudentStatus, string> = {
  ativa: "Ativo",
  trancada: "Trancado",
  cancelada: "Cancelado",
  concluida: "Concluído",
};

/** "Segunda", "Terça"… em três letras, para caber na grade semanal e nos cards. */
export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function minutesOf(time: string): number {
  const [hour, minute] = String(time ?? "").split(":");
  return Number(hour) * 60 + Number(minute ?? 0);
}

/** Carga horária semanal em minutos, somando todos os horários da grade. */
export function classWeeklyMinutes(
  schedule: Array<{ startTime: string; endTime: string }>
): number {
  return schedule.reduce((total, slot) => {
    const duration = minutesOf(slot.endTime) - minutesOf(slot.startTime);
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

/**
 * "Ter e Qui · 19:00–20:30" — resumo de uma linha da grade.
 *
 * Agrupa dias que compartilham o mesmo horário porque é assim que a secretaria fala
 * da turma no telefone; listar quatro linhas idênticas variando só o dia é o tipo de
 * detalhe que faz o card virar parede de texto.
 */
/**
 * Período da turma para o card da lista: "26/08/2026 a 24/02/2027".
 *
 * Devolve `null` quando não há nenhuma das duas datas — a linha some do card em
 * vez de mostrar um travessão. E as duas turmas "Curso Elite - 6 Meses" têm o
 * MESMO nome: sem esta linha, a data é a única coisa que as distingue na lista
 * e ela não estava em lugar nenhum.
 */
export function describeClassPeriod(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string | null {
  const inicio = formatDay(startDate);
  const fim = formatDay(endDate);
  if (inicio && fim) return `${inicio} a ${fim}`;
  if (inicio) return `Início ${inicio}`;
  if (fim) return `Até ${fim}`;
  return null;
}

/** "AAAA-MM-DD" (ou ISO completo) para "DD/MM/AAAA". */
function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : null;
}

export function describeSchedule(
  schedule: Array<{ weekday: number; startTime: string; endTime: string }>
): string {
  if (schedule.length === 0) return "Sem grade de horário";
  const byRange = new Map<string, number[]>();
  for (const slot of [...schedule].sort((left, right) => left.weekday - right.weekday)) {
    const key = `${slot.startTime}–${slot.endTime}`;
    const days = byRange.get(key) ?? [];
    if (!days.includes(slot.weekday)) days.push(slot.weekday);
    byRange.set(key, days);
  }
  return Array.from(byRange.entries())
    .map(([range, days]) => {
      const labels = days.map((weekday) => WEEKDAY_SHORT[weekday] ?? "?");
      const joined =
        labels.length === 1
          ? labels[0]
          : `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
      return `${joined} · ${range}`;
    })
    .join(" | ");
}

/**
 * Normaliza texto para busca: minúsculas e sem acento.
 *
 * Sem tirar o acento, procurar "oratoria" não acha "Oratória" — e ninguém digita
 * acento numa caixa de busca com pressa. Mesmo problema já corrigido na ordenação
 * alfabética de /inscricoes.
 */
export function humanizeClassSearch(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

/** Ocupação em % (arredondada); null quando a turma não tem capacidade definida. */
export function occupancyRate(capacity: number | null, activeStudents: number): number | null {
  if (capacity === null || !Number.isFinite(capacity) || capacity <= 0) return null;
  return Math.round((activeStudents / capacity) * 100);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Projeta as próximas aulas da turma a partir da grade e do calendário institucional.
 *
 * Feriado e recesso NÃO são omitidos: eles entram com `status` próprio para a tela
 * poder dizer "quinta não tem aula — feriado". Sumir com a data deixaria o buraco
 * indistinguível de um erro de grade, que foi o motivo de a secretaria continuar
 * mantendo o calendário de aulas num caderno paralelo.
 *
 * `letivo_extra` no calendário não inventa aula: ele marca que o dia é letivo apesar
 * de recesso, então só afeta a decisão de bloquear, nunca a de criar horário.
 */
export function expandClassSessions(input: {
  schedule: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    teacherName?: string | null;
    roomName?: string | null;
  }>;
  startDate: string | null;
  endDate: string | null;
  calendar: Array<{ day: string; kind: CalendarDayKind; label: string | null; scope: CalendarDayScope }>;
  /** Primeiro dia considerado (normalmente hoje). */
  from: string;
  limit?: number;
  /** Horizonte máximo em dias, para turma cíclica não varrer o infinito. */
  horizonDays?: number;
}): AcademicClassSession[] {
  const limit = Math.max(1, input.limit ?? 8);
  const horizon = Math.max(1, input.horizonDays ?? 120);
  if (input.schedule.length === 0) return [];

  const blocked = new Map<string, { kind: CalendarDayKind; label: string | null }>();
  for (const day of input.calendar) {
    if (day.scope === "financeiro") continue;
    if (day.kind === "letivo_extra") continue;
    blocked.set(day.day.slice(0, 10), { kind: day.kind, label: day.label });
  }

  const start = input.startDate && input.startDate > input.from ? input.startDate : input.from;
  const sessions: AcademicClassSession[] = [];

  for (let offset = 0; offset < horizon && sessions.length < limit; offset += 1) {
    const day = addDays(start, offset);
    if (input.endDate && day > input.endDate) break;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const slots = input.schedule
      .filter((slot) => slot.weekday === weekday)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    const exception = blocked.get(day);
    for (const slot of slots) {
      if (sessions.length >= limit) break;
      sessions.push({
        date: day,
        weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
        teacherName: slot.teacherName ?? null,
        roomName: slot.roomName ?? null,
        status: exception ? (exception.kind === "recesso" ? "recesso" : "feriado") : "aula",
        label: exception?.label ?? null,
      });
    }
  }

  return sessions;
}
