import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { adjustContactAttempts } from "@/lib/commercial";
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

function parseDelta(value: unknown): number {
  if (value !== 1 && value !== -1) {
    throw new Error("Delta invalido — use 1 ou -1.");
  }
  return value;
}

export async function PATCH(request: Request, context: RouteContext) {
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
    if (!hasPermission(session.user, "crm.edit_leads")) {
      return NextResponse.json({ error: "Sem permissao para editar o lead." }, { status: 403 });
    }
    const contactAttempts = await adjustContactAttempts(parseId(id), parseDelta(body?.delta));
    return NextResponse.json({ contactAttempts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar tentativas." },
      { status: 400 }
    );
  }
}
