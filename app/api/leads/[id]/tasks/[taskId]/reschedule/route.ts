import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rescheduleLeadTask } from "@/lib/scheduleOutcome";
import { isRescheduleReason } from "@/lib/scheduleStage";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseId(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} inválido.`);
  return parsed;
}

/**
 * Nova data/hora de um compromisso já marcado, com o motivo obrigatório.
 *
 * Existe separado do PATCH genérico de tarefa porque aqui o motivo não é
 * opcional: é ele que separa "o cliente empurrou a conversa" de "eu digitei a
 * data errada" na linha do tempo do lead.
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

    const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    if (!DATE_PATTERN.test(dueDate)) {
      throw new Error("Informe a nova data do compromisso.");
    }
    const rawTime = typeof body.dueTime === "string" ? body.dueTime.trim() : "";
    if (rawTime && !TIME_PATTERN.test(rawTime)) {
      throw new Error("Horário inválido — use HH:MM.");
    }
    if (!isRescheduleReason(body.reason)) {
      throw new Error("Diga por que a data mudou.");
    }

    const result = await rescheduleLeadTask(
      session.user,
      parseId(id, "Lead"),
      parseId(taskId, "Tarefa"),
      {
        dueDate,
        dueTime: rawTime || null,
        reason: body.reason,
        note: typeof body.note === "string" ? body.note : null,
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remarcar o compromisso." },
      { status: 400 }
    );
  }
}
