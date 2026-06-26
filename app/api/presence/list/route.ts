import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { listPresenceRecords } from "@/lib/presenceRecords";

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const treinamentoId = searchParams.get("treinamento");
    const apenasAprovados = searchParams.get("aprovados") !== "false";
    const result = await listPresenceRecords({ treinamentoId, apenasAprovados });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Erro ao listar presencas:", error);
    return NextResponse.json(
      { error: "Falha ao carregar presencas confirmadas." },
      { status: 500 }
    );
  }
}
