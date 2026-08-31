import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { logLeadTimelineEvent } from "@/lib/commercial";
import {
  createStudent,
  createStudentFromLead,
  getStudentById,
  getRosterSummary,
  listUnlinkedAcademicEnrollments,
  listStudents,
  requiresGuardian,
} from "@/lib/academicStudents";
import type { AcademicStudentFilters, AcademicStudentInput, StudentStatus } from "@/types/academic";

export const dynamic = "force-dynamic";

/** Ver a ficha é uma coisa; criar/editar aluno é outra — mesmo par de view/manage
 *  usado em cupons e catálogo. */
export async function requireStudentAccess(edit: boolean) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), session: null };
  }
  const permission = edit ? "students.manage" : "view.students";
  if (!hasPermission(session.user, permission)) {
    return {
      error: NextResponse.json(
        { error: edit ? "Sem permissao para cadastrar alunos." : "Sem permissao para ver alunos." },
        { status: 403 }
      ),
      session: null,
    };
  }
  return { error: null, session };
}

function parseFilters(params: URLSearchParams): AcademicStudentFilters {
  const status = params.get("status");
  const flag = params.get("flag");
  const classId = Number.parseInt(params.get("classId") ?? "", 10);
  return {
    search: params.get("search") ?? undefined,
    status:
      status === "ativo" || status === "inativo" || status === "trancado" || status === "concluido"
        ? (status as StudentStatus)
        : undefined,
    classId: Number.isFinite(classId) && classId > 0 ? classId : undefined,
    flag: flag === "sem_turma" || flag === "sem_lead" || flag === "menor_sem_responsavel" ? flag : undefined,
  };
}

export function parseStudentInput(body: Record<string, unknown>): AcademicStudentInput {
  const guardian = body.guardian as Record<string, unknown> | null | undefined;
  return {
    fullName: typeof body.fullName === "string" ? body.fullName : "",
    cpf: typeof body.cpf === "string" ? body.cpf : null,
    birthDate: typeof body.birthDate === "string" && body.birthDate ? body.birthDate : null,
    email: typeof body.email === "string" ? body.email : null,
    phone: typeof body.phone === "string" ? body.phone : null,
    city: typeof body.city === "string" ? body.city : null,
    status: body.status as StudentStatus | undefined,
    guardianId:
      body.guardianId === null || body.guardianId === undefined || body.guardianId === ""
        ? null
        : Number(body.guardianId),
    guardian:
      guardian && typeof guardian.fullName === "string" && guardian.fullName.trim()
        ? {
            fullName: guardian.fullName,
            cpf: typeof guardian.cpf === "string" ? guardian.cpf : null,
            email: typeof guardian.email === "string" ? guardian.email : null,
            phone: typeof guardian.phone === "string" ? guardian.phone : null,
            relationship: typeof guardian.relationship === "string" ? guardian.relationship : null,
            birthDate: typeof guardian.birthDate === "string" && guardian.birthDate ? guardian.birthDate : null,
          }
        : null,
    // O vínculo com lead só pode nascer pelo `fromLeadId` tratado no POST, que
    // verifica se o lead existe e herda os dados dele. Aceitar um id cru aqui
    // permitiria criar uma relação histórica sem validação.
    leadInscricaoId: null,
    notes: typeof body.notes === "string" ? body.notes : null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireStudentAccess(false);
  if (auth.error) return auth.error;

  const [students, roster, unlinkedEnrollments] = await Promise.all([
    listStudents(parseFilters(new URL(request.url).searchParams)),
    getRosterSummary(),
    listUnlinkedAcademicEnrollments(),
  ]);
  return NextResponse.json({ students, roster, unlinkedEnrollments });
}

export async function POST(request: Request) {
  const auth = await requireStudentAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = { id: auth.session!.user.id, name: auth.session!.user.name };
    const financeEnrollmentId = Number.parseInt(String(body.financeEnrollmentId ?? ""), 10);
    const enrollmentId = Number.isFinite(financeEnrollmentId) && financeEnrollmentId > 0
      ? financeEnrollmentId
      : null;

    // Conversão a partir do lead: herda nome/contato/CPF do payload e grava o
    // vínculo. É o caminho preferido — aluno com lead de origem e sem o vínculo
    // gravado é o que a Fase 1 existe para impedir.
    const leadId = Number.parseInt(String(body.fromLeadId ?? ""), 10);
    const id =
      Number.isFinite(leadId) && leadId > 0
        ? await createStudentFromLead(leadId, actor, parseStudentInput(body), enrollmentId)
        : await createStudent(parseStudentInput(body), actor, enrollmentId);

    const student = await getStudentById(id);
    await recordFinanceEvent({
      entity: "aluno",
      entityId: id,
      action: "create",
      label: student?.fullName ?? null,
      note: student?.leadInscricaoId ? `Convertido do lead #${student.leadInscricaoId}` : null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: null,
      after: student ? (student as unknown as Record<string, unknown>) : null,
      changes: [],
    }).catch(() => undefined);

    if (student?.leadInscricaoId) {
      await logLeadTimelineEvent(auth.session!.user, student.leadInscricaoId, "student_created", {
        studentId: student.id,
        studentName: student.fullName,
      }).catch(() => undefined);
    }

    return NextResponse.json({
      ok: true,
      id,
      student,
      // Não bloqueia o cadastro: a secretaria pode não ter o responsável na hora.
      // O aviso viaja para a tela mostrar o pendente em vez de esconder.
      warning:
        student && requiresGuardian(student.birthDate) && !student.guardianId
          ? "Aluno menor de idade sem responsável legal cadastrado — o contrato precisa do CPF do responsável."
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao cadastrar aluno." },
      { status: 400 }
    );
  }
}
