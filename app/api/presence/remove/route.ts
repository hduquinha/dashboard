import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

interface RequestBody {
  inscricaoId?: number;
  inscricaoIds?: number[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { inscricaoId, inscricaoIds } = body;

    // Aceita tanto um ID único quanto um array de IDs
    const ids: number[] = inscricaoIds ?? (inscricaoId ? [inscricaoId] : []);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "ID(s) da inscrição não informado(s)." },
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

    // Usa ANY para aceitar múltiplos IDs
    const result = await pool.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes 
       SET payload = payload - ARRAY[${removeKeysQuery}]::text[]
       WHERE id = ANY($1::int[])
       RETURNING id, payload->>'nome' AS nome`,
      [ids]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Nenhuma inscrição encontrada." },
        { status: 404 }
      );
    }

    const removedCount = result.rowCount ?? 0;
    const nomes = result.rows.map((r: { id: number; nome: string | null }) => r.nome ?? `ID ${r.id}`);

    return NextResponse.json({
      success: true,
      message: removedCount === 1
        ? `Presença de "${nomes[0]}" foi desassociada com sucesso.`
        : `${removedCount} presenças foram desassociadas com sucesso.`,
      removedCount,
      removedIds: ids,
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
