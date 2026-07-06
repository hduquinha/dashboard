import { NextResponse, type NextRequest } from "next/server";
import { updateInstallmentRates } from "@/lib/finance";
import { financeError, readJsonBody, requireFinanceAccess } from "../utils";

export async function PATCH(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = await readJsonBody(request);
    const rates = Array.isArray(body.rates) ? body.rates : [];
    await updateInstallmentRates(
      rates.map((item) => ({
        installments: Number((item as Record<string, unknown>).installments),
        ratePct: Number((item as Record<string, unknown>).ratePct),
      }))
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar taxas.");
  }
}
