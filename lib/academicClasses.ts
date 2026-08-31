import { getPool } from "@/lib/db";
import { classifyPaymentHealth } from "@/lib/receivables";
import { ACADEMIC_SCHEMA as SCHEMA, ensureAcademicSchema } from "@/lib/academicSchema";
import { holidayDaysForYears, holidaysForYear } from "@/lib/holidays";
import {
  generateLessonDates,
  lessonPlanEndDate,
  yearsSpanned,
  type LessonSlot,
} from "@/lib/lessonPlan";
import {
  classWeeklyMinutes,
  findScheduleConflict,
  occupancyRate,
  seatsLeft,
  validateClassDates,
} from "@/lib/academicRules";
import type { PoolClient } from "pg";

export {
  classWeeklyMinutes,
  describeSchedule,
  expandClassSessions,
  findScheduleConflict,
  occupancyRate,
  seatsLeft,
  validateClassDates,
  WEEKDAY_LABELS,
} from "@/lib/academicRules";
import type {
  AcademicClass,
  AcademicClassFilters,
  AcademicClassLesson,
  ClassLessonStatus,
  AcademicClassHistoryEvent,
  AcademicClassInput,
  AcademicClassRosterRow,
  AcademicClassScheduleInput,
  AcademicClassScheduleSlot,
  AcademicCalendarDay,
  AcademicRoom,
  AcademicRosterPayment,
  AttendanceStatus,
  EnrollmentClassTag,
  LessonAttendanceMark,
  LessonMakeup,
  MakeupOption,
  StudentStatus,
  CalendarDayKind,
  CalendarDayScope,
  ClassModality,
  ClassStatus,
  ClassStudentStatus,
} from "@/types/academic";

/**
 * Turma, grade de horário, sala e a lista de alunos alocados.
 *
 * A turma NÃO substitui o "treinamento string" de lib/trainings.ts — ela convive com
 * ele através de `training_id`. Trocar o modelo por baixo quebraria CRM, mídia paga e
 * a presença do Encontro Online, que contam por aquele rótulo (ver a cartilha).
 */

/* ── Persistência ────────────────────────────────────────────────────────── */

function cleanText(value: unknown, max = 240): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text.slice(0, max) : null;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function isoStamp(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizeModality(value: unknown): ClassModality {
  return value === "ciclica" ? "ciclica" : "modular";
}

function normalizeClassStatus(value: unknown): ClassStatus {
  return value === "ativa" || value === "encerrada" ? value : "planejada";
}

/**
 * Ordem operacional (e não alfabética): ativa é o que se opera hoje, planejada é
 * resíduo de turmas criadas antes de a tela parar de perguntar a situação, encerrada
 * é histórico.
 */
const CLASS_STATUS_ORDER = `CASE c.status WHEN 'ativa' THEN 0 WHEN 'planejada' THEN 1 ELSE 2 END`;

function normalizeStudentStatus(value: unknown): StudentStatus {
  return value === "inativo" || value === "trancado" || value === "concluido" ? value : "ativo";
}

function normalizeLinkStatus(value: unknown): ClassStudentStatus {
  return value === "trancada" || value === "cancelada" || value === "concluida" ? value : "ativa";
}

/** "09:00:00" → "09:00": o banco devolve TIME com segundos, o formulário usa HH:MM. */
function shortTime(value: unknown): string {
  return String(value ?? "").slice(0, 5);
}

interface ClassRow {
  id: string | number;
  name: string;
  course_id: string | number | null;
  course_name: string | null;
  modality: string;
  level: string | null;
  start_date: Date | string | null;
  end_date: Date | string | null;
  capacity: number | null;
  room_id: string | number | null;
  room_name: string | null;
  teacher_employee_id: string | number | null;
  teacher_name: string | null;
  status: string;
  training_id: string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  active_students: string | number;
  linked_contracts: string | number;
  trancada_students: string | number;
  cancelada_students: string | number;
  concluida_students: string | number;
  schedule: unknown;
  teachers: unknown;
  lessons_total: string | number | null;
  lessons_done: string | number | null;
  next_lesson_date: Date | string | null;
}

function classFromRow(row: ClassRow): AcademicClass {
  const activeStudents = Number(row.active_students) || 0;
  const capacity = row.capacity === null ? null : Number(row.capacity);
  const schedule: AcademicClassScheduleSlot[] = Array.isArray(row.schedule)
    ? (row.schedule as Array<Record<string, unknown>>).map((slot) => ({
        id: Number(slot.id),
        weekday: Number(slot.weekday),
        startTime: shortTime(slot.start_time),
        endTime: shortTime(slot.end_time),
        teacherEmployeeId:
          slot.teacher_employee_id === null || slot.teacher_employee_id === undefined
            ? null
            : Number(slot.teacher_employee_id),
        teacherName: (slot.teacher_name as string) ?? null,
        roomId: slot.room_id === null || slot.room_id === undefined ? null : Number(slot.room_id),
        roomName: (slot.room_name as string) ?? null,
      }))
    : [];

  return {
    id: Number(row.id),
    name: row.name,
    courseId: row.course_id === null ? null : Number(row.course_id),
    courseName: row.course_name,
    modality: normalizeModality(row.modality),
    level: row.level,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    capacity,
    roomId: row.room_id === null ? null : Number(row.room_id),
    roomName: row.room_name,
    teacherEmployeeId: row.teacher_employee_id === null ? null : Number(row.teacher_employee_id),
    teacherName: row.teacher_name,
    status: normalizeClassStatus(row.status),
    trainingId: row.training_id,
    notes: row.notes,
    createdAt: isoStamp(row.created_at),
    updatedAt: isoStamp(row.updated_at),
    schedule: schedule.sort((left, right) => left.weekday - right.weekday || left.startTime.localeCompare(right.startTime)),
    activeStudents,
    seatsLeft: seatsLeft(capacity, activeStudents),
    studentsByStatus: {
      ativa: activeStudents,
      trancada: Number(row.trancada_students) || 0,
      cancelada: Number(row.cancelada_students) || 0,
      concluida: Number(row.concluida_students) || 0,
    },
    weeklyMinutes: classWeeklyMinutes(schedule),
    occupancy: occupancyRate(capacity, activeStudents),
    linkedContracts: Number(row.linked_contracts) || 0,
    teachers: Array.isArray(row.teachers)
      ? (row.teachers as Array<Record<string, unknown>>).map((teacher) => ({
          employeeId: Number(teacher.employee_id),
          name: String(teacher.name ?? ""),
          role: teacher.role === "auxiliar" ? ("auxiliar" as const) : ("titular" as const),
        }))
      : [],
    lessonsTotal: Number(row.lessons_total) || 0,
    lessonsDone: Number(row.lessons_done) || 0,
    nextLessonDate: isoDate(row.next_lesson_date),
  };
}

const CLASS_SELECT = `
  SELECT c.id, c.name, c.course_id, fc.name AS course_name, c.modality, c.level,
         c.start_date, c.end_date, c.capacity, c.room_id, r.name AS room_name,
         c.teacher_employee_id, e.name AS teacher_name, c.status, c.training_id,
         c.notes, c.created_at, c.updated_at,
         COALESCE(contratos.total, 0) AS linked_contracts,
         COALESCE(roster.total, 0) AS active_students,
         COALESCE(roster.trancada, 0) AS trancada_students,
         COALESCE(roster.cancelada, 0) AS cancelada_students,
         COALESCE(roster.concluida, 0) AS concluida_students,
         COALESCE(grade.items, '[]'::jsonb) AS schedule,
         COALESCE(profs.items, '[]'::jsonb) AS teachers,
         COALESCE(aulas.total, 0) AS lessons_total,
         COALESCE(aulas.done, 0) AS lessons_done,
         aulas.next_date AS next_lesson_date
  FROM ${SCHEMA}.academic_classes c
  LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = c.course_id
  LEFT JOIN ${SCHEMA}.academic_rooms r ON r.id = c.room_id
  LEFT JOIN ${SCHEMA}.finance_employees e ON e.id = c.teacher_employee_id
  LEFT JOIN LATERAL (
    -- Contratos que apontam para esta turma. Serve para avisar ANTES da alocação
    -- que já se vendeu mais do que cabe: a checagem de capacidade só acontece na
    -- hora de encaixar o aluno, e descobrir o estouro ali é tarde demais.
    SELECT COUNT(*)::int AS total
    FROM ${SCHEMA}.finance_enrollments fe
    WHERE fe.class_id = c.id
  ) contratos ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE cs.status = 'ativa')::int     AS total,
           COUNT(*) FILTER (WHERE cs.status = 'trancada')::int  AS trancada,
           COUNT(*) FILTER (WHERE cs.status = 'cancelada')::int AS cancelada,
           COUNT(*) FILTER (WHERE cs.status = 'concluida')::int AS concluida
    FROM ${SCHEMA}.academic_class_students cs
    WHERE cs.class_id = c.id
  ) roster ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
             'id', s.id, 'weekday', s.weekday, 'start_time', s.start_time, 'end_time', s.end_time,
             'teacher_employee_id', s.teacher_employee_id, 'teacher_name', se.name,
             'room_id', s.room_id, 'room_name', sr.name
           )) AS items
    FROM ${SCHEMA}.academic_class_schedule s
    LEFT JOIN ${SCHEMA}.finance_employees se ON se.id = s.teacher_employee_id
    LEFT JOIN ${SCHEMA}.academic_rooms sr ON sr.id = s.room_id
    WHERE s.class_id = c.id
  ) grade ON TRUE
  LEFT JOIN LATERAL (
    -- Titular primeiro: é ele que aparece sozinho quando a lista não cabe.
    SELECT jsonb_agg(jsonb_build_object('employee_id', ct.employee_id, 'name', te.name, 'role', ct.role)
                     ORDER BY (ct.role = 'titular') DESC, te.name) AS items
    FROM ${SCHEMA}.academic_class_teachers ct
    JOIN ${SCHEMA}.finance_employees te ON te.id = ct.employee_id
    WHERE ct.class_id = c.id
  ) profs ON TRUE
  LEFT JOIN LATERAL (
    -- Quadro de aulas: total, quantas já aconteceram e qual é a próxima.
    -- Reposição fica fora do total: ela é aula EXTRA, combinada por causa de uma
    -- falta, e somá-la faria a turma de 24 aulas virar "de 25" no card.
    SELECT COUNT(*) FILTER (WHERE l.status <> 'reposicao')::int AS total,
           COUNT(*) FILTER (WHERE l.status = 'realizada')::int AS done,
           MIN(l.lesson_date) FILTER (WHERE l.status IN ('planejada', 'reposicao')
                                        AND l.lesson_date >= CURRENT_DATE) AS next_date
    FROM ${SCHEMA}.academic_class_lessons l
    WHERE l.class_id = c.id
  ) aulas ON TRUE
`;

export async function listClasses(filters: AcademicClassFilters = {}): Promise<AcademicClass[]> {
  await ensureAcademicSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`c.status = $${values.length}`);
  }
  // A busca cobre curso, professor e sala além do nome: quem procura "Marina" quer a
  // turma dela, e obrigar a lembrar o nome que a turma recebeu no cadastro é o jeito
  // mais rápido de a pessoa desistir do filtro e rolar a lista inteira.
  const search = cleanText(filters.search, 120);
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(c.name ILIKE $${values.length} OR c.level ILIKE $${values.length}
        OR fc.name ILIKE $${values.length} OR e.name ILIKE $${values.length}
        OR r.name ILIKE $${values.length})`
    );
  }
  if (filters.courseId) {
    values.push(filters.courseId);
    conditions.push(`c.course_id = $${values.length}`);
  }
  if (filters.teacherEmployeeId) {
    values.push(filters.teacherEmployeeId);
    // Professor do dia conta: com revezamento, a turma pode ser "de" outra pessoa no
    // cadastro e ainda assim ser dada por quem se está procurando.
    conditions.push(
      `(c.teacher_employee_id = $${values.length}
        OR EXISTS (SELECT 1 FROM ${SCHEMA}.academic_class_schedule s
                   WHERE s.class_id = c.id AND s.teacher_employee_id = $${values.length}))`
    );
  }
  if (filters.roomId) {
    values.push(filters.roomId);
    conditions.push(
      `(c.room_id = $${values.length}
        OR EXISTS (SELECT 1 FROM ${SCHEMA}.academic_class_schedule s
                   WHERE s.class_id = c.id AND s.room_id = $${values.length}))`
    );
  }
  if (filters.weekday !== undefined && filters.weekday !== null) {
    values.push(filters.weekday);
    conditions.push(
      `EXISTS (SELECT 1 FROM ${SCHEMA}.academic_class_schedule s
               WHERE s.class_id = c.id AND s.weekday = $${values.length})`
    );
  }
  if (filters.seats === "com_vaga") {
    // Turma sem capacidade definida nunca lota, então entra em "com vaga".
    conditions.push("(c.capacity IS NULL OR COALESCE(roster.total, 0) < c.capacity)");
  } else if (filters.seats === "lotada") {
    conditions.push("(c.capacity IS NOT NULL AND COALESCE(roster.total, 0) >= c.capacity)");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query<ClassRow>(
    `${CLASS_SELECT} ${where} ORDER BY ${CLASS_STATUS_ORDER}, c.name ASC LIMIT 300`,
    values
  );
  return rows.map(classFromRow);
}

export async function getClassById(id: number): Promise<AcademicClass | null> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<ClassRow>(`${CLASS_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ? classFromRow(rows[0]) : null;
}

