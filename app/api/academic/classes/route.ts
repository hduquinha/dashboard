import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { createClass, getClassById, listClasses } from "@/lib/academicClasses";
import type { AcademicClassFilters, AcademicClassInput, ClassStatus } from "@/types/academic";

export const dynamic = "force-dynamic";

export async function requireClassAccess(edit: boolean) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), session: null };
  }
  const permission = edit ? "classes.manage" : "view.classes";
  if (!hasPermission(session.user, permission)) {
    return {
      error: NextResponse.json(
        { error: edit ? "Sem permissao para gerenciar turmas." : "Sem permissao para ver turmas." },
        { status: 403 }
      ),
      session: null,
    };
  }
  return { error: null, session };
}

/**
 * Lê o corpo como PATCH de verdade: chave ausente vira `undefined` e o UPDATE
 * preserva a coluna.
 *
 * Curso, nível, professor e situação saíram do formulário (turma e curso são a mesma
 * coisa nesta escola, e a situação passou a ser consequência da ação "Encerrar"), mas
 * as colunas continuam existindo. Se o parser continuasse traduzindo "campo ausente"
 * para `null`, toda edição de horário zeraria as quatro.
 */
export function parseClassInput(body: Record<string, unknown>): AcademicClassInput {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const optionalId = (key: string): number | null | undefined => {
    if (!has(key)) return undefined;
    const value = body[key];
    return value === null || value === undefined || value === "" ? null : Number(value);
  };
  const optionalText = (key: string): string | null | undefined => {
    if (!has(key)) return undefined;
    const value = body[key];
    return typeof value === "string" && value ? value : null;
  };

  const schedule = Array.isArray(body.schedule) ? (body.schedule as Array<Record<string, unknown>>) : [];
  return {
    name: typeof body.name === "string" ? body.name : "",
    courseId: optionalId("courseId"),
    modality: has("modality") ? (body.modality === "ciclica" ? "ciclica" : "modular") : undefined,
    level: optionalText("level"),
    startDate: optionalText("startDate"),
    endDate: optionalText("endDate"),
    capacity: optionalId("capacity"),
    roomId: optionalId("roomId"),
    teacherEmployeeId: optionalId("teacherEmployeeId"),
    status: has("status") ? (body.status as ClassStatus) : undefined,
    trainingId: optionalText("trainingId"),
    notes: has("notes") ? (typeof body.notes === "string" ? body.notes : null) : undefined,
    schedule: schedule.map((slot) => ({
      weekday: Number(slot.weekday),
      startTime: String(slot.startTime ?? ""),
      endTime: String(slot.endTime ?? ""),
      teacherEmployeeId:
        slot.teacherEmployeeId === null || slot.teacherEmployeeId === undefined || slot.teacherEmployeeId === ""
          ? null
          : Number(slot.teacherEmployeeId),
      roomId: slot.roomId === null || slot.roomId === undefined || slot.roomId === "" ? null : Number(slot.roomId),
    })),
    // Ausente preserva os professores atuais; lista vazia limpa (ver replaceTeachers).
    teachers: has("teachers") && Array.isArray(body.teachers)
      ? (body.teachers as Array<Record<string, unknown>>)
          .map((teacher) => ({
            employeeId: Number(teacher.employeeId),
            role: teacher.role === "auxiliar" ? ("auxiliar" as const) : ("titular" as const),
          }))
          .filter((teacher) => Number.isFinite(teacher.employeeId) && teacher.employeeId > 0)
      : undefined,
  };
}

function positiveInt(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseClassFilters(params: URLSearchParams): AcademicClassFilters {
  const status = params.get("status");
  const weekday = Number.parseInt(params.get("weekday") ?? "", 10);
  const seats = params.get("seats");
  return {
    status: status === "planejada" || status === "ativa" || status === "encerrada" ? status : undefined,
    search: params.get("search") ?? undefined,
    courseId: positiveInt(params.get("courseId")),
    teacherEmployeeId: positiveInt(params.get("teacherEmployeeId")),
    roomId: positiveInt(params.get("roomId")),
    weekday: Number.isFinite(weekday) && weekday >= 0 && weekday <= 6 ? weekday : undefined,
    seats: seats === "com_vaga" || seats === "lotada" ? seats : undefined,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;

  const classes = await listClasses(parseClassFilters(new URL(request.url).searchParams));
  return NextResponse.json({ classes });
}

export async function POST(request: Request) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = await createClass(parseClassInput(body));
    const turma = await getClassById(id);

    await recordFinanceEvent({
      entity: "turma",
      entityId: id,
      action: "create",
      label: turma?.name ?? null,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: null,
      after: turma ? (turma as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, id, class: turma });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar turma." },
      { status: 400 }
    );
  }
}
