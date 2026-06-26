import { NextRequest, NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { getPool, loadRecruiterCache, getRecruiterFromCache } from "@/lib/db";
import { getRecruiterByCodeIfNamed } from "@/lib/recruiters";

const SCHEMA_NAME = "inscricoes";

interface RecruiterRanking {
  recrutadorCodigo: string;
  recrutadorNome: string;
  totalInscritos: number;
  totalPresentes: number;
  totalAprovados: number;
  percentualAprovacao: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const { id: treinamentoId } = await params;

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "ID do treinamento não informado." },
        { status: 400 }
      );
    }

    // Carrega cache de recrutadores do banco
    await loadRecruiterCache();

    const pool = getPool();

    const explicitTreinamentoExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'treinamento'), ''),
      NULLIF(TRIM(payload->>'training'), ''),
      NULLIF(TRIM(payload->>'training_id'), ''),
      NULLIF(TRIM(payload->>'trainingId'), ''),
      NULLIF(TRIM(payload->>'training_code'), ''),
      NULLIF(TRIM(payload->>'trainingCode'), ''),
      NULLIF(TRIM(payload->>'treinamento_id'), ''),
      NULLIF(TRIM(payload->>'treinamento_nome'), ''),
      NULLIF(TRIM(payload->>'treinamentoNome'), ''),
      NULLIF(TRIM(payload->>'training_option'), ''),
      NULLIF(TRIM(payload->>'trainingOption'), ''),
      ''
    ))`;
    const upDayTrainingDateExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), ''),
      NULLIF(TRIM(payload->>'data_treinamento_extenso'), ''),
      NULLIF(TRIM(payload->>'dataTreinamentoExtenso'), ''),
      NULLIF(TRIM(payload->>'treinamento_inicio'), ''),
      NULLIF(TRIM(payload->>'treinamentoInicio'), ''),
      NULLIF(TRIM(payload->>'training_start'), ''),
      NULLIF(TRIM(payload->>'trainingStart'), ''),
      ''
    ))`;
    const onlineTrainingDateExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      NULLIF(TRIM(payload->>'dataTreinamento'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), ''),
      NULLIF(TRIM(payload->>'data_treinamento_extenso'), ''),
      NULLIF(TRIM(payload->>'dataTreinamentoExtenso'), ''),
      ''
    ))`;
    const upDayPayloadCondition = `(
      LOWER(${explicitTreinamentoExpr}) LIKE '%up day%'
      OR LOWER(TRIM(COALESCE(NULLIF(TRIM(payload->>'origem'), ''), NULLIF(TRIM(payload->>'source'), ''), NULLIF(TRIM(payload->>'origin'), ''), ''))) = 'landing-inscricao-agosto-2026'
      OR (
        TRIM(COALESCE(
          NULLIF(TRIM(payload->>'tamanho_camiseta'), ''),
          NULLIF(TRIM(payload->>'tamanhoCamiseta'), ''),
          NULLIF(TRIM(payload->>'multa_ciente'), ''),
          NULLIF(TRIM(payload->>'multaCiente'), ''),
          NULLIF(TRIM(payload->>'cancelamento_ciente'), ''),
          NULLIF(TRIM(payload->>'cancelamentoCiente'), ''),
          ''
        )) <> ''
        AND ${upDayTrainingDateExpr} <> ''
      )
    )`;
    const treinamentoExpr = `COALESCE(
      CASE WHEN ${upDayPayloadCondition} THEN NULLIF(${upDayTrainingDateExpr}, '') END,
      CASE WHEN NOT ${upDayPayloadCondition} THEN NULLIF(${onlineTrainingDateExpr}, '') END,
      NULLIF(${explicitTreinamentoExpr}, ''),
      NULLIF(TRIM(payload->>'dashboard_treinamento'), ''),
      ''
    )`;

    // Expressão para extrair código do recrutador - prioriza traffic_source
    const recrutadorExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'traffic_source'), ''),
      NULLIF(TRIM(payload->>'source'), ''),
      NULLIF(TRIM(payload->>'recrutador'), ''),
      NULLIF(TRIM(payload->>'recrutador_codigo'), ''),
      NULLIF(TRIM(payload->>'recruiter_code'), '')
    ))`;

    const query = `
      SELECT
        ${recrutadorExpr} AS recrutador_codigo,
        COUNT(*)::integer AS total_inscritos,
        COUNT(*) FILTER (
          WHERE (payload->>'presenca_validada')::boolean = true
        )::integer AS total_presentes,
        COUNT(*) FILTER (
          WHERE (payload->>'presenca_aprovada')::boolean = true
        )::integer AS total_aprovados
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE ${treinamentoExpr} = $1
        AND LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
        AND ${recrutadorExpr} IS NOT NULL
        AND ${recrutadorExpr} != ''
      GROUP BY ${recrutadorExpr}
      ORDER BY total_aprovados DESC, total_presentes DESC, total_inscritos DESC, recrutador_codigo ASC
    `;

    const { rows } = await pool.query<{
      recrutador_codigo: string;
      total_inscritos: number;
      total_presentes: number;
      total_aprovados: number;
    }>(query, [treinamentoId]);

    type RankingRow = typeof rows[number];
    const ranking: RecruiterRanking[] = rows.map((row: RankingRow) => {
      // Prioridade: banco de dados > lista estática (sem placeholders)
      const recruiterDb = getRecruiterFromCache(row.recrutador_codigo);
      const recruiterStatic = getRecruiterByCodeIfNamed(row.recrutador_codigo);
      const percentual =
        row.total_inscritos > 0
          ? Math.round((row.total_aprovados / row.total_inscritos) * 100)
          : 0;

      return {
        recrutadorCodigo: row.recrutador_codigo,
        recrutadorNome: recruiterDb?.name ?? recruiterStatic?.name ?? `Código ${row.recrutador_codigo}`,
        totalInscritos: row.total_inscritos,
        totalPresentes: row.total_presentes,
        totalAprovados: row.total_aprovados,
        percentualAprovacao: percentual,
      };
    });

    return NextResponse.json({
      success: true,
      treinamentoId,
      total: ranking.length,
      ranking,
    });
  } catch (error) {
    console.error("Erro ao buscar ranking de recrutadores:", error);
    return NextResponse.json(
      { error: "Falha ao buscar ranking de recrutadores." },
      { status: 500 }
    );
  }
}
