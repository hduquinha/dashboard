import { NextResponse, type NextRequest } from "next/server";
import { updateBoletoFee, updateInitialBalance } from "@/lib/finance";
import { financeError, readJsonBody, requireFinanceAccess } from "../utils";

export async function PATCH(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const body = await readJsonBody(request);
    if (body.initialBalance !== undefined) {
      await updateInitialBalance(Number(body.initialBalance ?? 0));
    }
    if (body.boletoFee !== undefined) {
      await updateBoletoFee(Number(body.boletoFee ?? 0));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar configurações.");
  }
}
