import { NextResponse } from "next/server";
import {
  getAcademicRegistrationRules,
  updateAcademicRegistrationRules,
} from "@/lib/academicStudents";
import { recordFinanceEvent } from "@/lib/financeAudit";
import { requireStudentAccess } from "@/app/api/academic/students/route";
import type { AcademicRegistrationRules } from "@/types/academic";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStudentAccess(false);
  if (auth.error) return auth.error;
  return NextResponse.json({ rules: await getAcademicRegistrationRules() });
}

export async function PATCH(request: Request) {
  const auth = await requireStudentAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Partial<AcademicRegistrationRules>;
    const before = await getAcademicRegistrationRules();
    const after = await updateAcademicRegistrationRules(body);
    await recordFinanceEvent({
      entity: "configuracao_academica",
      entityId: null,
      action: "update",
      label: "Campos obrigatórios do cadastro de aluno",
      note: null,
      actorName: auth.session!.user.name,
      actorEmail: auth.session!.user.email,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      changes: [],
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, rules: after });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar regras de cadastro." },
      { status: 400 }
    );
  }
}
