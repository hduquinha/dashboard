import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
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

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function ensurePendingTable() {
  await getPool().query(`
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
}

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const body: RequestBody = await request.json();
    const associations = Array.isArray(body.associations) ? body.associations : [];
    const pending = Array.isArray(body.pending) ? body.pending : [];
    const treinamentoId = body.treinamentoId?.trim();
    const days = body.totalDays === 2 ? 2 : 1;
    const dayNum = body.currentDay === 2 ? 2 : 1;

    if (!treinamentoId) {
      return NextResponse.json({ error: "Treinamento nao informado." }, { status: 400 });
    }

    const pool = getPool();
    let savedCount = 0;
    let pendingCount = 0;
    const errors: string[] = [];

    for (const assoc of associations) {
      if (!assoc.inscricaoId) {
        continue;
      }

      try {
        const prefix = days > 1 ? `presenca_dia${dayNum}` : "presenca";
        const presenceData: Record<string, unknown> = {
          presenca_validada: true,
          presenca_treinamento_id: treinamentoId,
          presenca_validada_em: new Date().toISOString(),
          presenca_status: "confirmed",
          presenca_total_dias: days,
          presenca_dia_processado: dayNum,
          presenca_dinamica_dias: body.dinamicaDays ?? "none",
          [`${prefix}_participante_nome`]: assoc.participanteNome,
          [`${prefix}_aprovado`]: assoc.aprovado,
          [`${prefix}_tempo_total`]: assoc.tempoTotal,
          [`${prefix}_tempo_dinamica`]: assoc.tempoDinamica,
          [`${prefix}_percentual_dinamica`]: assoc.percentualDinamica,
          [`${prefix}_tem_dinamica`]: assoc.hasDinamica,
        };

        if (days === 1) {
          presenceData.presenca_aprovada = assoc.aprovado;
          presenceData.presenca_participante_nome = assoc.participanteNome;
          presenceData.presenca_tempo_total_minutos = assoc.tempoTotal;
          presenceData.presenca_tempo_dinamica_minutos = assoc.tempoDinamica;
          presenceData.presenca_percentual_dinamica = assoc.percentualDinamica;
        }

        if (days === 2 && dayNum === 1) {
          presenceData.presenca_aprovada = false;
          presenceData.presenca_participante_nome = assoc.participanteNome;
          presenceData.presenca_tempo_total_minutos = assoc.tempoTotal;
          presenceData.presenca_tempo_dinamica_minutos = assoc.tempoDinamica;
          presenceData.presenca_percentual_dinamica = assoc.percentualDinamica;
        }

        if (days === 2 && dayNum === 2) {
          presenceData.presenca_participante_nome = assoc.participanteNome;
        }

        await pool.query(
          `UPDATE ${SCHEMA_NAME}.inscricoes
           SET payload = payload || $1::jsonb
           WHERE id = $2`,
          [JSON.stringify(presenceData), assoc.inscricaoId]
        );

        if (days === 2 && dayNum === 2) {
          const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
            `SELECT payload FROM ${SCHEMA_NAME}.inscricoes WHERE id = $1`,
            [assoc.inscricaoId]
          );

          const payload = rows[0]?.payload ?? {};
          const dia1Aprovado = payload.presenca_dia1_aprovado === true || payload.presenca_dia1_aprovado === "true";
          const dia2Aprovado = payload.presenca_dia2_aprovado === true || payload.presenca_dia2_aprovado === "true";
          const dia1Tempo = numberOrZero(payload.presenca_dia1_tempo_total);
          const dia2Tempo = numberOrZero(payload.presenca_dia2_tempo_total);
          const dia1Dinamica = numberOrZero(payload.presenca_dia1_tempo_dinamica);
          const dia2Dinamica = numberOrZero(payload.presenca_dia2_tempo_dinamica);

          await pool.query(
            `UPDATE ${SCHEMA_NAME}.inscricoes
             SET payload = payload || $1::jsonb
             WHERE id = $2`,
            [
              JSON.stringify({
                presenca_aprovada: dia1Aprovado && dia2Aprovado,
                presenca_dia_processado: 2,
                presenca_tempo_total_minutos: dia1Tempo + dia2Tempo,
                presenca_tempo_dinamica_minutos: dia1Dinamica + dia2Dinamica,
              }),
              assoc.inscricaoId,
            ]
          );
        }

        savedCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        console.error(`Erro ao salvar associacao para inscricao ${assoc.inscricaoId}:`, error);
        errors.push(`Inscricao ${assoc.inscricaoId}: ${message}`);
      }
    }

    if (pending.length > 0) {
      await ensurePendingTable();

      for (const entry of pending) {
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
              entry.participanteNome,
              treinamentoId,
              entry.aprovado,
              entry.tempoTotal,
              entry.tempoDinamica,
              entry.percentualDinamica,
              entry.status,
              entry.inscricaoId1 ?? null,
              entry.inscricaoNome1 ?? null,
              entry.inscricaoId2 ?? null,
              entry.inscricaoNome2 ?? null,
            ]
          );
          pendingCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "erro desconhecido";
          console.error(`Erro ao salvar pendente ${entry.participanteNome}:`, error);
          errors.push(`Pendente ${entry.participanteNome}: ${message}`);
        }
      }
    }

    if (errors.length > 0 && savedCount === 0 && pendingCount === 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Falha ao salvar. Erros: ${errors.join("; ")}`,
          savedCount,
          pendingCount,
          errors,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        errors.length > 0
          ? `${savedCount} associacoes e ${pendingCount} pendentes salvas. ${errors.length} erro(s): ${errors.join("; ")}`
          : `${savedCount} associacoes e ${pendingCount} pendentes salvas com sucesso.`,
      savedCount,
      pendingCount,
      errors,
    });
  } catch (error) {
    console.error("Erro ao salvar associacoes:", error);
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