function normalizeSchedule(input: AcademicClassScheduleInput[] | undefined): AcademicClassScheduleInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((slot) => Number.isFinite(slot.weekday) && slot.startTime && slot.endTime)
    .map((slot) => ({
      weekday: Math.min(6, Math.max(0, Math.trunc(Number(slot.weekday)))),
      startTime: String(slot.startTime).slice(0, 5),
      endTime: String(slot.endTime).slice(0, 5),
      teacherEmployeeId: slot.teacherEmployeeId ?? null,
      roomId: slot.roomId ?? null,
    }));
}

function assertClassInput(input: AcademicClassInput): AcademicClassScheduleInput[] {
  if (!cleanText(input.name)) {
    throw new Error("Informe o nome da turma.");
  }
  const modality = normalizeModality(input.modality);
  const dateError = validateClassDates({
    modality,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
  });
  if (dateError) throw new Error(dateError);
  if (input.capacity !== null && input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new Error("A capacidade da turma precisa ser um número inteiro maior que zero.");
    }
  }

  const schedule = normalizeSchedule(input.schedule);
  const conflict = findScheduleConflict(schedule);
  if (conflict) throw new Error(conflict);
  return schedule;
}

async function replaceSchedule(
  client: PoolClient,
  classId: number,
  schedule: AcademicClassScheduleInput[]
): Promise<void> {
  await client.query(`DELETE FROM ${SCHEMA}.academic_class_schedule WHERE class_id = $1`, [classId]);
  for (const slot of schedule) {
    await client.query(
      `INSERT INTO ${SCHEMA}.academic_class_schedule
         (class_id, weekday, start_time, end_time, teacher_employee_id, room_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [classId, slot.weekday, slot.startTime, slot.endTime, slot.teacherEmployeeId ?? null, slot.roomId ?? null]
    );
  }
}

/**
 * Professores da turma. Lista ausente **preserva** os atuais (mesma regra do
 * resto do `updateClass`); lista vazia limpa de propósito.
 *
 * O `teacher_employee_id` da turma continua existindo e recebe o titular: meia
 * dúzia de consultas e filtros antigos leem aquela coluna, e mantê-la em dia é
 * mais barato do que reescrever todas.
 */
/** Horário padrão da turma da noite; igual ao que o formulário sugere. */
const DEFAULT_CLASS_START = "19:00";
const DEFAULT_CLASS_END = "20:30";

/** Uma aula por semana no dia da semana da data de início. */
function scheduleFromStartDate(startDate: string | null | undefined): AcademicClassScheduleInput[] {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const [year, month, day] = startDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return [
    {
      weekday,
      startTime: DEFAULT_CLASS_START,
      endTime: DEFAULT_CLASS_END,
      teacherEmployeeId: null,
      roomId: null,
    },
  ];
}

async function replaceTeachers(
  client: PoolClient,
  classId: number,
  teachers: AcademicClassInput["teachers"]
): Promise<void> {
  if (teachers === undefined) return;

  await client.query(`DELETE FROM ${SCHEMA}.academic_class_teachers WHERE class_id = $1`, [classId]);
  const vistos = new Set<number>();
  let titular: number | null = null;

  for (const teacher of teachers) {
    const employeeId = Number(teacher?.employeeId);
    if (!Number.isFinite(employeeId) || employeeId < 1 || vistos.has(employeeId)) continue;
    vistos.add(employeeId);
    // O primeiro titular da lista é o titular da turma; os demais viram auxiliares
    // para não existir turma com dois donos.
    const role = teacher.role === "auxiliar" || titular !== null ? "auxiliar" : "titular";
    if (role === "titular") titular = employeeId;
    await client.query(
      `INSERT INTO ${SCHEMA}.academic_class_teachers (class_id, employee_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (class_id, employee_id) DO UPDATE SET role = EXCLUDED.role`,
      [classId, employeeId, role]
    );
  }

  await client.query(
    `UPDATE ${SCHEMA}.academic_classes SET teacher_employee_id = $2, updated_at = NOW() WHERE id = $1`,
    [classId, titular]
  );
}

async function assertScheduleAvailability(
  client: PoolClient,
  input: AcademicClassInput,
  schedule: AcademicClassScheduleInput[],
  excludeClassId: number | null
): Promise<void> {
  for (const slot of schedule) {
    const roomId = slot.roomId ?? input.roomId ?? null;
    const teacherId = slot.teacherEmployeeId ?? input.teacherEmployeeId ?? null;
    if (!roomId && !teacherId) continue;
    const { rows } = await client.query<{ name: string; room_conflict: boolean; teacher_conflict: boolean }>(
      `SELECT c.name,
              ($4::bigint IS NOT NULL AND COALESCE(s.room_id, c.room_id) = $4) AS room_conflict,
              ($5::bigint IS NOT NULL AND COALESCE(s.teacher_employee_id, c.teacher_employee_id) = $5) AS teacher_conflict
       FROM ${SCHEMA}.academic_class_schedule s
       JOIN ${SCHEMA}.academic_classes c ON c.id = s.class_id
       WHERE ($6::bigint IS NULL OR c.id <> $6)
         AND c.status <> 'encerrada'
         AND s.weekday = $1
         AND s.start_time < $3::time
         AND $2::time < s.end_time
         AND (
           ($4::bigint IS NOT NULL AND COALESCE(s.room_id, c.room_id) = $4)
           OR ($5::bigint IS NOT NULL AND COALESCE(s.teacher_employee_id, c.teacher_employee_id) = $5)
         )
       LIMIT 1`,
      [slot.weekday, slot.startTime, slot.endTime, roomId, teacherId, excludeClassId]
    );
    const conflict = rows[0];
    if (!conflict) continue;
    const resource = conflict.room_conflict && conflict.teacher_conflict
      ? "sala e professor já estão ocupados"
      : conflict.room_conflict
        ? "sala já está ocupada"
        : "professor já está ocupado";
    throw new Error(`${resource} nesse horário pela turma “${conflict.name}”.`);
  }
}

export async function createClass(input: AcademicClassInput): Promise<number> {
  await ensureAcademicSchema();
  const schedule = assertClassInput(input);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [918478]);
    await assertScheduleAvailability(client, input, schedule, null);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ${SCHEMA}.academic_classes
         (name, course_id, modality, level, start_date, end_date, capacity, room_id,
          teacher_employee_id, status, training_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        cleanText(input.name),
        input.courseId ?? null,
        normalizeModality(input.modality),
        cleanText(input.level, 60),
        input.startDate || null,
        input.endDate || null,
        input.capacity ?? null,
        input.roomId ?? null,
        input.teacherEmployeeId ?? null,
        // Turma nasce ATIVA: a tela deixou de perguntar a situação, e o único jeito
        // de sair de ativa é a ação "Encerrar turma", que fecha os vínculos junto.
        normalizeClassStatus(input.status ?? "ativa"),
        cleanText(input.trainingId, 160),
        cleanText(input.notes, 2000),
      ]
    );
    const id = Number(rows[0].id);
    // Grade automática: turma criada sem horário mas com data de início vira
    // aula semanal no dia da semana dessa data. É o que a tela já faz, repetido
    // aqui porque criar turma pela API (importação, script) tem que resultar na
    // mesma turma que criar pela tela.
    await replaceSchedule(client, id, schedule.length > 0 ? schedule : scheduleFromStartDate(input.startDate));
    await replaceTeachers(client, id, input.teachers);
    await client.query("COMMIT");
    // Curso + grade + data de início = plano de aulas pronto. Fora da transação
    // porque a geração lê o calendário e não pode segurar o lock da turma.
    await autoGenerateLessonPlan(id).catch((error) => {
      console.error("[turmas] falha ao gerar o quadro de aulas da turma", id, error);
      return 0;
    });
    return id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Atualiza só os campos que vieram no payload.
 *
 * Campo ausente é PRESERVADO, nunca zerado. A regra nasceu de um bug real: o
 * formulário de turma não conhecia `training_id` (a ponte com o "treinamento string"
 * de lib/trainings.ts, de que dependem presença do Encontro Online e mídia paga) e
 * apagava o vínculo a cada edição de horário. Com o cadastro enxuto — sem curso,
 * nível, professor e situação na tela — a mesma armadilha existiria para quatro
 * colunas em vez de uma.
 *
 * A validação de datas usa a modalidade RECEBIDA; o formulário sempre envia
 * modalidade, início e término juntos, que é o único jeito de a regra "modular tem
 * término" ser decidível.
 */
export async function updateClass(id: number, input: AcademicClassInput): Promise<void> {
  await ensureAcademicSchema();
  const schedule = assertClassInput(input);

  const values: unknown[] = [id];
  const sets: string[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  set("name", cleanText(input.name));
  if (input.courseId !== undefined) set("course_id", input.courseId ?? null);
  if (input.modality !== undefined) set("modality", normalizeModality(input.modality));
  if (input.level !== undefined) set("level", cleanText(input.level, 60));
  if (input.startDate !== undefined) set("start_date", input.startDate || null);
  if (input.endDate !== undefined) set("end_date", input.endDate || null);
  if (input.capacity !== undefined) set("capacity", input.capacity ?? null);
  if (input.roomId !== undefined) set("room_id", input.roomId ?? null);
  if (input.teacherEmployeeId !== undefined) set("teacher_employee_id", input.teacherEmployeeId ?? null);
  if (input.status !== undefined) set("status", normalizeClassStatus(input.status));
  if (input.trainingId !== undefined) set("training_id", cleanText(input.trainingId, 160));
  if (input.notes !== undefined) set("notes", cleanText(input.notes, 2000));
  sets.push("updated_at = NOW()");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [918478]);
    await assertScheduleAvailability(client, input, schedule, id);
    const updated = await client.query(
      `UPDATE ${SCHEMA}.academic_classes SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
      values
    );
    if (updated.rowCount === 0) throw new Error("Turma não encontrada.");
    await replaceSchedule(client, id, schedule);
    await replaceTeachers(client, id, input.teachers);
    await client.query("COMMIT");
    // Editar a turma pode ter completado o que faltava (curso, grade ou data):
    // só gera se ainda não houver aula nenhuma.
    await autoGenerateLessonPlan(id).catch((error) => {
      console.error("[turmas] falha ao gerar o quadro de aulas da turma", id, error);
      return 0;
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteClass(id: number): Promise<void> {
  await ensureAcademicSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const roster = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${SCHEMA}.academic_class_students WHERE class_id = $1`,
      [id]
    );
    if (Number(roster.rows[0]?.total ?? "0") > 0) {
      throw new Error("Esta turma tem alunos vinculados. Remova os alunos antes de excluir.");
    }
    const removed = await client.query(`DELETE FROM ${SCHEMA}.academic_classes WHERE id = $1 RETURNING id`, [id]);
    if (removed.rowCount === 0) throw new Error("Turma não encontrada.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* ── Alunos da turma ─────────────────────────────────────────────────────── */

/**
 * Lista de alunos da turma com a ficha resumida junto.
 *
 * `includeFinance` decide se contrato e valor pago viajam para o cliente: quem tem
 * `view.classes` sem `view.finance` monta grade e faz chamada, e nesse caso o dado
 * financeiro é zerado NO SERVIDOR — esconder só na tela deixaria o valor no JSON da
 * resposta, que é o mesmo que não esconder.
 */
export async function listClassRoster(
  classId: number,
  options: { includeFinance?: boolean } = {}
): Promise<AcademicClassRosterRow[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{
    id: string;
    student_id: string;
    student_name: string;
    status: string;
    start_date: Date | string | null;
    end_date: Date | string | null;
    finance_enrollment_id: string | null;
    created_at: Date | string;
    cpf: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    birth_date: Date | string | null;
    student_status: string;
    guardian_name: string | null;
    guardian_phone: string | null;
    lead_inscricao_id: string | null;
    notes: string | null;
    other_classes: unknown;
    contracts_count: string | number;
    contracted_amount: string | number;
    paid_amount: string | number;
    open_amount: string | number;
    overdue_amount: string | number;
    overdue_count: string | number;
    schedule_count: string | number;
    credit: string | number;
    oldest_due: Date | string | null;
  }>(
    `SELECT cs.id, cs.student_id, s.full_name AS student_name, cs.status,
            cs.start_date, cs.end_date, cs.finance_enrollment_id, cs.created_at,
            s.cpf, s.email, s.phone, s.city, s.birth_date, s.status AS student_status,
            s.lead_inscricao_id, s.notes,
            g.full_name AS guardian_name, g.phone AS guardian_phone,
            COALESCE(outras.items, '[]'::jsonb) AS other_classes,
            COALESCE(fin.contracts, 0) AS contracts_count,
            COALESCE(fin.contracted, 0) AS contracted_amount,
            COALESCE(fin.paid, 0) AS paid_amount,
            COALESCE(fin.open_amount, 0) AS open_amount,
            COALESCE(fin.overdue_amount, 0) AS overdue_amount,
            COALESCE(fin.overdue_count, 0) AS overdue_count,
            COALESCE(fin.schedule_count, 0) AS schedule_count,
            COALESCE(fin.credit, 0) AS credit,
            fin.oldest_due
     FROM ${SCHEMA}.academic_class_students cs
     JOIN ${SCHEMA}.academic_students s ON s.id = cs.student_id
     LEFT JOIN ${SCHEMA}.academic_guardians g ON g.id = s.guardian_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('class_id', oc.id, 'class_name', oc.name)) AS items
       FROM ${SCHEMA}.academic_class_students ocs
       JOIN ${SCHEMA}.academic_classes oc ON oc.id = ocs.class_id
       WHERE ocs.student_id = cs.student_id AND ocs.class_id <> cs.class_id AND ocs.status = 'ativa'
     ) outras ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS contracts,
              COALESCE(SUM(fe.total_amount), 0) AS contracted,
              COALESCE(SUM(pagos.total), 0) AS paid,
              COALESCE(SUM(parcelas.open_amount), 0) AS open_amount,
              COALESCE(SUM(parcelas.overdue_amount), 0) AS overdue_amount,
              COALESCE(SUM(parcelas.overdue_count), 0)::int AS overdue_count,
              COALESCE(SUM(parcelas.schedule_count), 0)::int AS schedule_count,
              GREATEST(COALESCE(SUM(pagos.total), 0) - COALESCE(SUM(parcelas.applied_amount), 0), 0) AS credit,
              MIN(parcelas.oldest_due) AS oldest_due
       FROM ${SCHEMA}.finance_enrollments fe
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ep.amount), 0) AS total
         FROM ${SCHEMA}.finance_enrollment_payments ep
         WHERE ep.enrollment_id = fe.id
       ) pagos ON TRUE
       -- Mesma conta de lib/finance.ts (listEnrollmentPaymentHealth): saldo pela
       -- alocação, "aplicado" limitado ao valor da parcela e o excesso virando
       -- crédito. Repetida aqui porque a pergunta é por ALUNO (que pode ter mais de
       -- um contrato) e não por contrato; a classificação, essa sim, é a mesma função.
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS schedule_count,
                COUNT(*) FILTER (WHERE saldo > 0.005 AND due < CURRENT_DATE)::int AS overdue_count,
                COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND due < CURRENT_DATE), 0) AS overdue_amount,
                COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005), 0) AS open_amount,
                COALESCE(SUM(aplicado), 0) AS applied_amount,
                MIN(due) FILTER (WHERE saldo > 0.005 AND due < CURRENT_DATE) AS oldest_due
         FROM (
           SELECT COALESCE(r.due_date, r.date) AS due,
                  GREATEST(r.amount - COALESCE(al.total, 0), 0) AS saldo,
                  LEAST(COALESCE(al.total, 0), r.amount) AS aplicado
           FROM ${SCHEMA}.finance_revenues r
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(epa.amount), 0) AS total
             FROM ${SCHEMA}.finance_enrollment_payment_allocations epa
             WHERE epa.revenue_id = r.id
           ) al ON TRUE
           WHERE r.enrollment_id = fe.id AND r.status <> 'cancelado'
         ) linhas
       ) parcelas ON TRUE
       WHERE fe.student_id = cs.student_id
     ) fin ON TRUE
     WHERE cs.class_id = $1
     -- Ordem alfabética pura: trancados/concluídos ficam no meio da lista, junto
     -- com os ativos, porque quem procura um aluno procura pelo nome. A situação
     -- de cada vínculo continua visível na etiqueta ao lado do nome.
     ORDER BY s.full_name ASC`,
    [classId]
  );

  const includeFinance = options.includeFinance === true;
  return rows.map((row) => ({
    linkId: Number(row.id),
    studentId: Number(row.student_id),
    studentName: row.student_name,
    status: normalizeLinkStatus(row.status),
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    financeEnrollmentId: row.finance_enrollment_id === null ? null : Number(row.finance_enrollment_id),
    linkedAt: isoStamp(row.created_at),
    cpf: row.cpf,
    email: row.email,
    phone: row.phone,
    city: row.city,
    birthDate: isoDate(row.birth_date),
    studentStatus: normalizeStudentStatus(row.student_status),
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    leadInscricaoId: row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id),
    notes: row.notes,
    otherActiveClasses: Array.isArray(row.other_classes)
      ? (row.other_classes as Array<Record<string, unknown>>).map((item) => ({
          classId: Number(item.class_id),
          className: String(item.class_name ?? ""),
        }))
      : [],
    contractsCount: includeFinance ? Number(row.contracts_count) || 0 : null,
    contractedAmount: includeFinance ? Number(row.contracted_amount) || 0 : null,
    paidAmount: includeFinance ? Number(row.paid_amount) || 0 : null,
    payment: includeFinance ? paymentOf(row) : null,
  }));
}

/**
 * Situação de pagamento do ALUNO dentro da turma (somando os contratos dele).
 *
 * Existe para a lista de chamada responder "quem está devendo" sem exigir abrir o
 * Financeiro em outra aba — que é onde a cobrança parava de acontecer. A regra é a
 * mesma da carteira de matrículas (`classifyPaymentHealth`), inclusive o crédito: o
 * professor não pode ver como caloteiro alguém cujo pagamento só está lançado na
 * parcela errada.
 */
function paymentOf(row: {
  schedule_count: string | number;
  open_amount: string | number;
  overdue_count: string | number;
  overdue_amount: string | number;
  credit: string | number;
  oldest_due: Date | string | null;
}): AcademicRosterPayment {
  const overdueAmount = Number(row.overdue_amount) || 0;
  const { status, uncoveredAmount } = classifyPaymentHealth({
    scheduleCount: Number(row.schedule_count) || 0,
    openAmount: Number(row.open_amount) || 0,
    overdueCount: Number(row.overdue_count) || 0,
    overdueAmount,
    creditAmount: Number(row.credit) || 0,
  });
  const oldestDueDate = isoDate(row.oldest_due);
  const today = new Date(new Date().toISOString().slice(0, 10));
  return {
    status,
    uncoveredAmount,
    creditAmount: Number(row.credit) || 0,
    openAmount: Number(row.open_amount) || 0,
    daysLate: oldestDueDate
      ? Math.max(0, Math.round((today.getTime() - new Date(oldestDueDate).getTime()) / 86400000))
      : 0,
  };
}

/**
 * Aloca o aluno na turma. Recusa quando a turma está lotada — capacidade existe para
 * ser respeitada, e descobrir o estouro no dia da aula é tarde demais.
 */
export async function addStudentToClass(input: {
  classId: number;
  studentId: number;
  startDate?: string | null;
  financeEnrollmentId?: number | null;
}): Promise<void> {
  await ensureAcademicSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // O lock serializa duas secretárias alocando a última vaga ao mesmo tempo.
    // Sem ele, ambas leriam "1 vaga" e a turma terminaria com capacidade + 1.
    const classResult = await client.query<{ capacity: number | null }>(
      `SELECT capacity FROM ${SCHEMA}.academic_classes WHERE id = $1 FOR UPDATE`,
      [input.classId]
    );
    if (!classResult.rows[0]) throw new Error("Turma não encontrada.");

    const existing = await client.query<{ status: string }>(
      `SELECT status FROM ${SCHEMA}.academic_class_students
       WHERE class_id = $1 AND student_id = $2`,
      [input.classId, input.studentId]
    );
    if (existing.rows[0]?.status === "ativa") {
      await client.query("COMMIT");
      return;
    }

    const capacity = classResult.rows[0].capacity === null ? null : Number(classResult.rows[0].capacity);
    if (capacity !== null) {
      const count = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${SCHEMA}.academic_class_students
         WHERE class_id = $1 AND status = 'ativa'`,
        [input.classId]
      );
      if (Number(count.rows[0]?.total ?? 0) >= capacity) {
        throw new Error(`Turma lotada (${capacity} vagas). Aumente a capacidade ou escolha outra turma.`);
      }
    }

    await client.query(
      `INSERT INTO ${SCHEMA}.academic_class_students (class_id, student_id, start_date, finance_enrollment_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (class_id, student_id) DO UPDATE
         SET status = 'ativa',
             end_date = NULL,
             start_date = COALESCE(EXCLUDED.start_date, ${SCHEMA}.academic_class_students.start_date),
             finance_enrollment_id = COALESCE(EXCLUDED.finance_enrollment_id, ${SCHEMA}.academic_class_students.finance_enrollment_id)`,
      [input.classId, input.studentId, input.startDate || null, input.financeEnrollmentId ?? null]
    );

    // Contrato passa a apontar para a turma quando a alocação nasce de uma matrícula
    // — e SÓ quando o campo ainda está vazio. Sobrescrever apagaria a turma vendida
    // numa troca de horário, que é exatamente a informação que serve para comparar o
    // que foi vendido com onde o aluno está. `contract_class_name` (texto do contrato
    // assinado) nunca é tocado aqui.
    if (input.financeEnrollmentId) {
      await client.query(
        `UPDATE ${SCHEMA}.finance_enrollments
         SET class_id = $2
         WHERE id = $1 AND class_id IS NULL`,
        [input.financeEnrollmentId, input.classId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function requireLinkStatus(status: ClassStudentStatus): ClassStudentStatus {
  if (status !== "ativa" && status !== "trancada" && status !== "cancelada" && status !== "concluida") {
    throw new Error("Situação do vínculo é inválida.");
  }
  return status;
}

export async function setClassStudentStatus(
  classId: number,
  linkId: number,
  status: ClassStudentStatus
): Promise<void> {
  await ensureAcademicSchema();
  const nextStatus = requireLinkStatus(status);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ capacity: number | null; status: string }>(
      `SELECT c.capacity, cs.status
       FROM ${SCHEMA}.academic_class_students cs
       JOIN ${SCHEMA}.academic_classes c ON c.id = cs.class_id
       WHERE cs.id = $1 AND cs.class_id = $2
       FOR UPDATE OF c, cs`,
      [linkId, classId]
    );
    if (!current.rows[0]) throw new Error("Vínculo de aluno não encontrado nesta turma.");

    if (nextStatus === "ativa" && current.rows[0].status !== "ativa" && current.rows[0].capacity !== null) {
      const count = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${SCHEMA}.academic_class_students
         WHERE class_id = $1 AND status = 'ativa' AND id <> $2`,
        [classId, linkId]
      );
      if (Number(count.rows[0]?.total ?? 0) >= Number(current.rows[0].capacity)) {
        throw new Error(`Turma lotada (${current.rows[0].capacity} vagas).`);
      }
    }

    await client.query(
      `UPDATE ${SCHEMA}.academic_class_students
       SET status = $2,
           end_date = CASE
             WHEN $2 = 'ativa' THEN NULL
             WHEN $2 IN ('cancelada','concluida') THEN COALESCE(end_date, CURRENT_DATE)
             ELSE end_date
           END
       WHERE id = $1 AND class_id = $3`,
      [linkId, nextStatus, classId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Ajusta datas do vínculo sem mexer na situação.
 *
 * Datas e situação viajam em rotas diferentes de propósito: mudar a situação tem
 * regra de vaga (reativar exige lugar na turma) e mudar a data de entrada é correção
 * de digitação. Misturar as duas faria uma correção de data disparar checagem de
 * capacidade e falhar numa turma lotada — bloqueando justamente a turma que mais
 * recebe correção.
 */
export async function updateClassStudentDates(
  classId: number,
  linkId: number,
  dates: { startDate?: string | null; endDate?: string | null }
): Promise<void> {
  await ensureAcademicSchema();
  const startDate = dates.startDate || null;
  const endDate = dates.endDate || null;
  if (startDate && endDate && endDate < startDate) {
    throw new Error("A data de saída é anterior à data de entrada.");
  }
  const updated = await getPool().query(
    `UPDATE ${SCHEMA}.academic_class_students
     SET start_date = $3, end_date = $4
     WHERE id = $1 AND class_id = $2
     RETURNING id`,
    [linkId, classId, startDate, endDate]
  );
  if (updated.rowCount === 0) throw new Error("Vínculo de aluno não encontrado nesta turma.");
}

/**
 * Move o aluno de turma preservando o histórico da origem.
 *
 * O vínculo antigo é encerrado (cancelado ou concluído, conforme o motivo) em vez de
 * apagado: é ele que responde "esta pessoa passou pela turma das terças", pergunta
 * que aparece toda vez que se emite declaração ou se investiga uma reclamação. As
 * duas pontas acontecem na mesma transação, senão uma falha de capacidade no destino
 * deixaria o aluno sem turma nenhuma.
 */
export async function transferStudentBetweenClasses(input: {
  fromClassId: number;
  linkId: number;
  toClassId: number;
  /** Como encerrar o vínculo antigo: saiu no meio (cancelada) ou terminou (concluida). */
  previousStatus?: Extract<ClassStudentStatus, "cancelada" | "concluida">;
  startDate?: string | null;
}): Promise<{ studentId: number; studentName: string; toClassName: string }> {
  await ensureAcademicSchema();
  if (input.fromClassId === input.toClassId) {
    throw new Error("A turma de destino é a mesma de origem.");
  }
  const previousStatus = input.previousStatus === "concluida" ? "concluida" : "cancelada";

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const link = await client.query<{ student_id: string; finance_enrollment_id: string | null; full_name: string }>(
      `SELECT cs.student_id, cs.finance_enrollment_id, s.full_name
       FROM ${SCHEMA}.academic_class_students cs
       JOIN ${SCHEMA}.academic_students s ON s.id = cs.student_id
       WHERE cs.id = $1 AND cs.class_id = $2
       FOR UPDATE OF cs`,
      [input.linkId, input.fromClassId]
    );
    if (!link.rows[0]) throw new Error("Vínculo de aluno não encontrado na turma de origem.");
    const studentId = Number(link.rows[0].student_id);

    const target = await client.query<{ capacity: number | null; name: string; status: string }>(
      `SELECT capacity, name, status FROM ${SCHEMA}.academic_classes WHERE id = $1 FOR UPDATE`,
      [input.toClassId]
    );
    if (!target.rows[0]) throw new Error("Turma de destino não encontrada.");
    if (target.rows[0].status === "encerrada") {
      throw new Error("A turma de destino está encerrada — reabra a turma antes de transferir.");
    }

    const capacity = target.rows[0].capacity === null ? null : Number(target.rows[0].capacity);
    if (capacity !== null) {
      const count = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${SCHEMA}.academic_class_students
         WHERE class_id = $1 AND status = 'ativa' AND student_id <> $2`,
        [input.toClassId, studentId]
      );
      if (Number(count.rows[0]?.total ?? 0) >= capacity) {
        throw new Error(`A turma de destino está lotada (${capacity} vagas).`);
      }
    }

    await client.query(
      `UPDATE ${SCHEMA}.academic_class_students
       SET status = $2, end_date = COALESCE(end_date, CURRENT_DATE)
       WHERE id = $1`,
      [input.linkId, previousStatus]
    );

    await client.query(
      `INSERT INTO ${SCHEMA}.academic_class_students (class_id, student_id, start_date, finance_enrollment_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (class_id, student_id) DO UPDATE
         SET status = 'ativa',
             end_date = NULL,
             start_date = COALESCE(EXCLUDED.start_date, ${SCHEMA}.academic_class_students.start_date),
             finance_enrollment_id = COALESCE(EXCLUDED.finance_enrollment_id, ${SCHEMA}.academic_class_students.finance_enrollment_id)`,
      [input.toClassId, studentId, input.startDate || null, link.rows[0].finance_enrollment_id]
    );

    // O contrato acompanha a turma nova quando ele já apontava para a antiga; um
    // contrato preso na turma de origem faria o relatório por turma cobrar de uma
    // sala em que o aluno não está mais.
    await client.query(
      `UPDATE ${SCHEMA}.finance_enrollments
       SET class_id = $2
       WHERE student_id = $1 AND class_id = $3`,
      [studentId, input.toClassId, input.fromClassId]
    );

    await client.query("COMMIT");
    return {
      studentId,
      studentName: link.rows[0].full_name,
      toClassName: target.rows[0].name,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Encerra a turma e fecha em bloco os vínculos ativos.
 *
 * Existe porque o fim de um módulo é um evento único da secretaria, e sem isto ela
 * mudaria o status da turma e deixaria trinta alunos "ativos" numa turma encerrada —
 * gente que continuaria aparecendo em contagem de ocupação e em lista de chamada.
 */
export async function closeClass(
  classId: number,
  linkStatus: Extract<ClassStudentStatus, "concluida" | "cancelada"> = "concluida"
): Promise<{ closedLinks: number }> {
  await ensureAcademicSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT id FROM ${SCHEMA}.academic_classes WHERE id = $1 FOR UPDATE`, [classId]);
    if (found.rowCount === 0) throw new Error("Turma não encontrada.");

    const links = await client.query(
      `UPDATE ${SCHEMA}.academic_class_students
       SET status = $2, end_date = COALESCE(end_date, CURRENT_DATE)
       WHERE class_id = $1 AND status = 'ativa'
       RETURNING id`,
      [classId, linkStatus]
    );
    await client.query(
      `UPDATE ${SCHEMA}.academic_classes SET status = 'encerrada', updated_at = NOW() WHERE id = $1`,
      [classId]
    );
    await client.query("COMMIT");
    return { closedLinks: links.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Linha do tempo da turma a partir de `finance_events` (a mesma trilha do resto do ERP).
 *
 * O evento de aluno é achado pelo texto exato da nota (`Turma #12`) e não por `LIKE`
 * com curinga: `%Turma #1%` traria a turma 1, a 12 e a 100 juntas — o tipo de erro
 * que só aparece quando a escola cresce.
 */
export async function listClassHistory(classId: number, limit = 60): Promise<AcademicClassHistoryEvent[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{
    id: string;
    entity: string;
    action: string;
    label: string | null;
    note: string | null;
    actor_name: string | null;
    created_at: Date | string;
  }>(
    `SELECT id, entity, action, label, note, actor_name, created_at
     FROM ${SCHEMA}.finance_events
     WHERE (entity = 'turma' AND entity_id = $1)
        OR (entity = 'turma_aluno' AND note = $2)
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [classId, `Turma #${classId}`, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    entity: row.entity === "turma_aluno" ? "turma_aluno" : "turma",
    action: row.action,
    label: row.label,
    note: row.note,
    actorName: row.actor_name,
    createdAt: isoStamp(row.created_at),
  }));
}

export async function removeStudentFromClass(classId: number, linkId: number): Promise<void> {
  await ensureAcademicSchema();
  const removed = await getPool().query(
    `DELETE FROM ${SCHEMA}.academic_class_students WHERE id = $1 AND class_id = $2 RETURNING id`,
    [linkId, classId]
  );
  if (removed.rowCount === 0) throw new Error("Vínculo de aluno não encontrado nesta turma.");
}

/* ── Salas ───────────────────────────────────────────────────────────────── */

export async function listRooms(): Promise<AcademicRoom[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{ id: string; name: string; capacity: number | null; active: boolean }>(
    `SELECT id, name, capacity, active FROM ${SCHEMA}.academic_rooms ORDER BY active DESC, name ASC`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    capacity: row.capacity === null ? null : Number(row.capacity),
    active: row.active,
  }));
}

