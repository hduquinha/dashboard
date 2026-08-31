import { NextResponse } from "next/server";
import {
  listClassLessons,
  previewLessonPlan,
  saveLessonPlan,
  updateClassLesson,
} from "@/lib/academicClasses";
import { requireClassAccess } from "../../route";
import { getPool } from "@/lib/db";
import type { ClassLessonStatus } from "@/types/academic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

function parseId(value: string, label = "Turma"): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} inválida.`);
  return parsed;
}

/** Nº de aulas do curso da turma — a fonte do tamanho do quadro. */
async function lessonsCountForClass(classId: number): Promise<number> {
  const { rows } = await getPool().query<{ lessons_count: number | null }>(
    `SELECT fc.lessons_count
       FROM dashboard.academic_classes c
       JOIN dashboard.finance_courses fc ON fc.id = c.course_id
      WHERE c.id = $1`,
    [classId]
  );
  return Number(rows[0]?.lessons_count ?? 0);
}

/** Quadro de aulas da turma. */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  return NextResponse.json({ lessons: await listClassLessons(parseId(id)) });
}

/**
 * Duas ações no mesmo verbo, escolhidas por `action`:
 * - `preview` calcula as datas e devolve sem gravar (é o que a tela mostra);
 * - `save` grava o quadro, preservando aula já realizada ou cancelada.
 *
 * Ficam juntas porque o preview é o passo obrigatório antes de salvar: ver as
 * datas com os feriados marcados é o que evita combinar com o aluno uma data
 * que o calendário vai empurrar.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const [{ id }, body] = await Promise.all([
      context.params,
      request.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    ]);
    const classId = parseId(id);

    const startDate = typeof body.startDate === "string" ? body.startDate : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error("Informe a data da primeira aula.");
    }
    const weekdays = Array.isArray(body.weekdays)
      ? body.weekdays.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [];
    if (weekdays.length === 0) throw new Error("Escolha ao menos um dia da semana.");

    // O número de aulas é do CURSO. A tela não precisa saber: manda só a turma,
    // e quem responde é o cadastro — assim o quadro nunca sai com um total
    // diferente do que foi vendido.
    const lessonsCount = Number(body.lessonsCount) || (await lessonsCountForClass(classId));
    if (!Number.isFinite(lessonsCount) || lessonsCount < 1 || lessonsCount > 400) {
      throw new Error(
        "O curso desta turma não tem número de aulas cadastrado. Preencha em Cursos antes de gerar o quadro."
      );
    }

    const plan = await previewLessonPlan({ startDate, weekdays, lessonsCount });

    if (body.action === "save") {
      const result = await saveLessonPlan(classId, plan.slots, {
        startTime: typeof body.startTime === "string" ? body.startTime : null,
        endTime: typeof body.endTime === "string" ? body.endTime : null,
        teacherEmployeeId:
          body.teacherEmployeeId === null || body.teacherEmployeeId === undefined
            ? null
            : Number(body.teacherEmployeeId),
        roomId: body.roomId === null || body.roomId === undefined ? null : Number(body.roomId),
      });
      return NextResponse.json({ ...plan, ...result, lessons: await listClassLessons(classId) });
    }

    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar o quadro de aulas." },
      { status: 400 }
    );
  }
}

/** Edição de uma aula: remarcar, trocar professor, marcar como realizada. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const [{ id }, body] = await Promise.all([
      context.params,
      request.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    ]);
    const classId = parseId(id);
    const lessonId = parseId(String(body.lessonId ?? ""), "Aula");

    await updateClassLesson(lessonId, {
      date: typeof body.date === "string" ? body.date : undefined,
      startTime: body.startTime === undefined ? undefined : String(body.startTime ?? "") || null,
      endTime: body.endTime === undefined ? undefined : String(body.endTime ?? "") || null,
      teacherEmployeeId:
        body.teacherEmployeeId === undefined
          ? undefined
          : body.teacherEmployeeId === null || body.teacherEmployeeId === ""
            ? null
            : Number(body.teacherEmployeeId),
      roomId:
        body.roomId === undefined
          ? undefined
          : body.roomId === null || body.roomId === "" ? null : Number(body.roomId),
      status: body.status === undefined ? undefined : (body.status as ClassLessonStatus),
      topic: body.topic === undefined ? undefined : String(body.topic ?? "") || null,
      notes: body.notes === undefined ? undefined : String(body.notes ?? "") || null,
    });

    return NextResponse.json({ lessons: await listClassLessons(classId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar a aula." },
      { status: 400 }
    );
  }
}
