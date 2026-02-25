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
  perDay?: Array<{
    day: number;
    tempoTotalMinutos: number;
    tempoDinamicaMinutos: number;
    percentualDinamica: number;
    aprovado: boolean;
  }>;
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
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { associations, pending, treinamentoId, totalDays } = body;

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
        // Dados de presença a serem salvos no payload
        const presenceData: Record<string, unknown> = {
          presenca_validada: true,
          presenca_aprovada: assoc.aprovado,
          presenca_participante_nome: assoc.participanteNome,
          presenca_tempo_total_minutos: assoc.tempoTotal,
          presenca_tempo_dinamica_minutos: assoc.tempoDinamica,
          presenca_percentual_dinamica: assoc.percentualDinamica,
          presenca_treinamento_id: treinamentoId,
          presenca_validada_em: new Date().toISOString(),
          presenca_status: "confirmed",
          presenca_total_dias: totalDays ?? 1,
        };

        // Store per-day data for multi-day trainings
        if (assoc.perDay && assoc.perDay.length > 0) {
          for (const dayData of assoc.perDay) {
            const prefix = `presenca_dia${dayData.day}`;
            presenceData[`${prefix}_tempo_total`] = dayData.tempoTotalMinutos;
            presenceData[`${prefix}_tempo_dinamica`] = dayData.tempoDinamicaMinutos;
            presenceData[`${prefix}_percentual_dinamica`] = dayData.percentualDinamica;
            presenceData[`${prefix}_aprovado`] = dayData.aprovado;
          }
        }

        await pool.query(
          `UPDATE ${SCHEMA_NAME}.inscricoes 
           SET payload = payload || $1::jsonb 
           WHERE id = $2`,
          [JSON.stringify(presenceData), assoc.inscricaoId]
        );

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
