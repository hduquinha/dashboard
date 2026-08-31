import { NextResponse, type NextRequest } from "next/server";
import {
  createEnrollment,
  listEnrollmentPaymentHealth,
  listEnrollments,
  listPendingInvoiceEnrollments,
  type EnrollmentInput,
} from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import { financeError, parseFinanceFilters, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  // Fila de NF e situação de pagamento vêm só quando pedidas: as duas ignoram o
  // filtro de período e custam uma consulta a mais que a maioria das telas não usa.
  const [enrollments, pendingInvoices, health] = await Promise.all([
    listEnrollments(parseFinanceFilters(searchParams)),
    searchParams.get("pendingInvoices") === "1" ? listPendingInvoiceEnrollments() : Promise.resolve(null),
    searchParams.get("health") === "1" ? listEnrollmentPaymentHealth() : Promise.resolve(null),
  ]);
  return NextResponse.json({
    enrollments,
    ...(pendingInvoices ? { pendingInvoices } : {}),
    ...(health ? { health } : {}),
  });
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
