import { NextResponse, type NextRequest } from "next/server";
import { requireCampaignsAccess } from "../utils";
import { getLeadYieldData } from "@/lib/leadYield";
import type { LeadYieldBasis } from "@/lib/leadYieldAnalysis";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return NextResponse.json({ error: "Periodo invalido." }, { status: 400 });
  }

  const basisRaw = searchParams.get("base");
  const basis: LeadYieldBasis = basisRaw === "movimentacao" ? "movimentacao" : "chegada";

  try {
    const data = await getLeadYieldData({ from, to, basis });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao calcular o rendimento dos leads." },
      { status: 500 }
    );
  }
}
