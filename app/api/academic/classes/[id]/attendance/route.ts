import { NextResponse } from "next/server";
import {
  cancelMakeup,
  createMakeupLesson,
  listClassAttendance,
  listClassLessons,
  listClassMakeups,
  listMakeupOptions,
  saveLessonAttendance,
  scheduleMakeup,
} from "@/lib/academicClasses";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { requireClassAccess } from "../../route";
import type { AttendanceStatus } from "@/types/academic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

function parseId(value: string, label = "Turma"): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} inválida.`);
  return parsed;
}

/**
 * Chamada da turma inteira, com o quadro de aulas e as reposições junto.
 *
 * Vêm na mesma resposta porque o diário só faz sentido com as três: presença
 * sem as datas não diz nada, e sem as reposições a chamada esconderia o
 * visitante que vem repor aqui.
 *
 * `?opcoes=<aula>` é a outra pergunta da tela — "onde esta falta pode ser
 * reposta" —, respondida só quando alguém abre o remarcar.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;

  const classId = parseId((await context.params).id);
  const opcoesPara = new URL(request.url).searchParams.get("opcoes");
  if (opcoesPara) {
    return NextResponse.json({ options: await listMakeupOptions(parseId(opcoesPara, "Aula")) });
  }

  const [lessons, attendance, makeups] = await Promise.all([
    listClassLessons(classId),
    listClassAttendance(classId),
    listClassMakeups(classId),
  ]);
  return NextResponse.json({ lessons, attendance, makeups });
}

function parseEntries(value: unknown): Array<{
  studentId: number;
  status: AttendanceStatus | null;
  note?: string | null;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const studentId = Number(row.studentId);
    if (!Number.isFinite(studentId) || studentId < 1) return [];
    const status = row.status;
    return [
      {
        studentId,
        status:
          status === "presente" || status === "falta" || status === "justificada" ? status : null,
        note: typeof row.note === "string" ? row.note : null,
      },
    ];
  });
}

/** O diário inteiro da turma — o que toda ação devolve para a tela redesenhar. */
async function snapshot(classId: number) {
  const [lessons, attendance, makeups] = await Promise.all([
    listClassLessons(classId),
    listClassAttendance(classId),
    listClassMakeups(classId),
  ]);
  return { lessons, attendance, makeups };
}

/**
 * Quatro ações no mesmo verbo, escolhidas por `action`:
 * - `chamada` (padrão) grava a presença de uma aula;
 * - `remarcar` manda a falta para a mesma aula em outra turma;
 * - `desmarcar` desfaz esse agendamento (a falta continua);
 * - `reposicao` cria a aula extra, para quando não há turma paralela.
 *
 * Ficam juntas porque nascem do mesmo lugar: quem olha o mapa de presença e vê
 * a falta é quem remarca a aula, na mesma tela.
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

    if (body.action === "reposicao") {
      const lessonId = await createMakeupLesson(classId, {
        date: typeof body.date === "string" ? body.date : "",
        startTime: typeof body.startTime === "string" ? body.startTime : null,
        endTime: typeof body.endTime === "string" ? body.endTime : null,
        topic: typeof body.topic === "string" ? body.topic : null,
      });
      await recordFinanceEvent({
        entity: "turma",
        entityId: classId,
        action: "create",
        label: `Aula de reposição ${String(body.date ?? "")}`,
        note: `Turma #${classId}`,
        actorName: auth.session!.user.name,
        actorEmail: auth.session!.user.email,
        before: null,
        after: null,
        changes: [],
      }).catch(() => undefined);

      return NextResponse.json({ ...(await snapshot(classId)), lessonId });
    }

    if (body.action === "remarcar") {
      await scheduleMakeup({
        studentId: Number(body.studentId),
        missedLessonId: Number(body.missedLessonId),
        makeupLessonId: Number(body.makeupLessonId),
        actorName: auth.session!.user.name,
      });
      await recordFinanceEvent({
        entity: "turma",
        entityId: classId,
        action: "update",
        label: "Aula remarcada para reposição",
        note: `Turma #${classId}`,
        actorName: auth.session!.user.name,
        actorEmail: auth.session!.user.email,
        before: null,
        after: {
          aluno: Number(body.studentId),
          aula_perdida: Number(body.missedLessonId),
          aula_reposicao: Number(body.makeupLessonId),
        },
        changes: [],
      }).catch(() => undefined);
      return NextResponse.json(await snapshot(classId));
    }

    if (body.action === "desmarcar") {
      await cancelMakeup(parseId(String(body.makeupId ?? ""), "Reposição"));
      return NextResponse.json(await snapshot(classId));
    }

    const lessonId = parseId(String(body.lessonId ?? ""), "Aula");
    const entries = parseEntries(body.entries);
    await saveLessonAttendance(lessonId, entries, auth.session!.user.name);

    await recordFinanceEvent({
      entity: "turma",
      entityId: classId,
      action: "update",
      label: "Chamada lançada",
      note: `Turma #${classId}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: null,
      after: {
        aula: lessonId,
        presentes: entries.filter((entry) => entry.status === "presente").length,
        faltas: entries.filter((entry) => entry.status === "falta").length,
        justificadas: entries.filter((entry) => entry.status === "justificada").length,
      },
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json(await snapshot(classId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao lançar a chamada." },
      { status: 400 }
    );
  }
}
