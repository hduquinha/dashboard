import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

/**
 * POST /api/presence/reset
 * 
 * Remove TODAS as presenças de um treinamento específico.
 * Pode resetar tudo ou apenas um dia específico.
 * 
 * Body:
 *   treinamentoId: string  — ID do treinamento
 *   day?: number           — Dia específico para resetar (1 ou 2). Se omitido, reseta tudo.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { treinamentoId, day } = body as { treinamentoId: string; day?: number };

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "ID do treinamento não informado." },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Expressão para identificar treinamento (mesma de listTrainingsWithStats)
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

    // Todas as chaves de presença que podem existir no payload
    const allPresenceKeys = [
      'presenca_validada',
      'presenca_aprovada',
      'presenca_participante_nome',
      'presenca_tempo_total_minutos',
      'presenca_tempo_dinamica_minutos',
      'presenca_percentual_dinamica',
      'presenca_treinamento_id',
      'presenca_validada_em',
      'presenca_status',
      'presenca_total_dias',
      'presenca_dia_processado',
      'presenca_dinamica_dias',
      // Dia 1
      'presenca_dia1_participante_nome',
      'presenca_dia1_aprovado',
      'presenca_dia1_tempo_total',
      'presenca_dia1_tempo_dinamica',
      'presenca_dia1_percentual_dinamica',
      'presenca_dia1_tem_dinamica',
      // Dia 2
      'presenca_dia2_participante_nome',
      'presenca_dia2_aprovado',
      'presenca_dia2_tempo_total',
      'presenca_dia2_tempo_dinamica',
      'presenca_dia2_percentual_dinamica',
      'presenca_dia2_tem_dinamica',
      // Single-day aliases
      'presenca_tem_dinamica',
    ];

    // Chaves de um dia específico
    const dayKeys = (d: number) => [
      `presenca_dia${d}_participante_nome`,
      `presenca_dia${d}_aprovado`,
      `presenca_dia${d}_tempo_total`,
      `presenca_dia${d}_tempo_dinamica`,
      `presenca_dia${d}_percentual_dinamica`,
      `presenca_dia${d}_tem_dinamica`,
    ];

    if (day && (day === 1 || day === 2)) {
      // ── Resetar apenas um dia específico ──
      const keysToRemove = dayKeys(day);
      const removeKeysQuery = keysToRemove.map(key => `'${key}'`).join(', ');

      // Reset dia-específico + recalcular top-level
      const result = await pool.query(
        `UPDATE ${SCHEMA_NAME}.inscricoes 
         SET payload = payload - ARRAY[${removeKeysQuery}]::text[]
         WHERE payload->>'presenca_validada' = 'true'
           AND ${treinamentoExpr} = $1
         RETURNING id`,
        [treinamentoId]
      );

      const affectedCount = result.rowCount ?? 0;

      if (affectedCount > 0) {
        // Recalcular: se resetamos dia 1, o dia processado volta para 0; se dia 2, volta para 1
        const newDiaProcessado = day === 1 ? 0 : 1;
        // Se resetamos qualquer dia, aprovação geral volta para false
        await pool.query(
          `UPDATE ${SCHEMA_NAME}.inscricoes 
           SET payload = payload || $1::jsonb
           WHERE payload->>'presenca_validada' = 'true'
             AND ${treinamentoExpr} = $2`,
          [
            JSON.stringify({
              presenca_aprovada: false,
              presenca_dia_processado: newDiaProcessado,
            }),
            treinamentoId,
          ]
        );

        // Se resetamos dia 1 de um treinamento de 2 dias, não faz sentido manter validado
        // Se resetamos o único dia processado, resetar tudo
        if (day === 1) {
          // Verifica se dia 2 existe; se não, reseta tudo
          const check = await pool.query(
            `SELECT COUNT(*) AS cnt
             FROM ${SCHEMA_NAME}.inscricoes 
             WHERE payload->>'presenca_validada' = 'true'
               AND ${treinamentoExpr} = $1
               AND payload->>'presenca_dia2_aprovado' IS NOT NULL`,
            [treinamentoId]
          );
          if (Number(check.rows[0]?.cnt ?? 0) === 0) {
            // Sem dia 2, reseta tudo
            const removeAll = allPresenceKeys.map(key => `'${key}'`).join(', ');
            await pool.query(
              `UPDATE ${SCHEMA_NAME}.inscricoes 
               SET payload = payload - ARRAY[${removeAll}]::text[]
               WHERE payload->>'presenca_validada' = 'true'
                 AND ${treinamentoExpr} = $1`,
              [treinamentoId]
            );
          }
        }
      }

      // Também limpar pendentes do treinamento
      try {
        await pool.query(
          `DELETE FROM ${SCHEMA_NAME}.presencas_pendentes WHERE treinamento_id = $1`,
          [treinamentoId]
        );
      } catch {
        // Tabela pode não existir
      }

      return NextResponse.json({
        success: true,
        message: `Presenças do Dia ${day} resetadas para ${affectedCount} inscrições do treinamento "${treinamentoId}".`,
        affectedCount,
      });
    } else {
      // ── Resetar TUDO ──
      const removeKeysQuery = allPresenceKeys.map(key => `'${key}'`).join(', ');

      const result = await pool.query(
        `UPDATE ${SCHEMA_NAME}.inscricoes 
         SET payload = payload - ARRAY[${removeKeysQuery}]::text[]
         WHERE payload->>'presenca_validada' = 'true'
           AND ${treinamentoExpr} = $1
         RETURNING id`,
        [treinamentoId]
      );

      const affectedCount = result.rowCount ?? 0;

      // Também limpar pendentes do treinamento
      let pendingDeleted = 0;
      try {
        const pendingResult = await pool.query(
          `DELETE FROM ${SCHEMA_NAME}.presencas_pendentes WHERE treinamento_id = $1`,
          [treinamentoId]
        );
        pendingDeleted = pendingResult.rowCount ?? 0;
      } catch {
        // Tabela pode não existir
      }

      return NextResponse.json({
        success: true,
        message: affectedCount > 0
          ? `Todas as presenças resetadas: ${affectedCount} inscrições limpas e ${pendingDeleted} pendentes removidos do treinamento "${treinamentoId}".`
          : `Nenhuma presença encontrada para resetar no treinamento "${treinamentoId}".`,
        affectedCount,
        pendingDeleted,
      });
    }
  } catch (error) {
    console.error("Erro ao resetar presenças:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao resetar presenças.",
      },
      { status: 500 }
    );
  }
}
