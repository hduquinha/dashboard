import { NextResponse, type NextRequest } from "next/server";
import { deleteFinanceAgendaClass, getFinanceAgendaScheduleId } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, requireFinanceAccess } from "../../../utils";

interface RouteContext {
  params: Promise<{ trainingId: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { trainingId } = await context.params;
    const scheduleId = await getFinanceAgendaScheduleId(trainingId);
    if (!scheduleId) throw new Error("Turma não encontrada.");
    await auditFinance(
      request,
      { entity: "agenda_schedule", action: "delete", entityId: scheduleId },
      () => deleteFinanceAgendaClass(trainingId)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir turma.");
  }
}
