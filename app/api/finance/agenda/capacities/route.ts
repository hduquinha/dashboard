import { NextResponse, type NextRequest } from "next/server";
import { getFinanceAgendaCapacityId, upsertFinanceAgendaCapacity } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, readJsonBody, requireFinanceAccess } from "../../utils";

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = await readJsonBody(request);
    const trainingId = typeof body.trainingId === "string" ? body.trainingId : "";
    const capacity = Number(body.capacity);
    const existingId = await getFinanceAgendaCapacityId(trainingId);
    const id = await auditFinance(
      request,
      existingId
        ? { entity: "agenda_capacity", action: "update", entityId: existingId }
        : { entity: "agenda_capacity", action: "create", resolveId: (value) => Number(value) },
      () => upsertFinanceAgendaCapacity(trainingId, capacity)
    );
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao atualizar capacidade da turma.");
  }
}
