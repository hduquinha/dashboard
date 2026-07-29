import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { assignCommercialLead, setCommercialStage } from "@/lib/commercial";
import { hasPermission } from "@/lib/permissions";

function parseIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("Selecione ao menos um lead.");
  const ids = [...new Set(value.map((id) => Number.parseInt(String(id), 10)))]
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) throw new Error("Selecione ao menos um lead.");
  if (ids.length > 200) throw new Error("Selecione no máximo 200 leads por vez.");
  return ids;
}

/** Atualização em massa do Kanban: todos os alvos passam pelas mesmas regras
 * de permissão, funil e histórico usadas ao mover/atribuir um card isolado. */
export async function PATCH(request: Request) {
  try {
    const [cookieStore, body] = await Promise.all([cookies(), request.json().catch(() => ({}))]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

    const ids = parseIds(body?.ids);
    if (typeof body?.stage === "string" && body.stage.trim()) {
      if (!hasPermission(session.user, "crm.update_stage")) {
        return NextResponse.json({ error: "Sem permissao para mover etapas." }, { status: 403 });
      }
      for (const id of ids) await setCommercialStage(session.user, id, body.stage);
      return NextResponse.json({ ok: true, updated: ids.length });
    }

    const sellerId = Number.parseInt(String(body?.sellerId), 10);
    if (!Number.isFinite(sellerId) || sellerId < 1) throw new Error("Vendedor invalido.");
    if (!hasPermission(session.user, "crm.assign_leads")) {
      return NextResponse.json({ error: "Sem permissao para atribuir vendedores." }, { status: 403 });
    }
    for (const id of ids) await assignCommercialLead(session.user, id, sellerId);
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar os leads." },
      { status: 400 }
    );
  }
}