export async function createRoom(input: { name: string; capacity?: number | null }): Promise<number> {
  await ensureAcademicSchema();
  const name = cleanText(input.name, 120);
  if (!name) throw new Error("Informe o nome da sala.");
  if (input.capacity !== null && input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new Error("A capacidade da sala precisa ser um número inteiro maior que zero.");
    }
  }
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.academic_rooms (name, capacity) VALUES ($1,$2) RETURNING id`,
    [name, input.capacity ?? null]
  );
  return Number(rows[0].id);
}

export async function updateRoom(
  id: number,
  input: { name: string; capacity?: number | null; active?: boolean }
): Promise<void> {
  await ensureAcademicSchema();
  const name = cleanText(input.name, 120);
  if (!name) throw new Error("Informe o nome da sala.");
  if (input.capacity !== null && input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new Error("A capacidade da sala precisa ser um número inteiro maior que zero.");
    }
  }
  const updated = await getPool().query(
    `UPDATE ${SCHEMA}.academic_rooms
     SET name = $2, capacity = $3, active = COALESCE($4, active)
     WHERE id = $1
     RETURNING id`,
    [id, name, input.capacity ?? null, input.active ?? null]
  );
  if (updated.rowCount === 0) throw new Error("Sala não encontrada.");
}

/**
 * Exclui a sala só quando ninguém a usa; caso contrário manda desativar.
 *
 * Apagar uma sala referenciada zeraria `room_id` de turmas antigas (a FK é sem
 * cascade, então na prática o DELETE falha com erro de banco) e, pior, apagaria a
 * evidência de onde a aula aconteceu. Desativar tira a sala das listas novas e
 * mantém o histórico legível.
 */
export async function deleteRoom(id: number): Promise<void> {
  await ensureAcademicSchema();
  const inUse = await getPool().query<{ total: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM ${SCHEMA}.academic_classes WHERE room_id = $1)
       + (SELECT COUNT(*) FROM ${SCHEMA}.academic_class_schedule WHERE room_id = $1)
     )::text AS total`,
    [id]
  );
  if (Number(inUse.rows[0]?.total ?? "0") > 0) {
    throw new Error("Esta sala está em uso por alguma turma ou horário. Desative-a em vez de excluir.");
  }
  const removed = await getPool().query(`DELETE FROM ${SCHEMA}.academic_rooms WHERE id = $1 RETURNING id`, [id]);
  if (removed.rowCount === 0) throw new Error("Sala não encontrada.");
}

