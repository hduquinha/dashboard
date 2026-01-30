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

    // Primeiro, busca os dados de presença das inscrições para salvar como pendentes
    const presenceDataResult = await pool.query(
      `SELECT 
        id,
        payload->>'presenca_participante_nome' AS participante_nome,
        payload->>'presenca_treinamento_id' AS treinamento_id,
        COALESCE((payload->>'presenca_aprovada')::boolean, false) AS aprovado,
        COALESCE((payload->>'presenca_tempo_total_minutos')::integer, 0) AS tempo_total,
        COALESCE((payload->>'presenca_tempo_dinamica_minutos')::integer, 0) AS tempo_dinamica,
        COALESCE((payload->>'presenca_percentual_dinamica')::integer, 0) AS percentual
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE id = ANY($1::int[])
        AND payload->>'presenca_validada' = 'true'
        AND payload->>'presenca_participante_nome' IS NOT NULL`,
      [ids]
    );

    // Insere na tabela de pendentes como "not-found" para cada presença que será removida
    for (const row of presenceDataResult.rows) {
      if (row.participante_nome && row.treinamento_id) {
        await pool.query(
          `INSERT INTO ${SCHEMA_NAME}.presencas_pendentes 
           (participante_nome, treinamento_id, aprovado, tempo_total_minutos, tempo_dinamica_minutos, percentual_dinamica, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'not-found')
           ON CONFLICT (participante_nome, treinamento_id) DO NOTHING`,
          [
            row.participante_nome,
            row.treinamento_id,
            row.aprovado,
            row.tempo_total,
            row.tempo_dinamica,
            row.percentual,
          ]
        );
      }
    }

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
    const pendingCount = presenceDataResult.rowCount ?? 0;

    return NextResponse.json({
      success: true,
      message: removedCount === 1
        ? `Presença de "${nomes[0]}" foi desassociada e movida para pendentes.`
        : `${removedCount} presenças foram desassociadas e movidas para pendentes.`,
      removedCount,
      removedIds: ids,
      pendingCount,
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
