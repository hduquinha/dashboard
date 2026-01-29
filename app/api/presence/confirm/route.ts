import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

interface AssociationPayload {
  inscricaoId: number;
  participanteNome: string;
  aprovado: boolean;
  tempoTotal: number;
  tempoDinamica: number;
  percentualDinamica: number;
}

interface RequestBody {
  associations: AssociationPayload[];
  treinamentoId: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { associations, treinamentoId } = body;

    if (!associations || !Array.isArray(associations)) {
      return NextResponse.json(
        { error: "Dados de associações inválidos." },
        { status: 400 }
      );
    }

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "Treinamento não informado." },
        { status: 400 }
      );
    }

    const pool = getPool();
    let savedCount = 0;
    const errors: string[] = [];

    for (const assoc of associations) {
      if (!assoc.inscricaoId) continue;

      try {
        // Dados de presença a serem salvos no payload
        const presenceData = {
          presenca_validada: true,
          presenca_aprovada: assoc.aprovado,
          presenca_participante_nome: assoc.participanteNome,
          presenca_tempo_total_minutos: assoc.tempoTotal,
          presenca_tempo_dinamica_minutos: assoc.tempoDinamica,
          presenca_percentual_dinamica: assoc.percentualDinamica,
          presenca_treinamento_id: treinamentoId,
          presenca_validada_em: new Date().toISOString(),
        };

        await pool.query(
          `UPDATE ${SCHEMA_NAME}.inscricoes 
           SET payload = payload || $1::jsonb 
           WHERE id = $2`,
          [JSON.stringify(presenceData), assoc.inscricaoId]
        );

        savedCount++;
      } catch (err) {
        console.error(`Erro ao salvar associação para inscrição ${assoc.inscricaoId}:`, err);
        errors.push(`Inscrição ${assoc.inscricaoId}: ${err instanceof Error ? err.message : "erro desconhecido"}`);
      }
    }

    if (errors.length > 0 && savedCount === 0) {
      return NextResponse.json(
        { 
          success: false, 
          message: `Falha ao salvar. Erros: ${errors.join("; ")}`,
          savedCount: 0,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: errors.length > 0 
        ? `${savedCount} associações salvas. ${errors.length} erro(s): ${errors.join("; ")}`
        : `${savedCount} associações salvas com sucesso.`,
      savedCount,
      errors,
    });
  } catch (error) {
    console.error("Erro ao salvar associações:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : "Erro ao salvar.",
        savedCount: 0,
      },
      { status: 500 }
    );
  }
}