/* ── Etiqueta de turma na matrícula ─────────────────────────────────────── */

/**
 * Onde cada contrato do Financeiro está, do ponto de vista da turma.
 *
 * Vive aqui e não em `lib/finance.ts` de propósito: a consulta de matrículas é usada
 * por toda a Gestão Financeira e não pode passar a depender das tabelas acadêmicas —
 * numa base onde o schema acadêmico ainda não nasceu, um JOIN a mais derrubaria a
 * tela de dinheiro inteira por causa de uma etiqueta.
 */
export async function listEnrollmentClassTags(): Promise<EnrollmentClassTag[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{
    enrollment_id: string;
    student_id: string | null;
    student_name: string | null;
    contract_class_id: string | null;
    contract_class_name: string | null;
    student_classes: unknown;
  }>(
    `SELECT e.id AS enrollment_id, e.student_id, s.full_name AS student_name,
            e.class_id AS contract_class_id, cc.name AS contract_class_name,
            COALESCE(links.items, '[]'::jsonb) AS student_classes
     FROM ${SCHEMA}.finance_enrollments e
     LEFT JOIN ${SCHEMA}.academic_students s ON s.id = e.student_id
     LEFT JOIN ${SCHEMA}.academic_classes cc ON cc.id = e.class_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
                'class_id', c.id,
                'class_name', c.name,
                'status', cs.status,
                'course_name', fc.name
              ) ORDER BY (cs.status = 'ativa') DESC, cs.created_at DESC) AS items
       FROM ${SCHEMA}.academic_class_students cs
       JOIN ${SCHEMA}.academic_classes c ON c.id = cs.class_id
       LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = c.course_id
       WHERE cs.student_id = e.student_id AND cs.status IN ('ativa', 'trancada')
     ) links ON TRUE`
  );

  return rows.map((row) => ({
    enrollmentId: Number(row.enrollment_id),
    studentId: row.student_id === null ? null : Number(row.student_id),
    studentName: row.student_name,
    contractClassId: row.contract_class_id === null ? null : Number(row.contract_class_id),
    contractClassName: row.contract_class_name,
    studentClasses: Array.isArray(row.student_classes)
      ? (row.student_classes as Array<Record<string, unknown>>).map((item) => ({
          classId: Number(item.class_id),
          className: String(item.class_name ?? ""),
          status: normalizeLinkStatus(item.status),
          courseName: (item.course_name as string) ?? null,
        }))
      : [],
  }));
}

