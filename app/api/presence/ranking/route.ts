import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { buildPresenceRanking, listPresenceRecords } from "@/lib/presenceRecords";

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const treinamentoId = request.nextUrl.searchParams.get("treinamento");
    if (!treinamentoId) {
      return NextResponse.json(
        { error: "Parametro 'treinamento' e obrigatorio." },
        { status: 400 }
      );
    }

    const { presences } = await listPresenceRecords({
      treinamentoId,
      apenasAprovados: false,
    });
    const ranking = buildPresenceRanking(presences);

    return NextResponse.json({
      success: true,
      total: ranking.ranking.length,
      ...ranking,
    });
  } catch (error) {
    console.error("Erro ao gerar ranking:", error);
    return NextResponse.json(
      { error: "Falha ao gerar ranking de presenca." },
      { status: 500 }
    );
  }
}
