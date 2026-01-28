import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Buscar distribuição de treinamentos
    const trainingDistribution = await pool.query(`
      SELECT 
        payload->>'treinamento' as treinamento,
        COUNT(*) as total
      FROM inscricoes.inscricoes 
      GROUP BY payload->>'treinamento'
      ORDER BY total DESC
    `);

    // Buscar exemplos do treinamento problemático (2025-11-13)
    const problematicExamples = await pool.query(`
      SELECT 
        id, 
        payload->>'treinamento' as treinamento, 
        payload->>'nome' as nome,
        payload->>'timestamp' as timestamp_original,
        payload->>'dataHora' as dataHora,
        payload->>'created_at' as created_at,
        payload->>'data_treinamento' as data_treinamento,
        criado_em
      FROM inscricoes.inscricoes 
      WHERE payload->>'treinamento' = '2025-11-13'
      LIMIT 20
    `);

    // Buscar um payload completo para análise
    const fullPayloadSample = await pool.query(`
      SELECT id, payload
      FROM inscricoes.inscricoes 
      WHERE payload->>'treinamento' = '2025-11-13'
      LIMIT 3
    `);

    // Verificar se existe algum campo de data real no payload
    const possibleDateFields = await pool.query(`
      SELECT DISTINCT jsonb_object_keys(payload) as field_name
      FROM inscricoes.inscricoes
      WHERE payload->>'treinamento' = '2025-11-13'
      LIMIT 1
    `);

    return NextResponse.json({
      trainingDistribution: trainingDistribution.rows,
      problematicExamples: problematicExamples.rows,
      fullPayloadSamples: fullPayloadSample.rows,
      availableFields: possibleDateFields.rows,
    });
  } catch (error) {
    console.error("Failed to analyze trainings", error);
    return NextResponse.json(
      { error: "Failed to analyze trainings", details: String(error) },
      { status: 500 }
    );
  }
}