/* ── Calendário institucional ───────────────────────────────────────────── */

function normalizeCalendarKind(value: unknown): CalendarDayKind {
  if (value === "feriado" || value === "recesso" || value === "letivo_extra") return value;
  throw new Error("Tipo de dia do calendário é inválido.");
}

function normalizeCalendarScope(value: unknown): CalendarDayScope {
  if (value === "didatico" || value === "financeiro" || value === "ambos") return value;
  throw new Error("Aplicação do dia no calendário é inválida.");
}

export async function listCalendarDays(): Promise<AcademicCalendarDay[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<{
    day: Date | string;
    kind: CalendarDayKind;
    label: string | null;
    scope: CalendarDayScope;
  }>(
    `SELECT day, kind, label, scope
     FROM ${SCHEMA}.academic_calendar_days
     ORDER BY day ASC`
  );
  return rows.map((row) => ({
    day: isoDate(row.day) ?? "",
    kind: normalizeCalendarKind(row.kind),
    label: row.label,
    scope: normalizeCalendarScope(row.scope),
  }));
}

export async function upsertCalendarDay(input: {
  day: string;
  kind: CalendarDayKind;
  label?: string | null;
  scope: CalendarDayScope;
}): Promise<void> {
  await ensureAcademicSchema();
  const day = String(input.day ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Informe uma data válida para o calendário.");
  await getPool().query(
    `INSERT INTO ${SCHEMA}.academic_calendar_days (day, kind, label, scope)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (day) DO UPDATE
       SET kind = EXCLUDED.kind, label = EXCLUDED.label, scope = EXCLUDED.scope`,
    [day, normalizeCalendarKind(input.kind), cleanText(input.label, 160), normalizeCalendarScope(input.scope)]
  );
}

export async function deleteCalendarDay(dayValue: string): Promise<void> {
  await ensureAcademicSchema();
  const day = String(dayValue ?? "").slice(0, 10);
  const removed = await getPool().query(
    `DELETE FROM ${SCHEMA}.academic_calendar_days WHERE day = $1 RETURNING day`,
    [day]
  );
  if (removed.rowCount === 0) throw new Error("Data não encontrada no calendário.");
}


// ── QUADRO DE AULAS ────────────────────────────────────────────────────────

/**
 * Dias em que não pode haver aula: feriado e recesso do calendário da escola
 * **mais** os feriados calculados (`lib/holidays.ts`).
 *
 * Os dois juntos de propósito: o cálculo garante que ninguém precise cadastrar
 * feriado nacional para o quadro sair certo, e o calendário permite à escola
 * acrescentar recesso e emenda. `letivo_extra` é o contrário — libera um dia que
 * o cálculo bloquearia.
 */
export async function blockedDaysForYears(years: number[]): Promise<Set<string>> {
  await ensureAcademicSchema();
  const blocked = holidayDaysForYears(years);

  const { rows } = await getPool().query<{ day: Date | string; kind: string }>(
    `SELECT day, kind FROM ${SCHEMA}.academic_calendar_days
      WHERE scope IN ('didatico', 'ambos')
        AND EXTRACT(YEAR FROM day)::int = ANY($1::int[])`,
    [years]
  );

  for (const row of rows) {
    const day = isoDate(row.day);
    if (!day) continue;
    if (row.kind === "letivo_extra") blocked.delete(day);
    else blocked.add(day);
  }

  return blocked;
}

/**
 * Grava os feriados calculados no calendário da escola, para a secretaria ver e
 * editar. Não sobrescreve o que já existe: recesso cadastrado à mão manda mais
 * do que a lista automática.
 */
export async function importHolidaysToCalendar(years: number[]): Promise<number> {
  await ensureAcademicSchema();
  let inseridos = 0;
  for (const year of years) {
    for (const holiday of holidaysForYear(year)) {
      const { rowCount } = await getPool().query(
        `INSERT INTO ${SCHEMA}.academic_calendar_days (day, kind, label, scope)
         VALUES ($1, 'feriado', $2, 'ambos')
         ON CONFLICT (day) DO NOTHING`,
        [holiday.day, holiday.label]
      );
      inseridos += rowCount ?? 0;
    }
  }
  return inseridos;
}

export interface LessonPlanPreview {
  slots: LessonSlot[];
  /** Feriados que empurraram alguma aula — a tela mostra para ninguém se assustar. */
  skipped: Array<{ date: string; label: string }>;
  endDate: string | null;
}

/**
 * Simula o quadro de aulas SEM gravar. É o que a tela mostra antes de o usuário
 * confirmar: ver as datas antes de salvar é o que evita descobrir o feriado
 * depois de a turma já ter sido combinada com o aluno.
 */
export async function previewLessonPlan(input: {
  startDate: string;
  weekdays: number[];
  lessonsCount: number;
}): Promise<LessonPlanPreview> {
  const years = yearsSpanned(input.startDate, input.lessonsCount, input.weekdays.length || 1);
  const blocked = await blockedDaysForYears(years);
  const slots = generateLessonDates({ ...input, blocked });

  const rotulos = new Map<string, string>();
  for (const year of years) {
    for (const holiday of holidaysForYear(year)) rotulos.set(holiday.day, holiday.label);
  }
  const { rows } = await getPool().query<{ day: Date | string; label: string | null; kind: string }>(
    `SELECT day, label, kind FROM ${SCHEMA}.academic_calendar_days
      WHERE scope IN ('didatico', 'ambos') AND EXTRACT(YEAR FROM day)::int = ANY($1::int[])`,
    [years]
  );
  for (const row of rows) {
    const day = isoDate(row.day);
    if (day) rotulos.set(day, row.label ?? (row.kind === "recesso" ? "Recesso" : "Feriado"));
  }

  const skipped = slots
    .flatMap((slot) => slot.skipped ?? [])
    .map((date) => ({ date, label: rotulos.get(date) ?? "Feriado" }));

  return { slots, skipped, endDate: lessonPlanEndDate(slots) };
}

/**
 * Grava o quadro de aulas da turma.
 *
 * Só substitui o que ainda **não aconteceu**: aula marcada como realizada (ou
 * cancelada) é histórico e permanece, mesmo que alguém regenere o plano. Sem
 * isso, um clique em "gerar de novo" apagaria a chamada já feita.
 */
export async function saveLessonPlan(
  classId: number,
  slots: LessonSlot[],
  defaults: { startTime?: string | null; endTime?: string | null; teacherEmployeeId?: number | null; roomId?: number | null } = {}
): Promise<{ created: number; kept: number }> {
  await ensureAcademicSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const mantidas = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${SCHEMA}.academic_class_lessons
        WHERE class_id = $1 AND status IN ('realizada', 'cancelada')`,
      [classId]
    );
    const kept = Number(mantidas.rows[0]?.total ?? "0");

    // Reposição não é apagada junto: ela não vem do gerador — foi marcada à mão
    // para um aluno específico, muitas vezes já com chamada lançada. Refazer o
    // quadro regular não pode desmarcar a reposição que alguém combinou.
    await client.query(
      `DELETE FROM ${SCHEMA}.academic_class_lessons
        WHERE class_id = $1 AND status = 'planejada'`,
      [classId]
    );

    let created = 0;
    for (const slot of slots) {
      const { rowCount } = await client.query(
        `INSERT INTO ${SCHEMA}.academic_class_lessons
           (class_id, sequence, lesson_date, start_time, end_time, teacher_employee_id, room_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (class_id, sequence) DO NOTHING`,
        [
          classId,
          slot.sequence,
          slot.date,
          defaults.startTime || null,
          defaults.endTime || null,
          defaults.teacherEmployeeId ?? null,
          defaults.roomId ?? null,
        ]
      );
      created += rowCount ?? 0;
    }

    // A turma passa a terminar na última aula: é a data que o aluno recebe.
    const fim = lessonPlanEndDate(slots);
    if (fim) {
      await client.query(
        `UPDATE ${SCHEMA}.academic_classes
            SET end_date = $2, start_date = COALESCE(start_date, $3), updated_at = NOW()
          WHERE id = $1`,
        [classId, fim, slots[0]?.date ?? null]
      );
    }

    await client.query("COMMIT");
    return { created, kept };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listClassLessons(classId: number): Promise<AcademicClassLesson[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT l.id, l.class_id, l.sequence, l.lesson_date, l.start_time, l.end_time,
            l.teacher_employee_id, e.name AS teacher_name, l.room_id, r.name AS room_name,
            l.status, l.topic, l.notes
       FROM ${SCHEMA}.academic_class_lessons l
       LEFT JOIN ${SCHEMA}.finance_employees e ON e.id = l.teacher_employee_id
       LEFT JOIN ${SCHEMA}.academic_rooms r ON r.id = l.room_id
      WHERE l.class_id = $1
      ORDER BY l.sequence`,
    [classId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    classId: Number(row.class_id),
    sequence: Number(row.sequence),
    date: isoDate(row.lesson_date as Date | string) ?? "",
    startTime: row.start_time ? shortTime(row.start_time) : null,
    endTime: row.end_time ? shortTime(row.end_time) : null,
    teacherEmployeeId: row.teacher_employee_id === null ? null : Number(row.teacher_employee_id),
    teacherName: (row.teacher_name as string | null) ?? null,
    roomId: row.room_id === null ? null : Number(row.room_id),
    roomName: (row.room_name as string | null) ?? null,
    status: normalizeLessonStatus(row.status),
    topic: (row.topic as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  }));
}

function normalizeLessonStatus(value: unknown): ClassLessonStatus {
  return value === "realizada" || value === "cancelada" || value === "reposicao"
    ? value
    : "planejada";
}

/** Edição de uma aula: data, professor, sala, situação, tema. */
export async function updateClassLesson(
  lessonId: number,
  input: {
    date?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    teacherEmployeeId?: number | null;
    roomId?: number | null;
    status?: ClassLessonStatus;
    topic?: string | null;
    notes?: string | null;
  }
): Promise<void> {
  await ensureAcademicSchema();
  const values: unknown[] = [lessonId];
  const sets: string[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.date !== undefined) {
    if (!input.date) throw new Error("A aula precisa de data.");
    set("lesson_date", input.date);
  }
  if (input.startTime !== undefined) set("start_time", input.startTime || null);
  if (input.endTime !== undefined) set("end_time", input.endTime || null);
  if (input.teacherEmployeeId !== undefined) set("teacher_employee_id", input.teacherEmployeeId ?? null);
  if (input.roomId !== undefined) set("room_id", input.roomId ?? null);
  if (input.status !== undefined) set("status", normalizeLessonStatus(input.status));
  if (input.topic !== undefined) set("topic", cleanText(input.topic, 200));
  if (input.notes !== undefined) set("notes", cleanText(input.notes, 2000));
  if (sets.length === 0) return;
  sets.push("updated_at = NOW()");

  const { rowCount } = await getPool().query(
    `UPDATE ${SCHEMA}.academic_class_lessons SET ${sets.join(", ")} WHERE id = $1`,
    values
  );
  if (rowCount === 0) throw new Error("Aula não encontrada.");
}


export interface OpenClassOption {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  seatsLeft: number | null;
  activeStudents: number;
  /** Grade resumida: "Terça 19:00" — é o que o aluno pergunta na hora de fechar. */
  scheduleLabel: string;
  teacherName: string | null;
  lessonsTotal: number;
}

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Turmas que ainda aceitam matrícula naquele curso.
 *
 * Usada na hora de fechar a venda: o vendedor está com o cliente e precisa
 * combinar o dia da aula ali, não depois. Turma encerrada e turma lotada ficam
 * de fora — oferecer vaga que não existe é pior do que não oferecer nada.
 */
export async function listOpenClassesForCourse(courseId: number): Promise<OpenClassOption[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT c.id, c.name, c.start_date, c.end_date, c.capacity,
            e.name AS teacher_name,
            COALESCE(roster.total, 0) AS active_students,
            COALESCE(aulas.total, 0) AS lessons_total,
            COALESCE(grade.items, '[]'::jsonb) AS schedule
       FROM ${SCHEMA}.academic_classes c
       LEFT JOIN ${SCHEMA}.finance_employees e ON e.id = c.teacher_employee_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE cs.status = 'ativa')::int AS total
         FROM ${SCHEMA}.academic_class_students cs WHERE cs.class_id = c.id
       ) roster ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total FROM ${SCHEMA}.academic_class_lessons l WHERE l.class_id = c.id
       ) aulas ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', s.start_time)
                          ORDER BY s.weekday, s.start_time) AS items
         FROM ${SCHEMA}.academic_class_schedule s WHERE s.class_id = c.id
       ) grade ON TRUE
      WHERE c.course_id = $1
        AND c.status <> 'encerrada'
        AND (c.capacity IS NULL OR COALESCE(roster.total, 0) < c.capacity)
      ORDER BY c.start_date NULLS LAST, c.name
      LIMIT 50`,
    [courseId]
  );

  return rows.map((row) => {
    const capacity = row.capacity === null ? null : Number(row.capacity);
    const activeStudents = Number(row.active_students) || 0;
    const slots = Array.isArray(row.schedule) ? (row.schedule as Array<Record<string, unknown>>) : [];
    return {
      id: Number(row.id),
      name: String(row.name ?? ""),
      startDate: isoDate(row.start_date as Date | string),
      endDate: isoDate(row.end_date as Date | string),
      seatsLeft: seatsLeft(capacity, activeStudents),
      activeStudents,
      scheduleLabel: slots
        .map((slot) => `${WEEKDAY_LABELS[Number(slot.weekday)] ?? ""} ${shortTime(slot.start_time)}`.trim())
        .join(" · "),
      teacherName: (row.teacher_name as string | null) ?? null,
      lessonsTotal: Number(row.lessons_total) || 0,
    };
  });
}


export interface TeacherOptionRow {
  /** Id em `finance_employees` — é o que a turma e a aula gravam. */
  id: number;
  name: string;
}

/**
 * Professores oferecidos na turma: os **usuários do sistema** marcados como
 * professor (`team_members.is_teacher`).
 *
 * Antes a lista vinha de `finance_employees`, que é a folha de pagamento — ela
 * tem gente que não dá aula e não tem quem entrou como usuário depois. Mesma
 * solução dos vendedores (`listCommissionSellers`): a lista sai da equipe, e a
 * linha em `finance_employees` continua sendo a chave gravada, criada aqui
 * quando ainda não existe, porque é para ela que apontam turma, aula e as FKs.
 */
export async function listTeacherOptions(): Promise<TeacherOptionRow[]> {
  await ensureAcademicSchema();
  const pool = getPool();

  const { rows: team } = await pool.query<{ name: string }>(
    `SELECT name FROM ${SCHEMA}.team_members
      WHERE active AND is_teacher AND COALESCE(TRIM(name), '') <> ''
      ORDER BY name`
  );

  const options: TeacherOptionRow[] = [];
  for (const member of team) {
    const name = member.name.trim();
    // Casamento por nome sem acento/caixa: `finance_employees` não guarda e-mail.
    const { rows: found } = await pool.query<{ id: string }>(
      `SELECT id FROM ${SCHEMA}.finance_employees
        WHERE UPPER(TRIM(TRANSLATE(name,
          'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')))
            = UPPER(TRIM(TRANSLATE($1,
          'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')))
        ORDER BY active DESC, id
        LIMIT 1`,
      [name]
    );

    let id = found[0] ? Number(found[0].id) : null;
    if (!id) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO ${SCHEMA}.finance_employees (name, role)
         VALUES ($1, 'Professor')
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name]
      );
      id = Number(rows[0].id);
    }
    await pool.query(`UPDATE ${SCHEMA}.finance_employees SET active = TRUE WHERE id = $1`, [id]);
    options.push({ id, name });
  }

  return options;
}


/**
 * Gera o quadro de aulas sozinho, no momento em que a turma passa a ter tudo o
 * que a geração precisa: curso com nº de aulas, grade com dia da semana e data
 * de início.
 *
 * É isto que a operação espera: "uma aula por semana, começa quarta, o curso
 * tem 25 aulas" já é o plano inteiro — ninguém deveria ter que pedir para
 * gerar. Roda depois de criar e depois de editar a turma, e **só quando ainda
 * não existe aula**: turma com quadro montado (ou com aula já dada) não é
 * refeita pelas costas de quem ajustou as datas na mão.
 */
export async function autoGenerateLessonPlan(classId: number): Promise<number> {
  await ensureAcademicSchema();
  const pool = getPool();

  const { rows: existentes } = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM ${SCHEMA}.academic_class_lessons WHERE class_id = $1`,
    [classId]
  );
  if (Number(existentes[0]?.total ?? "0") > 0) return 0;

  const { rows } = await pool.query<{
    start_date: Date | string | null;
    lessons_count: number | null;
    teacher_employee_id: string | number | null;
    room_id: string | number | null;
    weekdays: number[] | null;
    start_time: string | null;
    end_time: string | null;
  }>(
    `SELECT c.start_date, fc.lessons_count, c.teacher_employee_id, c.room_id,
            grade.weekdays, grade.start_time, grade.end_time
       FROM ${SCHEMA}.academic_classes c
       LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = c.course_id
       LEFT JOIN LATERAL (
         SELECT ARRAY_AGG(DISTINCT s.weekday) AS weekdays,
                MIN(s.start_time)::text AS start_time,
                MIN(s.end_time)::text AS end_time
         FROM ${SCHEMA}.academic_class_schedule s WHERE s.class_id = c.id
       ) grade ON TRUE
      WHERE c.id = $1`,
    [classId]
  );

  const row = rows[0];
  const lessonsCount = Number(row?.lessons_count ?? 0);
  const weekdays = row?.weekdays ?? [];
  const startDate = isoDate(row?.start_date ?? null);
  // Faltando qualquer uma das três, não há plano possível — e inventar data de
  // início ou número de aulas seria pior do que não gerar.
  if (!row || lessonsCount < 1 || weekdays.length === 0 || !startDate) return 0;

  const years = yearsSpanned(startDate, lessonsCount, weekdays.length);
  const blocked = await blockedDaysForYears(years);
  const slots = generateLessonDates({ startDate, weekdays, lessonsCount, blocked });
  if (slots.length === 0) return 0;

  const { created } = await saveLessonPlan(classId, slots, {
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    teacherEmployeeId: row.teacher_employee_id === null ? null : Number(row.teacher_employee_id),
    roomId: row.room_id === null ? null : Number(row.room_id),
  });
  return created;
}

