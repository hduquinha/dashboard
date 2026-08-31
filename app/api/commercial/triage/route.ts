import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getTriageOverview } from "@/lib/triageDistribution";

export const dynamic = "force-dynamic";

/** Resumo da Triagem de Leads: quanto ainda está sem dono e a carga por vendedor. */
export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const overview = await getTriageOverview(session.user);
    return NextResponse.json({ ok: true, overview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar a triagem." },
      { status: 400 }
    );
  }
}
