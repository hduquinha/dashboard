import { NextResponse, type NextRequest } from "next/server";
import { updateInstallmentRates } from "@/lib/finance";
import { auditFinance, readInstallmentRatesState } from "@/lib/financeAudit";
import { financeError, readJsonBody, requireFinanceAccess } from "../utils";

export async function PATCH(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = await readJsonBody(request);
    const rates = Array.isArray(body.rates) ? body.rates : [];
    const parsed = rates.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        installments: Number(record.installments),
        ratePct: Number(record.ratePct),
        brandId: record.brandId === null || record.brandId === undefined ? null : Number(record.brandId),
      };
    });
    await auditFinance(
      request,
      { entity: "installment_rates", action: "update", readState: readInstallmentRatesState },
      () => updateInstallmentRates(parsed)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar taxas.");
  }
}
