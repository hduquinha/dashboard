import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

/**
 * GET /api/presence/debug?target=<treinamentoId>
 * 
 * Endpoint de diagnóstico para investigar por que presenças
 * não aparecem na página de treinamento.
 * 
 * Retorna:
 * - Lista de treinamento IDs únicos nas presenças
 * - Comparação com o ID alvo (se fornecido)
 * - Exemplos de payload para ajudar no diagnóstico
 */
export async function GET(request: NextRequest) {
  try {
    const targetId = request.nextUrl.searchParams.get("target") || null;

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

    // 1. Listar treinamentos únicos com presenças
    const uniqueRes = await pool.query<{
      treinamento_id: string;
      count: string;
      stored_id: string | null;
    }>(`
      SELECT 
        ${treinamentoExpr} AS treinamento_id,
        COUNT(*)::text AS count,
        MIN(payload->>'presenca_treinamento_id') AS stored_id
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE payload->>'presenca_validada' = 'true'
      GROUP BY ${treinamentoExpr}
      ORDER BY COUNT(*) DESC
    `);

    const trainingsWithPresences = uniqueRes.rows.map((row: { treinamento_id: string; count: string; stored_id: string | null }) => ({
      treinamentoId: row.treinamento_id,
      count: parseInt(row.count),
      storedId: row.stored_id,
      // Informação detalhada de caracteres para debug
      charCodes: Array.from(row.treinamento_id).map((c: string) => ({
        char: c,
        code: c.charCodeAt(0),
      })),
    }));

    // 2. Se target fornecido, tentar match de várias formas
    let matchAnalysis = null;
    if (targetId) {
      const targetNormalized = targetId.trim().toLowerCase();
      let targetDecoded = targetId;
      try { targetDecoded = decodeURIComponent(targetId); } catch { /* ok */ }

      matchAnalysis = {
        targetId,
        targetDecoded,
        targetNormalized,
        targetCharCodes: Array.from(targetId).map((c: string) => ({
          char: c,
          code: c.charCodeAt(0),
        })),
        matches: trainingsWithPresences.map((t: { treinamentoId: string; storedId: string | null }) => ({
          treinamentoId: t.treinamentoId,
          exactMatch: t.treinamentoId === targetId,
          trimLowerMatch: t.treinamentoId.trim().toLowerCase() === targetNormalized,
          decodedMatch: t.treinamentoId === targetDecoded,
          includesTarget: t.treinamentoId.includes(targetId),
          targetIncludes: targetId.includes(t.treinamentoId),
          storedIdMatch: t.storedId === targetId,
        })),
      };
    }

    // 3. Amostra de um registro com presença (para ver a estrutura)
    const sampleRes = await pool.query<{ id: number; payload: Record<string, unknown> }>(`
      SELECT id, payload
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE payload->>'presenca_validada' = 'true'
      LIMIT 1
    `);

    const samplePayloadKeys = sampleRes.rows.length > 0
      ? Object.keys(sampleRes.rows[0].payload).filter(k => 
          k.startsWith('presenca') || 
          k.includes('treinamento') || 
          k.includes('training')
        )
      : [];

    const sampleValues = sampleRes.rows.length > 0
      ? Object.fromEntries(
          samplePayloadKeys.map(k => [k, sampleRes.rows[0].payload[k]])
        )
      : {};

    return NextResponse.json({
      success: true,
      totalTrainingsWithPresences: trainingsWithPresences.length,
      trainingsWithPresences,
      matchAnalysis,
      samplePayloadKeys,
      sampleValues,
    });
  } catch (error) {
    console.error("Erro no debug de presenças:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    );
  }
}
