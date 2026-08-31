import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { resolveLeadCampaign } from "@/lib/leadCampaignLink";

export const dynamic = "force-dynamic";

/**
 * Qual campanha da Meta trouxe este lead — para o botão "ver na Métricas de
 * Campanha" na ficha. Resolvido no servidor porque o payload do lead quase
 * nunca tem o id da campanha: em 30 dias, 79 leads tinham o id e 302 só o
 * NOME (vindo de UTM). Achar o id a partir do nome exige a tabela de campanhas
 * e o histórico de renomeação, que só existem aqui.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const leadId = Number.parseInt((await context.params).id, 10);
  if (!Number.isFinite(leadId) || leadId < 1) {
    return NextResponse.json({ error: "Lead invalido" }, { status: 400 });
  }

  try {
    const campaign = await resolveLeadCampaign(leadId);
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("[lead-campaign] falha ao resolver campanha do lead", leadId, error);
    return NextResponse.json({ campaign: null });
  }
}
