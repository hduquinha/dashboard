import { NextRequest, NextResponse } from "next/server";
import { getPool, loadRecruiterCache, getRecruiterFromCache } from "@/lib/db";
import { getRecruiterByCodeIfNamed } from "@/lib/recruiters";

const SCHEMA_NAME = "inscricoes";

interface RecruiterRanking {
  recrutadorCodigo: string;
  recrutadorNome: string;
  totalInscritos: number;
  totalAprovados: number;
  percentualAprovacao: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Expressão para extrair treinamento
    const treinamentoExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'treinamento'), ''),
      NULLIF(TRIM(payload->>'training'), ''),
      NULLIF(TRIM(payload->>'training_date'), ''),
      NULLIF(TRIM(payload->>'trainingDate'), ''),
      NULLIF(TRIM(payload->>'data_treinamento'), ''),
      'Sem Treinamento'
    ))`;

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
          WHERE (payload->>'presenca_aprovada')::boolean = true
        )::integer AS total_aprovados
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE ${treinamentoExpr} = $1
        AND ${recrutadorExpr} IS NOT NULL
        AND ${recrutadorExpr} != ''
      GROUP BY ${recrutadorExpr}
      ORDER BY total_inscritos DESC, total_aprovados DESC
    `;

    const { rows } = await pool.query<{
      recrutador_codigo: string;
      total_inscritos: number;
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
