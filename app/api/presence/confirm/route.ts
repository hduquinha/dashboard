import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

interface AssociationPayload {
  inscricaoId: number;
  participanteNome: string;
  aprovado: boolean;
  tempoTotal: number;
  tempoDinamica: number;
  percentualDinamica: number;
  hasDinamica: boolean;
}

interface PendingPayload {
  participanteNome: string;
  aprovado: boolean;
  tempoTotal: number;
  tempoDinamica: number;
  percentualDinamica: number;
  status: "not-found" | "doubt";
  inscricaoId1?: number | null;
  inscricaoNome1?: string | null;
  inscricaoId2?: number | null;
  inscricaoNome2?: string | null;
}

interface RequestBody {
  associations: AssociationPayload[];
  pending?: PendingPayload[];
  treinamentoId: string;
  totalDays?: number;
  currentDay?: number;
  dinamicaDays?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { associations, pending, treinamentoId, totalDays, currentDay, dinamicaDays } = body;

    const dayNum = currentDay ?? 1;
    const days = totalDays ?? 1;

    if (!associations || !Array.isArray(associations)) {
      return NextResponse.json(
        { error: "Dados de associações inválidos." },
        { status: 400 }
      );
    }

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "Treinamento não informado." },
        { status: 400 }
      );
    }

    const pool = getPool();
    let savedCount = 0;
    let pendingCount = 0;
    const errors: string[] = [];

    // Salvar associações confirmadas
    for (const assoc of associations) {
      if (!assoc.inscricaoId) continue;

      try {
        // Build presence data namespaced by day
        const prefix = days > 1 ? `presenca_dia${dayNum}` : "presenca";
        const presenceData: Record<string, unknown> = {
          presenca_validada: true,
          presenca_treinamento_id: treinamentoId,
          presenca_validada_em: new Date().toISOString(),
          presenca_status: "confirmed",
          presenca_total_dias: days,
          presenca_dia_processado: dayNum,
          presenca_dinamica_dias: dinamicaDays ?? "none",
          // Namespaced per-day data
          [`${prefix}_participante_nome`]: assoc.participanteNome,
          [`${prefix}_aprovado`]: assoc.aprovado,
          [`${prefix}_tempo_total`]: assoc.tempoTotal,
          [`${prefix}_tempo_dinamica`]: assoc.tempoDinamica,
          [`${prefix}_percentual_dinamica`]: assoc.percentualDinamica,
          [`${prefix}_tem_dinamica`]: assoc.hasDinamica,
        };

        // For single-day training, also set the top-level approval
        if (days === 1) {
          presenceData.presenca_aprovada = assoc.aprovado;
          presenceData.presenca_participante_nome = assoc.participanteNome;
          presenceData.presenca_tempo_total_minutos = assoc.tempoTotal;
          presenceData.presenca_tempo_dinamica_minutos = assoc.tempoDinamica;
          presenceData.presenca_percentual_dinamica = assoc.percentualDinamica;
        }

        // For 2-day training Day 1: set top-level with Day 1 data, mark partial
        if (days === 2 && dayNum === 1) {
          presenceData.presenca_participante_nome = assoc.participanteNome;
          presenceData.presenca_tempo_total_minutos = assoc.tempoTotal;
          presenceData.presenca_tempo_dinamica_minutos = assoc.tempoDinamica;
          presenceData.presenca_percentual_dinamica = assoc.percentualDinamica;
          presenceData.presenca_aprovada = false; // partial, pending Day 2
        }

        // For 2-day training Day 2: recalculate overall approval
        if (days === 2 && dayNum === 2) {
          // We'll handle recalculation after the update by reading existing Day 1 data
          presenceData.presenca_participante_nome = assoc.participanteNome;
        }

        await pool.query(
          `UPDATE ${SCHEMA_NAME}.inscricoes 
           SET payload = payload || $1::jsonb 
           WHERE id = $2`,
          [JSON.stringify(presenceData), assoc.inscricaoId]
        );

        // For Day 2 of 2-day training: recalculate overall approval based on both days
        if (days === 2 && dayNum === 2) {
          const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
            `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1`,
            [assoc.inscricaoId]
          );
          if (rows.length > 0) {
            const p = rows[0].payload;
            const dia1Aprovado = p.presenca_dia1_aprovado === true;
            const dia2Aprovado = p.presenca_dia2_aprovado === true;
            const overallApproved = dia1Aprovado && dia2Aprovado;
            // Sum both days for top-level fields
            const dia1Tempo = typeof p.presenca_dia1_tempo_total === "number" ? p.presenca_dia1_tempo_total : 0;
            const dia2Tempo = typeof p.presenca_dia2_tempo_total === "number" ? p.presenca_dia2_tempo_total : 0;
            const dia1Dinamica = typeof p.presenca_dia1_tempo_dinamica === "number" ? p.presenca_dia1_tempo_dinamica : 0;
            const dia2Dinamica = typeof p.presenca_dia2_tempo_dinamica === "number" ? p.presenca_dia2_tempo_dinamica : 0;
            await pool.query(
              `UPDATE ${SCHEMA_NAME}.inscricoes 
               SET payload = payload || $1::jsonb 
               WHERE id = $2`,
              [JSON.stringify({
                presenca_aprovada: overallApproved,
                presenca_dia_processado: 2,
                presenca_tempo_total_minutos: dia1Tempo + dia2Tempo,
                presenca_tempo_dinamica_minutos: dia1Dinamica + dia2Dinamica,
              }), assoc.inscricaoId]
            );
          }
        }

        savedCount++;
      } catch (err) {
        console.error(`Erro ao salvar associação para inscrição ${assoc.inscricaoId}:`, err);
        errors.push(`Inscrição ${assoc.inscricaoId}: ${err instanceof Error ? err.message : "erro desconhecido"}`);
      }
    }

    // Salvar pendentes (not-found e doubt) na tabela de pendentes
    if (pending && Array.isArray(pending) && pending.length > 0) {
      // Criar tabela se não existir
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.presencas_pendentes (
          id SERIAL PRIMARY KEY,
          participante_nome TEXT NOT NULL,
          treinamento_id TEXT NOT NULL,
          aprovado BOOLEAN NOT NULL DEFAULT false,
          tempo_total_minutos INTEGER NOT NULL DEFAULT 0,
          tempo_dinamica_minutos INTEGER NOT NULL DEFAULT 0,
          percentual_dinamica INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          inscricao_id_1 INTEGER,
          inscricao_nome_1 TEXT,
          inscricao_id_2 INTEGER,
          inscricao_nome_2 TEXT,
          criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          resolvido_em TIMESTAMP WITH TIME ZONE,
          inscricao_final_id INTEGER,
          UNIQUE(participante_nome, treinamento_id)
        )
      `);

      for (const p of pending) {
        try {
          await pool.query(
            `INSERT INTO ${SCHEMA_NAME}.presencas_pendentes 
             (participante_nome, treinamento_id, aprovado, tempo_total_minutos, 
              tempo_dinamica_minutos, percentual_dinamica, status, 
              inscricao_id_1, inscricao_nome_1, inscricao_id_2, inscricao_nome_2)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (participante_nome, treinamento_id) 
             DO UPDATE SET 
               aprovado = EXCLUDED.aprovado,
               tempo_total_minutos = EXCLUDED.tempo_total_minutos,
               tempo_dinamica_minutos = EXCLUDED.tempo_dinamica_minutos,
               percentual_dinamica = EXCLUDED.percentual_dinamica,
               status = EXCLUDED.status,
               inscricao_id_1 = EXCLUDED.inscricao_id_1,
               inscricao_nome_1 = EXCLUDED.inscricao_nome_1,
               inscricao_id_2 = EXCLUDED.inscricao_id_2,
               inscricao_nome_2 = EXCLUDED.inscricao_nome_2`,
            [
              p.participanteNome,
              treinamentoId,
              p.aprovado,
              p.tempoTotal,
              p.tempoDinamica,
              p.percentualDinamica,
              p.status,
              p.inscricaoId1 ?? null,
              p.inscricaoNome1 ?? null,
              p.inscricaoId2 ?? null,
              p.inscricaoNome2 ?? null,
            ]
          );
          pendingCount++;
        } catch (err) {
          console.error(`Erro ao salvar pendente ${p.participanteNome}:`, err);
          errors.push(`Pendente ${p.participanteNome}: ${err instanceof Error ? err.message : "erro desconhecido"}`);
        }
      }
    }

    if (errors.length > 0 && savedCount === 0 && pendingCount === 0) {
      return NextResponse.json(
        { 
          success: false, 
          message: `Falha ao salvar. Erros: ${errors.join("; ")}`,
          savedCount: 0,
          pendingCount: 0,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: errors.length > 0 
        ? `${savedCount} associações e ${pendingCount} pendentes salvas. ${errors.length} erro(s): ${errors.join("; ")}`
        : `${savedCount} associações e ${pendingCount} pendentes salvas com sucesso.`,
      savedCount,
      pendingCount,
      errors,
    });
  } catch (error) {
    console.error("Erro ao salvar associações:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : "Erro ao salvar.",
        savedCount: 0,
        pendingCount: 0,
      },
      { status: 500 }
    );
  }
}
