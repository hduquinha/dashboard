import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    // Buscar distribuição de treinamentos
    const trainingDistribution = await client.query(`
      SELECT 
        payload->>'treinamento' as treinamento,
        COUNT(*) as total
      FROM inscricoes.inscricoes 
      GROUP BY payload->>'treinamento'
      ORDER BY total DESC
    `);

    // Buscar exemplos do treinamento problemático (13/11/2025 - formato BR)
    const problematicExamples = await client.query(`
      SELECT 
        id, 
        payload->>'treinamento' as treinamento, 
        payload->>'nome' as nome,
        payload->>'timestamp' as timestamp_original,
        payload->>'dataHora' as dataHora,
        payload->>'created_at' as created_at,
        payload->>'data_treinamento' as data_treinamento,
        payload->>'Treinamento' as treinamento_original,
        criado_em
      FROM inscricoes.inscricoes 
      WHERE payload->>'treinamento' = '13/11/2025'
      LIMIT 20
    `);

    // Buscar um payload completo para análise
    const fullPayloadSample = await client.query(`
      SELECT id, payload
      FROM inscricoes.inscricoes 
      WHERE payload->>'treinamento' = '13/11/2025'
      LIMIT 5
    `);

    // Verificar todos os campos únicos no payload dos registros problemáticos
    const allFieldsQuery = await client.query(`
      SELECT DISTINCT jsonb_object_keys(payload) as field_name
      FROM inscricoes.inscricoes
      WHERE payload->>'treinamento' = '13/11/2025'
    `);

    return NextResponse.json({
      trainingDistribution: trainingDistribution.rows,
      problematicCount: problematicExamples.rows.length,
      problematicExamples: problematicExamples.rows,
      fullPayloadSamples: fullPayloadSample.rows,
      availableFields: allFieldsQuery.rows,
    });
  } catch (error) {
    console.error("Failed to analyze trainings", error);
    return NextResponse.json(
      { error: "Failed to analyze trainings", details: String(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
