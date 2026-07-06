import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import {
  deleteKanbanFilter,
  normalizeKanbanFilterCriteria,
  updateKanbanFilter,
} from "@/lib/kanbanFilters";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Filtro invalido.");
  }
  return parsed;
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

    const filter = await updateKanbanFilter(session.user, parseId(id), {
      name: typeof body?.name === "string" ? body.name : "",
      criteria: normalizeKanbanFilterCriteria(body?.criteria),
      sellerEmails: Array.isArray(body?.sellerEmails) ? body.sellerEmails : [],
    });
    return NextResponse.json({ filter });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar filtro." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const [{ id }, cookieStore] = await Promise.all([context.params, cookies()]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    await deleteKanbanFilter(session.user, parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir filtro." },
      { status: 400 }
    );
  }
}
