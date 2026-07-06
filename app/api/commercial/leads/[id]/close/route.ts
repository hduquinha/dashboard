import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { closeCommercialLead, type CommercialCloseReason } from "@/lib/commercial";
import { hasPermission } from "@/lib/permissions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Lead invalido.");
  }
  return parsed;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const [{ id }, cookieStore, body] = await Promise.all([
      context.params,
      cookies(),
      request.json().catch(() => ({})),
    ]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    if (!hasPermission(session.user, "crm.update_stage")) {
      return NextResponse.json({ error: "Sem permissao para fechar leads." }, { status: 403 });
    }

    await closeCommercialLead(session.user, parseId(id), {
      reason: body?.reason as CommercialCloseReason,
      courseName: typeof body?.courseName === "string" ? body.courseName : null,
      value: typeof body?.value === "number" ? body.value : null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao fechar o lead." },
      { status: 400 }
    );
  }
}
