import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { registerScheduleOutcome } from "@/lib/scheduleOutcome";
import { isScheduleOutcome } from "@/lib/scheduleStage";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

export const dynamic = "force-dynamic";

function parseId(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} inválido.`);
  return parsed;
}

/**
 * Registra o que aconteceu no compromisso agendado: conclui a tarefa vencida e
 * move o lead conforme o resultado. A criação da tarefa nova do "remarcou" fica
 * com o client, que reaproveita `POST /api/leads/[id]/tasks` — mesma validação
 * de quadro e mesmo dono automático, sem duplicar regra aqui.
 */
export async function POST(request: Request, context: RouteContext) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "view.tasks")) {
    return NextResponse.json({ error: "Sem permissão para tarefas." }, { status: 403 });
  }

  try {
    const [{ id, taskId }, body] = await Promise.all([
      context.params,
      request.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    ]);

    const outcome = body.outcome;
    if (!isScheduleOutcome(outcome)) {
      throw new Error("Escolha o que aconteceu no compromisso.");
    }

    const result = await registerScheduleOutcome(
      session.user,
      parseId(id, "Lead"),
      parseId(taskId, "Tarefa"),
      outcome
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar o resultado." },
      { status: 400 }
    );
  }
}
