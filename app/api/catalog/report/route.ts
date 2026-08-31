import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSalesOriginReport } from "@/lib/salesReport";
import { listTrainingCatalog } from "@/lib/trainingCatalog";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "view.catalog")) {
    return NextResponse.json({ error: "Sem permissao para ver o catalogo." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return NextResponse.json({ error: "Periodo invalido." }, { status: 400 });
  }

  const [report, trainings] = await Promise.all([getSalesOriginReport(from, to), listTrainingCatalog()]);
  return NextResponse.json({ report, trainings });
}