/** Alguém que comprou esta turma e ainda não aparece no diário dela. */
export interface ClassPendingSeat {
  enrollmentId: number;
  /** Nome como está na matrícula (pagador) ou na ficha (aluno adicional). */
  name: string;
  studentId: number | null;
  /** `true` quando é o 2º aluno de um contrato de casal. */
  additional: boolean;
  courseName: string | null;
  saleDate: string | null;
}

/**
 * Quem comprou esta turma e não está no diário dela.
 *
 * Existe porque o vínculo com a turma mora na FICHA do aluno, e a matrícula
 * guarda a turma vendida numa coluna própria (`class_id`). Quando a ficha nunca
 * foi criada — o caso de toda venda lançada direto no Financeiro —, a matrícula
 * aponta para a turma e o diário abre vazio no dia da aula, sem nada na tela
 * explicando por quê. Esta lista é a explicação.
 *
 * Cobre também o 2º aluno de um contrato de casal, que tem turma própria
 * (`finance_enrollment_participants.class_id`) ou herda a do pagador.
 */
export async function listClassPendingSeats(classId: number): Promise<ClassPendingSeat[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query(
    `WITH esperados AS (
       SELECT e.id AS enrollment_id, e.student AS name, e.student_id, FALSE AS additional,
              e.course_id, e.sale_date
         FROM ${SCHEMA}.finance_enrollments e
        WHERE e.class_id = $1
       UNION ALL
       SELECT p.enrollment_id, COALESCE(s.full_name, 'Aluno adicional') AS name, p.student_id, TRUE AS additional,
              p.course_id, e.sale_date
         FROM ${SCHEMA}.finance_enrollment_participants p
         JOIN ${SCHEMA}.finance_enrollments e ON e.id = p.enrollment_id
         LEFT JOIN ${SCHEMA}.academic_students s ON s.id = p.student_id
        WHERE COALESCE(p.class_id, e.class_id) = $1
     )
     SELECT esperados.enrollment_id, esperados.name, esperados.student_id, esperados.additional,
            fc.name AS course_name, esperados.sale_date::text AS sale_date
       FROM esperados
       LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = esperados.course_id
      WHERE esperados.student_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.academic_class_students cs
            WHERE cs.class_id = $1 AND cs.student_id = esperados.student_id AND cs.status = 'ativa'
         )
      ORDER BY esperados.additional, esperados.name`,
    [classId]
  );
  return rows.map((row) => ({
    enrollmentId: Number(row.enrollment_id),
    name: String(row.name ?? ""),
    studentId: row.student_id === null ? null : Number(row.student_id),
    additional: Boolean(row.additional),
    courseName: (row.course_name as string | null) ?? null,
    saleDate: (row.sale_date as string | null) ?? null,
  }));
}

