import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { listInscricoes } from "@/lib/db";
import type { CommercialStage } from "@/types/inscricao";

export const dynamic = "force-dynamic";

const ACTIVE_STAGES: CommercialStage[] = [
  "novo",
  "primeiro_contato",
  "em_atendimento",
  "agendado",
  "fechamento",
  "no_show",
  "ganho",
  "perdido",
];

const PAGE_SIZE = 25;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const produto = searchParams.get("produto") as "vozup" | "instituto" | null;
  const assignedSellerEmail = session.user.isSupervisor
    ? (searchParams.get("assignedSellerEmail") ?? undefined)
    : session.user.email;

  const results = await Promise.all(
    ACTIVE_STAGES.map((stage) =>
      listInscricoes({
        page: 1,
        pageSize: PAGE_SIZE,
        orderBy: "status_at",
        orderDirection: "desc",
        filters: {
          commercialStage: stage,
          produto: produto ?? undefined,
          assignedSellerEmail: assignedSellerEmail || undefined,
        },
      }).then((r) => ({ stage, leads: r.data, total: r.total }))
    )
  );

  const stages = Object.fromEntries(
    results.map(({ stage, leads, total }) => [stage, { leads, total }])
  );

  return NextResponse.json({ success: true, stages });
}
