import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import {
  createKanbanFilter,
  listKanbanFiltersForUser,
  normalizeKanbanFilterCriteria,
} from "@/lib/kanbanFilters";
import { isProductivityManager } from "@/lib/productivity";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const filters = await listKanbanFiltersForUser(session.user);
  return NextResponse.json({ filters, isAdmin: isProductivityManager(session.user) });
}

export async function POST(request: Request) {
  try {
    const [cookieStore, body] = await Promise.all([cookies(), request.json().catch(() => ({}))]);
    const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const filter = await createKanbanFilter(session.user, {
      name: typeof body?.name === "string" ? body.name : "",
      criteria: normalizeKanbanFilterCriteria(body?.criteria),
      sellerEmails: Array.isArray(body?.sellerEmails) ? body.sellerEmails : [],
    });
    return NextResponse.json({ filter });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar filtro." },
      { status: 400 }
    );
  }
}