// ── Diário de aula ───────────────────────────────────────────────────────

function normalizeAttendanceStatus(value: unknown): AttendanceStatus | null {
  return value === "presente" || value === "falta" || value === "justificada" ? value : null;
}

/** Chamada lançada da turma inteira — uma linha por aluno por aula. */
export async function listClassAttendance(classId: number): Promise<LessonAttendanceMark[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT a.lesson_id, a.student_id, a.status, a.note, a.marked_by, a.marked_at
       FROM ${SCHEMA}.academic_lesson_attendance a
       JOIN ${SCHEMA}.academic_class_lessons l ON l.id = a.lesson_id
      WHERE l.class_id = $1`,
    [classId]
  );
  return rows.map((row) => ({
    lessonId: Number(row.lesson_id),
    studentId: Number(row.student_id),
    status: normalizeAttendanceStatus(row.status) ?? "presente",
    note: (row.note as string | null) ?? null,
    markedBy: (row.marked_by as string | null) ?? null,
    markedAt: isoStamp(row.marked_at as Date | string),
  }));
}

/**
 * Grava a chamada de UMA aula.
 *
 * A lista que chega é a chamada inteira daquela aula: o que não vem é apagado,
 * e não fica valendo a marcação anterior de um aluno que saiu da turma. Aluno
 * sem status na lista volta a ser "não lançado" — que é diferente de falta.
 *
 * Lançar chamada conclui a aula: `planejada` vira `realizada`. Aula de
 * reposição mantém o status dela, senão o quadro perde a informação de que
 * aquela data foi reposição.
 */
export async function saveLessonAttendance(
  lessonId: number,
  entries: Array<{ studentId: number; status: AttendanceStatus | null; note?: string | null }>,
  actorName: string | null
): Promise<void> {
  await ensureAcademicSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ class_id: string }>(
      `SELECT class_id FROM ${SCHEMA}.academic_class_lessons WHERE id = $1 FOR UPDATE`,
      [lessonId]
    );
    if (!rows[0]) throw new Error("Aula não encontrada.");

    await client.query(`DELETE FROM ${SCHEMA}.academic_lesson_attendance WHERE lesson_id = $1`, [
      lessonId,
    ]);
    for (const entry of entries) {
      const status = normalizeAttendanceStatus(entry.status);
      if (!status || !(entry.studentId > 0)) continue;
      await client.query(
        `INSERT INTO ${SCHEMA}.academic_lesson_attendance
           (lesson_id, student_id, status, note, marked_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [lessonId, entry.studentId, status, cleanText(entry.note, 300), cleanText(actorName, 120)]
      );
    }

    await client.query(
      `UPDATE ${SCHEMA}.academic_class_lessons
          SET status = 'realizada', updated_at = NOW()
        WHERE id = $1 AND status = 'planejada'`,
      [lessonId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Aula avulsa de reposição, no fim do quadro.
 *
 * O gerador de quadro cria as aulas regulares pulando feriado; a reposição é o
 * contrário — nasce de uma falta, numa data combinada caso a caso. Nasce com
 * status `reposicao`, que é o que a mantém distinguível, e numa **faixa própria
 * de sequência (1000+)**: o quadro regular vai até 400 aulas, e se a reposição
 * ocupasse a sequência seguinte à última, refazer o quadro com mais aulas
 * esbarraria nela — o `ON CONFLICT DO NOTHING` de `saveLessonPlan` engoliria
 * uma aula regular sem avisar ninguém.
 */
export async function createMakeupLesson(
  classId: number,
  input: { date: string; startTime?: string | null; endTime?: string | null; topic?: string | null }
): Promise<number> {
  await ensureAcademicSchema();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Informe a data da reposição.");

  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.academic_class_lessons
       (class_id, sequence, lesson_date, start_time, end_time, teacher_employee_id, room_id, status, topic)
     SELECT c.id,
            COALESCE((SELECT MAX(sequence) FROM ${SCHEMA}.academic_class_lessons
                       WHERE class_id = c.id AND sequence >= 1000), 999) + 1,
            $2::date, $3::time, $4::time, c.teacher_employee_id, c.room_id, 'reposicao', $5
       FROM ${SCHEMA}.academic_classes c
      WHERE c.id = $1
     RETURNING id`,
    [
      classId,
      input.date,
      input.startTime || null,
      input.endTime || null,
      cleanText(input.topic, 200),
    ]
  );
  if (!rows[0]) throw new Error("Turma não encontrada.");
  return Number(rows[0].id);
}

// ── Reposição ────────────────────────────────────────────────────────────

/**
 * Reposições que tocam esta turma, nos dois sentidos: as faltas DELA que serão
 * repostas em outro lugar e os alunos DE FORA que vêm repor aqui.
 *
 * As duas pontas vêm juntas porque a mesma tela precisa das duas: quem lança a
 * chamada tem de ver o visitante na lista, e quem olha as pendências tem de ver
 * para onde cada falta foi remarcada.
 */
export async function listClassMakeups(classId: number): Promise<LessonMakeup[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT m.id, m.student_id, s.full_name AS student_name,
            ml.id AS missed_lesson_id, ml.sequence AS missed_sequence, ml.lesson_date AS missed_date,
            mc.id AS missed_class_id, mc.name AS missed_class_name,
            kl.id AS makeup_lesson_id, kl.sequence AS makeup_sequence, kl.lesson_date AS makeup_date,
            kl.start_time AS makeup_start_time,
            kc.id AS makeup_class_id, kc.name AS makeup_class_name,
            att.status AS result
       FROM ${SCHEMA}.academic_lesson_makeups m
       JOIN ${SCHEMA}.academic_students s ON s.id = m.student_id
       JOIN ${SCHEMA}.academic_class_lessons ml ON ml.id = m.missed_lesson_id
       JOIN ${SCHEMA}.academic_classes mc ON mc.id = ml.class_id
       JOIN ${SCHEMA}.academic_class_lessons kl ON kl.id = m.makeup_lesson_id
       JOIN ${SCHEMA}.academic_classes kc ON kc.id = kl.class_id
       LEFT JOIN ${SCHEMA}.academic_lesson_attendance att
              ON att.lesson_id = kl.id AND att.student_id = m.student_id
      WHERE ml.class_id = $1 OR kl.class_id = $1
      ORDER BY kl.lesson_date, s.full_name`,
    [classId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    studentId: Number(row.student_id),
    studentName: String(row.student_name ?? ""),
    missedLessonId: Number(row.missed_lesson_id),
    missedClassId: Number(row.missed_class_id),
    missedClassName: String(row.missed_class_name ?? ""),
    missedSequence: Number(row.missed_sequence),
    missedDate: isoDate(row.missed_date as Date | string) ?? "",
    makeupLessonId: Number(row.makeup_lesson_id),
    makeupClassId: Number(row.makeup_class_id),
    makeupClassName: String(row.makeup_class_name ?? ""),
    makeupSequence: Number(row.makeup_sequence),
    makeupDate: isoDate(row.makeup_date as Date | string) ?? "",
    makeupStartTime: row.makeup_start_time ? shortTime(row.makeup_start_time) : null,
    result: normalizeAttendanceStatus(row.result),
  }));
}

