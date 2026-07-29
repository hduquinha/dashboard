import { NextResponse, type NextRequest } from "next/server";
import { createEnrollment, listEnrollments, type EnrollmentInput } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseFinanceFilters, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const enrollments = await listEnrollments(parseFinanceFilters(searchParams));
  return NextResponse.json({ enrollments });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = (await readJsonBody(request)) as unknown as EnrollmentInput;
    const id = await auditFinance(request, { entity: "enrollment", action: "create" }, () =>
      createEnrollment(body)
    );
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar matricula parcelada.");
  }
}
