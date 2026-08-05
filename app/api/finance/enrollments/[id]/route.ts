import { NextResponse, type NextRequest } from "next/server";
import { deleteEnrollment, getEnrollmentById, listEnrollmentRevenues, updateEnrollment, type EnrollmentInput } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const enrollmentId = parseId(id);
    const [enrollment, revenues] = await Promise.all([
      getEnrollmentById(enrollmentId),
      listEnrollmentRevenues(enrollmentId),
    ]);
    if (!enrollment) return NextResponse.json({ error: "Matrícula não encontrada." }, { status: 404 });
    return NextResponse.json({ enrollment, revenues });
  } catch (error) {
    return financeError(error, "Falha ao carregar matrícula.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const entityId = parseId(id);
    await auditFinance(request, { entity: "enrollment", action: "update", entityId }, () =>
      updateEnrollment(entityId, body as unknown as EnrollmentInput)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar matricula.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const entityId = parseId(id);
    await auditFinance(request, { entity: "enrollment", action: "delete", entityId }, () =>
      deleteEnrollment(entityId)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir matricula.");
  }
}
