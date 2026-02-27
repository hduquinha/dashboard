import { NextRequest, NextResponse } from "next/server";
import { getPool, loadRecruiterCache, getRecruiterFromCache } from "@/lib/db";
import { getRecruiterByCodeIfNamed } from "@/lib/recruiters";

const SCHEMA_NAME = "inscricoes";

/**
 * GET /api/presence/ranking?treinamento=...
 *
 * Returns individual presence records ranked by dinâmica time (primary)
 * and total time (secondary). Each record is one person.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const treinamentoId = searchParams.get("treinamento");

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "Parâmetro 'treinamento' é obrigatório." },
        { status: 400 }
      );
    }

    const pool = getPool();

    const treinamentoExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'treinamento'), ''),
      NULLIF(TRIM(payload->>'training'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), ''),
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'training_id'), ''),
      NULLIF(TRIM(payload->>'trainingId'), ''),
      NULLIF(TRIM(payload->>'treinamento_id'), ''),
      NULLIF(TRIM(payload->>'training_option'), ''),
      NULLIF(TRIM(payload->>'trainingOption'), ''),
      'Sem Treinamento'
    ))`;

    const recrutadorExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'traffic_source'), ''),
      NULLIF(TRIM(payload->>'source'), ''),
      NULLIF(TRIM(payload->>'recrutador'), ''),
      NULLIF(TRIM(payload->>'recrutador_codigo'), ''),
      NULLIF(TRIM(payload->>'recruiter_code'), '')
    ))`;

    const query = `
      SELECT
        id AS inscricao_id,
        TRIM(COALESCE(NULLIF(TRIM(payload->>'nome'), ''), 'Sem Nome')) AS nome,
        TRIM(payload->>'telefone') AS telefone,
        TRIM(payload->>'cidade') AS cidade,
        TRIM(payload->>'email') AS email,
        ${treinamentoExpr} AS treinamento_id,
        ${recrutadorExpr} AS recrutador_codigo,
        payload->>'presenca_participante_nome' AS participante_nome_zoom,
        COALESCE((payload->>'presenca_tempo_total_minutos')::integer, 0) AS tempo_total_minutos,
        COALESCE((payload->>'presenca_tempo_dinamica_minutos')::integer, 0) AS tempo_dinamica_minutos,
        COALESCE((payload->>'presenca_percentual_dinamica')::integer, 0) AS percentual_dinamica,
        COALESCE((payload->>'presenca_aprovada')::boolean, false) AS aprovado,
        payload->>'presenca_validada_em' AS validado_em
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE payload->>'presenca_validada' = 'true'
        AND ${treinamentoExpr} = $1
      ORDER BY
        COALESCE((payload->>'presenca_tempo_dinamica_minutos')::integer, 0) DESC,
        COALESCE((payload->>'presenca_tempo_total_minutos')::integer, 0) DESC,
        TRIM(COALESCE(NULLIF(TRIM(payload->>'nome'), ''), 'Sem Nome')) ASC
    `;

    const { rows } = await pool.query<{
      inscricao_id: number;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      email: string | null;
      treinamento_id: string;
      recrutador_codigo: string | null;
      participante_nome_zoom: string | null;
      tempo_total_minutos: number;
      tempo_dinamica_minutos: number;
      percentual_dinamica: number;
      aprovado: boolean;
      validado_em: string | null;
    }>(query, [treinamentoId]);

    await loadRecruiterCache();

    type RankingRow = (typeof rows)[number];
    const ranking = rows.map((row: RankingRow) => {
      const recruiterDb = getRecruiterFromCache(row.recrutador_codigo);
      const recruiterStatic = getRecruiterByCodeIfNamed(row.recrutador_codigo);
      const recrutadorNome = recruiterDb?.name ?? recruiterStatic?.name ?? null;

      return {
        inscricaoId: row.inscricao_id,
        nome: row.nome,
        telefone: row.telefone,
        cidade: row.cidade,
        email: row.email,
        recrutadorCodigo: row.recrutador_codigo,
        recrutadorNome,
        participanteNomeZoom: row.participante_nome_zoom,
        tempoTotalMinutos: row.tempo_total_minutos,
        tempoDinamicaMinutos: row.tempo_dinamica_minutos,
        percentualDinamica: row.percentual_dinamica,
        aprovado: row.aprovado,
        validadoEm: row.validado_em,
      };
    });

    return NextResponse.json({
      success: true,
      total: ranking.length,
      ranking,
    });
  } catch (error) {
    console.error("Erro ao gerar ranking:", error);
    return NextResponse.json(
      { error: "Falha ao gerar ranking de presença." },
      { status: 500 }
    );
  }
}
