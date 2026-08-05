import { NextResponse, type NextRequest } from "next/server";
import { createFinanceAgendaClass, type FinanceAgendaClassInput } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, readJsonBody, requireFinanceAccess } from "../../utils";

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = await readJsonBody(request);
    const input: FinanceAgendaClassInput = {
      label: typeof body.label === "string" ? body.label : "",
      trainingId: typeof body.trainingId === "string" ? body.trainingId : null,
      product: body.product === "online" || body.product === "up-day-plus" || body.product === "curso-oratoria" ? body.product : null,
      startsAt: typeof body.startsAt === "string" ? body.startsAt : "",
      recurrence: body.recurrence === "weekly" ? "weekly" : "once",
      durationMonths: Number(body.durationMonths),
      daysPerMeeting: Number(body.daysPerMeeting),
      capacity: Number(body.capacity),
    };
    const result = await auditFinance(
      request,
      { entity: "agenda_schedule", action: "create", resolveId: (value) => (value as { scheduleId?: number })?.scheduleId ?? null },
      () => createFinanceAgendaClass(input)
    );
    return NextResponse.json(result);
  } catch (error) {
    return financeError(error, "Falha ao criar turma.");
  }
}
