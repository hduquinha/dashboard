import { NextResponse, type NextRequest } from "next/server";
import { listFinanceAgendaParticipants } from "@/lib/finance";
import { financeError, requireFinanceAccess } from "../../../utils";

interface RouteContext {
  params: Promise<{ trainingId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { trainingId } = await context.params;
    const participants = await listFinanceAgendaParticipants(trainingId);
    return NextResponse.json({ participants });
  } catch (error) {
    return financeError(error, "Falha ao carregar pessoas da turma.");
  }
}
