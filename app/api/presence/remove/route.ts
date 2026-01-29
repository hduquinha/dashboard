import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

interface RequestBody {
  inscricaoId: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { inscricaoId } = body;

    if (!inscricaoId) {
      return NextResponse.json(
        { error: "ID da inscrição não informado." },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Remove todos os campos de presença do payload
    const keysToRemove = [
      'presenca_validada',
      'presenca_aprovada',
      'presenca_participante_nome',
      'presenca_tempo_total_minutos',
      'presenca_tempo_dinamica_minutos',
      'presenca_percentual_dinamica',
      'presenca_treinamento_id',
      'presenca_validada_em',
    ];

    // Constrói a query para remover as chaves do JSONB
    const removeKeysQuery = keysToRemove.map(key => `'${key}'`).join(', ');

    const result = await pool.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes 
       SET payload = payload - ARRAY[${removeKeysQuery}]::text[]
       WHERE id = $1
       RETURNING id, payload->>'nome' AS nome`,
      [inscricaoId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Inscrição não encontrada." },
        { status: 404 }
      );
    }

    const nome = result.rows[0]?.nome ?? `ID ${inscricaoId}`;

    return NextResponse.json({
      success: true,
      message: `Presença de "${nome}" foi desassociada com sucesso.`,
      inscricaoId,
    });
  } catch (error) {
    console.error("Erro ao remover presença:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : "Erro ao remover presença.",
      },
      { status: 500 }
    );
  }
}
