import { NextResponse } from "next/server";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { hasPermission } from "@/lib/permissions";
import {
  addStudentToClass,
  listClassPendingSeats,
  listClassRoster,
  removeStudentFromClass,
  setClassStudentStatus,
  transferStudentBetweenClasses,
  updateClassStudentDates,
} from "@/lib/academicClasses";
import { requireClassAccess } from "../../route";
import type { ClassStudentStatus } from "@/types/academic";
import type { DashboardSession } from "@/lib/auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string | number | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Identificador invalido.");
  return parsed;
}

/** Mesma regra do GET da turma: dinheiro só viaja para quem pode ver dinheiro. */
async function rosterFor(classId: number, session: DashboardSession) {
  return listClassRoster(classId, { includeFinance: hasPermission(session.user, "view.finance") });
}

/**
 * Quem comprou esta turma e ainda não está no diário dela.
 *
 * Rota separada do GET da turma para não custar uma consulta a mais em toda
 * abertura de tela: a lista só interessa a quem está olhando a chamada.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireClassAccess(false);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    return NextResponse.json({ pending: await listClassPendingSeats(parseId(id)) });
  } catch {
    // Pendência é diagnóstico: falhar aqui não pode derrubar a tela da turma.
    return NextResponse.json({ pending: [] });
  }
}

/** Alocar aluno na turma — a ação que tira o aluno de "aguardando alocação". */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const classId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const studentId = parseId(body.studentId as number);
    await addStudentToClass({
      classId,
      studentId,
      startDate: typeof body.startDate === "string" && body.startDate ? body.startDate : null,
      financeEnrollmentId:
        body.financeEnrollmentId === null || body.financeEnrollmentId === undefined || body.financeEnrollmentId === ""
          ? null
          : Number(body.financeEnrollmentId),
    });

    const roster = await rosterFor(classId, auth.session!);
    const after = roster.find((item) => item.studentId === studentId) ?? null;
    await recordFinanceEvent({
      entity: "turma_aluno",
      entityId: after?.linkId ?? null,
      action: "create",
      label: after?.studentName ?? `Aluno #${studentId}`,
      note: `Turma #${classId}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, roster });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao alocar aluno." },
      { status: 400 }
    );
  }
}

/** Trocar o status do vínculo (trancar, cancelar, concluir) sem apagar o histórico. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const classId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const linkId = parseId(body.linkId as number);
    const before = (await rosterFor(classId, auth.session!)).find((item) => item.linkId === linkId) ?? null;
    if (typeof body.status === "string" && body.status) {
      await setClassStudentStatus(classId, linkId, body.status as ClassStudentStatus);
    }
    if ("startDate" in body || "endDate" in body) {
      await updateClassStudentDates(classId, linkId, {
        startDate: typeof body.startDate === "string" && body.startDate ? body.startDate : null,
        endDate: typeof body.endDate === "string" && body.endDate ? body.endDate : null,
      });
    }
    const roster = await rosterFor(classId, auth.session!);
    const after = roster.find((item) => item.linkId === linkId) ?? null;
    await recordFinanceEvent({
      entity: "turma_aluno",
      entityId: linkId,
      action: "update",
      label: after?.studentName ?? before?.studentName ?? `Vínculo #${linkId}`,
      note: `Turma #${classId}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, roster });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar o vinculo." },
      { status: 400 }
    );
  }
}

/**
 * Transferir o aluno para outra turma preservando o vínculo antigo como histórico.
 *
 * Método próprio (e não um PATCH de `class_id`) porque a operação toca DUAS turmas:
 * a origem, que passa a ter uma linha encerrada, e o destino, que precisa ter vaga.
 * Um PATCH sugeriria que só a linha do aluno muda.
 */
export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const fromClassId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const linkId = parseId(body.linkId as number);
    const toClassId = parseId(body.toClassId as number);

    const result = await transferStudentBetweenClasses({
      fromClassId,
      linkId,
      toClassId,
      previousStatus: body.previousStatus === "concluida" ? "concluida" : "cancelada",
      startDate: typeof body.startDate === "string" && body.startDate ? body.startDate : null,
    });

    await recordFinanceEvent({
      entity: "turma_aluno",
      entityId: linkId,
      action: "update",
      label: result.studentName,
      note: `Turma #${fromClassId}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: { classId: fromClassId } as Record<string, unknown>,
      after: { classId: toClassId, className: result.toClassName } as Record<string, unknown>,
      changes: [],
    }).catch(() => undefined);
    // Um evento em cada turma: quem abre a linha do tempo do destino precisa ver de
    // onde o aluno veio sem ter de adivinhar a turma de origem.
    await recordFinanceEvent({
      entity: "turma_aluno",
      entityId: linkId,
      action: "create",
      label: result.studentName,
      note: `Turma #${toClassId}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: null,
      after: { transferidoDaTurma: fromClassId } as Record<string, unknown>,
      changes: [],
    }).catch(() => undefined);

    const roster = await rosterFor(fromClassId, auth.session!);
    return NextResponse.json({ ok: true, roster, transfer: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao transferir o aluno." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const classId = parseId(id);
    const linkId = Number.parseInt(new URL(request.url).searchParams.get("linkId") ?? "", 10);
    const parsedLinkId = parseId(linkId);
    const before = (await rosterFor(classId, auth.session!)).find((item) => item.linkId === parsedLinkId) ?? null;
    await removeStudentFromClass(classId, parsedLinkId);
    const roster = await rosterFor(classId, auth.session!);
    await recordFinanceEvent({
      entity: "turma_aluno",
      entityId: parsedLinkId,
      action: "delete",
      label: before?.studentName ?? `Vínculo #${parsedLinkId}`,
      note: `Turma #${classId}`,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: null,
      changes: [],
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, roster });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover o aluno da turma." },
      { status: 400 }
    );
  }
}