/**
 * Onde esta aula pode ser reposta.
 *
 * Duas origens, na ordem em que a secretaria pensa:
 * 1. a **mesma aula** (mesma sequência) numa turma paralela do mesmo curso —
 *    é a reposição do dia a dia, e por isso a aula 5 só é reposta por outra
 *    aula 5: repor conteúdo trocado não forma ninguém;
 * 2. uma **aula extra de reposição** da própria turma, para quando não existe
 *    turma paralela naquele ponto do curso.
 *
 * Só entram aulas que ainda vão acontecer e que não foram canceladas — oferecer
 * data passada seria oferecer uma reposição impossível.
 */
export async function listMakeupOptions(missedLessonId: number): Promise<MakeupOption[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT l.id, l.sequence, l.lesson_date, l.start_time, l.end_time,
            c.id AS class_id, c.name AS class_name,
            (c.id = origem.id) AS same_class,
            COALESCE(ativos.total, 0) AS active_students
       FROM ${SCHEMA}.academic_class_lessons alvo
       JOIN ${SCHEMA}.academic_classes origem ON origem.id = alvo.class_id
       JOIN ${SCHEMA}.academic_class_lessons l
         ON l.id <> alvo.id AND l.lesson_date >= CURRENT_DATE AND l.status <> 'cancelada'
       JOIN ${SCHEMA}.academic_classes c ON c.id = l.class_id AND c.status <> 'encerrada'
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total
           FROM ${SCHEMA}.academic_class_students cs
          WHERE cs.class_id = c.id AND cs.status = 'ativa'
       ) ativos ON TRUE
      WHERE alvo.id = $1
        AND (
          (c.id <> origem.id AND origem.course_id IS NOT NULL
             AND c.course_id = origem.course_id AND l.sequence = alvo.sequence)
          OR (c.id = origem.id AND l.status = 'reposicao')
        )
      ORDER BY l.lesson_date, c.name
      LIMIT 40`,
    [missedLessonId]
  );

  return rows.map((row) => ({
    lessonId: Number(row.id),
    classId: Number(row.class_id),
    className: String(row.class_name ?? ""),
    sequence: Number(row.sequence),
    date: isoDate(row.lesson_date as Date | string) ?? "",
    startTime: row.start_time ? shortTime(row.start_time) : null,
    endTime: row.end_time ? shortTime(row.end_time) : null,
    sameClass: row.same_class === true,
    activeStudents: Number(row.active_students) || 0,
  }));
}

/**
 * Remarca uma aula perdida. Um aluno tem uma reposição por aula perdida: marcar
 * de novo troca a data em vez de criar uma segunda, que é o que a secretaria
 * quer dizer quando remarca pela segunda vez.
 */
export async function scheduleMakeup(input: {
  studentId: number;
  missedLessonId: number;
  makeupLessonId: number;
  actorName?: string | null;
}): Promise<number> {
  await ensureAcademicSchema();
  if (input.missedLessonId === input.makeupLessonId) {
    throw new Error("A aula de reposição precisa ser outra aula.");
  }

  const opcoes = await listMakeupOptions(input.missedLessonId);
  if (!opcoes.some((option) => option.lessonId === input.makeupLessonId)) {
    throw new Error(
      "Essa aula não serve de reposição para a aula perdida: tem que ser a mesma aula em turma do mesmo curso, ou uma aula extra de reposição da própria turma, e ainda não pode ter acontecido."
    );
  }

  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.academic_lesson_makeups
       (student_id, missed_lesson_id, makeup_lesson_id, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (student_id, missed_lesson_id)
       DO UPDATE SET makeup_lesson_id = EXCLUDED.makeup_lesson_id,
                     created_by = EXCLUDED.created_by,
                     created_at = NOW()
     RETURNING id`,
    [input.studentId, input.missedLessonId, input.makeupLessonId, cleanText(input.actorName, 120)]
  );
  return Number(rows[0].id);
}

/** Desmarca a reposição. A falta continua lá — o que se desfaz é o agendamento. */
export async function cancelMakeup(makeupId: number): Promise<void> {
  await ensureAcademicSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.academic_lesson_makeups WHERE id = $1`, [makeupId]);
}

/** Uma aula de qualquer turma, com o estado da chamada — a linha da tela /chamada. */
export interface DayLesson {
  lessonId: number;
  classId: number;
  className: string;
  courseName: string | null;
  sequence: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: ClassLessonStatus;
  teacherName: string | null;
  roomName: string | null;
  activeStudents: number;
  /** Alunos com marca lançada nesta aula (inclui visitantes de reposição). */
  marked: number;
  presentes: number;
  /** Alunos de outra turma marcados para repor aqui. */
  visitors: number;
}

/**
 * Agenda de chamada: as aulas de todas as turmas num intervalo de datas.
 *
 * Existe porque a chamada é uma tarefa do DIA, não da turma: quem vai lançar
 * abre o sistema querendo "as aulas de hoje", e obrigar a pessoa a lembrar em
 * qual das cinco turmas houve aula é o que faz a chamada não ser lançada.
 */
export async function listLessonsInRange(from: string, to: string): Promise<DayLesson[]> {
  await ensureAcademicSchema();
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT l.id, l.sequence, l.lesson_date, l.start_time, l.end_time, l.status,
            c.id AS class_id, c.name AS class_name, fc.name AS course_name,
            COALESCE(e.name, ce.name) AS teacher_name, r.name AS room_name,
            COALESCE(ativos.total, 0) AS active_students,
            COALESCE(chamada.marcados, 0) AS marked,
            COALESCE(chamada.presentes, 0) AS presentes,
            COALESCE(reposicoes.total, 0) AS visitors
       FROM ${SCHEMA}.academic_class_lessons l
       JOIN ${SCHEMA}.academic_classes c ON c.id = l.class_id
       LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = c.course_id
       LEFT JOIN ${SCHEMA}.finance_employees e ON e.id = l.teacher_employee_id
       LEFT JOIN ${SCHEMA}.finance_employees ce ON ce.id = c.teacher_employee_id
       LEFT JOIN ${SCHEMA}.academic_rooms r ON r.id = COALESCE(l.room_id, c.room_id)
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total
           FROM ${SCHEMA}.academic_class_students cs
          WHERE cs.class_id = c.id AND cs.status = 'ativa'
       ) ativos ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS marcados,
                COUNT(*) FILTER (WHERE a.status = 'presente')::int AS presentes
           FROM ${SCHEMA}.academic_lesson_attendance a
          WHERE a.lesson_id = l.id
       ) chamada ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total
           FROM ${SCHEMA}.academic_lesson_makeups m
          WHERE m.makeup_lesson_id = l.id
       ) reposicoes ON TRUE
      WHERE l.lesson_date BETWEEN $1::date AND $2::date
      ORDER BY l.lesson_date, l.start_time NULLS LAST, c.name`,
    [from, to]
  );

  return rows.map((row) => ({
    lessonId: Number(row.id),
    classId: Number(row.class_id),
    className: String(row.class_name ?? ""),
    courseName: (row.course_name as string | null) ?? null,
    sequence: Number(row.sequence),
    date: isoDate(row.lesson_date as Date | string) ?? "",
    startTime: row.start_time ? shortTime(row.start_time) : null,
    endTime: row.end_time ? shortTime(row.end_time) : null,
    status: normalizeLessonStatus(row.status),
    teacherName: (row.teacher_name as string | null) ?? null,
    roomName: (row.room_name as string | null) ?? null,
    activeStudents: Number(row.active_students) || 0,
    marked: Number(row.marked) || 0,
    presentes: Number(row.presentes) || 0,
    visitors: Number(row.visitors) || 0,
  }));
}
