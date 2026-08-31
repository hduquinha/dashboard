import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { deleteStudent, getStudentById, requiresGuardian, updateStudent } from "@/lib/academicStudents";
import { parseStudentInput, requireStudentAccess } from "../route";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Aluno invalido.");
  return parsed;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireStudentAccess(false);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const student = await getStudentById(parseId(id));
  if (!student) return NextResponse.json({ error: "Aluno nao encontrado." }, { status: 404 });
  return NextResponse.json({ student });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireStudentAccess(true);
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const studentId = parseId(id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Antes/depois por campo, no mesmo padrão (e na mesma tabela) da auditoria
    // financeira — uma trilha só para o ERP em vez de duas quase iguais.
    const before = await getStudentById(studentId);
    await updateStudent(studentId, parseStudentInput(body));
    const after = await getStudentById(studentId);

    await recordFinanceEvent({
      entity: "aluno",
      entityId: studentId,
      action: "update",
      label: after?.fullName ?? before?.fullName ?? null,
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: after ? (after as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      student: after,
      warning:
        after && requiresGuardian(after.birthDate) && !after.guardianId
          ? "Aluno menor de idade sem responsável legal cadastrado — o contrato precisa do CPF do responsável."
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar aluno." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "students.delete")) {
    return NextResponse.json({ error: "Sem permissao para excluir alunos." }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const studentId = parseId(id);
    const before = await getStudentById(studentId);
    await deleteStudent(studentId);

    await recordFinanceEvent({
      entity: "aluno",
      entityId: studentId,
      action: "delete",
      label: before?.fullName ?? null,
      note: null,
      actorName: session.user.name,
      actorEmail: session.user.email,
      before: before ? (before as unknown as Record<string, unknown>) : null,
      after: null,
      changes: [],
    }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir aluno." },
      { status: 400 }
    );
  }
}
