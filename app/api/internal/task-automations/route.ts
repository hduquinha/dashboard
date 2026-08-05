import { type NextRequest, NextResponse } from "next/server";
import { assertAuthorizationHeader } from "@/lib/auth";
import { runScheduledAutomations } from "@/lib/taskAutomations";

export const dynamic = "force-dynamic";

/**
 * Ciclo periódico das Tarefas: comandos agendados (ex.: "toda segunda, criar o
 * card da sprint") e gatilhos de prazo (vence hoje / venceu), incluindo o aviso
 * para os responsáveis. Acionado pelo loop de loopback do `server.js`, mesmo
 * padrão do merge-sweep e do stale-lead-alert.
 */
export async function POST(request: NextRequest) {
  try {
    assertAuthorizationHeader(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.TASK_AUTOMATIONS_ENABLED === "false") {
    return NextResponse.json({ ok: true, disabled: true });
  }

  try {
    const result = await runScheduledAutomations();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[task-automations] falha no ciclo", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Erro no ciclo de automacoes" },
      { status: 500 }
    );
  }
}
