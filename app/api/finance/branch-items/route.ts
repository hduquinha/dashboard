import { NextResponse, type NextRequest } from "next/server";
import { createBranchItem, listBranchItems, type BranchItemInput } from "@/lib/finance";
import { financeError, readJsonBody, requireFinanceAccess } from "../utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const branchIdRaw = searchParams.get("branchId");
  const branchId = branchIdRaw ? Number.parseInt(branchIdRaw, 10) : undefined;
  const branchItems = await listBranchItems(Number.isFinite(branchId) ? branchId : undefined);
  return NextResponse.json({ branchItems });
}

export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const id = await createBranchItem((await readJsonBody(request)) as unknown as BranchItemInput);
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar item da filial.");
  }
}
