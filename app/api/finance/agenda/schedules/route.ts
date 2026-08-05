import { NextResponse, type NextRequest } from "next/server";
import {
  getFinanceAgendaScheduleId,
  upsertFinanceAgendaSchedule,
  type FinanceAgendaScheduleInput,
} from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, readJsonBody, requireFinanceAccess } from "../../utils";

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = await readJsonBody(request);
    const trainingId = typeof body.trainingId === "string" ? body.trainingId : "";
    const input: FinanceAgendaScheduleInput = {
      startsAt: typeof body.startsAt === "string" ? body.startsAt : "",
      recurrence: body.recurrence === "weekly" ? "weekly" : "once",
      durationMonths: Number(body.durationMonths),
    };
    const existingId = await getFinanceAgendaScheduleId(trainingId);
    const id = await auditFinance(
      request,
      existingId
        ? { entity: "agenda_schedule", action: "update", entityId: existingId }
        : { entity: "agenda_schedule", action: "create", resolveId: (value) => Number(value) },
      () => upsertFinanceAgendaSchedule(trainingId, input)
    );
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao atualizar agenda da turma.");
  }
}
