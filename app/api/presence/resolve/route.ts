import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const SCHEMA_NAME = "inscricoes";

interface ResolveRequest {
  pendingId: number;
  inscricaoId: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: ResolveRequest = await request.json();
    const { pendingId, inscricaoId } = body;

    if (!pendingId || !inscricaoId) {
      return NextResponse.json(
        { error: "ID do pendente e ID da inscrição são obrigatórios." },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Buscar dados do pendente
    const pendingResult = await pool.query<{
      id: number;
      participante_nome: string;
      treinamento_id: string;
      aprovado: boolean;
      tempo_total_minutos: number;
      tempo_dinamica_minutos: number;
      percentual_dinamica: number;
    }>(
      `SELECT id, participante_nome, treinamento_id, aprovado, 
              tempo_total_minutos, tempo_dinamica_minutos, percentual_dinamica
       FROM ${SCHEMA_NAME}.presencas_pendentes 
       WHERE id = $1 AND resolvido_em IS NULL`,
      [pendingId]
    );

    if (pendingResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Pendente não encontrado ou já foi resolvido." },
        { status: 404 }
      );
    }

    const pending = pendingResult.rows[0];

    // Salvar presença na inscrição
    const presenceData = {
      presenca_validada: true,
      presenca_aprovada: pending.aprovado,
      presenca_participante_nome: pending.participante_nome,
      presenca_tempo_total_minutos: pending.tempo_total_minutos,
      presenca_tempo_dinamica_minutos: pending.tempo_dinamica_minutos,
      presenca_percentual_dinamica: pending.percentual_dinamica,
      presenca_treinamento_id: pending.treinamento_id,
      presenca_validada_em: new Date().toISOString(),
      presenca_status: "confirmed",
    };

    await pool.query(
      `UPDATE ${SCHEMA_NAME}.inscricoes 
       SET payload = payload || $1::jsonb 
       WHERE id = $2`,
      [JSON.stringify(presenceData), inscricaoId]
    );

    // Marcar pendente como resolvido
    await pool.query(
      `UPDATE ${SCHEMA_NAME}.presencas_pendentes 
       SET resolvido_em = NOW(), inscricao_final_id = $1 
       WHERE id = $2`,
      [inscricaoId, pendingId]
    );

    return NextResponse.json({
      success: true,
      message: "Presença associada com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao resolver pendente:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao resolver." },
      { status: 500 }
    );
  }
}

// Endpoint para buscar inscrições para associação
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q") ?? "";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);

    if (query.length < 2) {
      return NextResponse.json({ inscricoes: [] });
    }

    const pool = getPool();
    const searchPattern = `%${query}%`;

    type InscricaoRow = {
      id: number;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      treinamento: string | null;
      recrutador_codigo: string | null;
    };

    const result = await pool.query<InscricaoRow>(
      `SELECT 
        id,
        TRIM(COALESCE(payload->>'nome', '')) AS nome,
        TRIM(payload->>'telefone') AS telefone,
        TRIM(payload->>'cidade') AS cidade,
        TRIM(COALESCE(
          NULLIF(TRIM(payload->>'treinamento'), ''),
          NULLIF(TRIM(payload->>'training'), ''),
          NULLIF(TRIM(payload->>'training_date'), '')
        )) AS treinamento,
        TRIM(COALESCE(
          NULLIF(TRIM(payload->>'traffic_source'), ''),
          NULLIF(TRIM(payload->>'source'), '')
        )) AS recrutador_codigo
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE (
        LOWER(payload->>'nome') LIKE LOWER($1) OR
        payload->>'telefone' LIKE $1
      )
      ORDER BY id DESC
      LIMIT $2`,
      [searchPattern, limit]
    );

    const inscricoes = result.rows.map((row: InscricaoRow) => ({
      id: row.id,
      nome: row.nome,
      telefone: row.telefone,
      cidade: row.cidade,
      treinamento: row.treinamento,
      recrutadorCodigo: row.recrutador_codigo,
    }));

    return NextResponse.json({ inscricoes });
  } catch (error) {
    console.error("Erro ao buscar inscrições:", error);
    return NextResponse.json(
      { error: "Falha ao buscar inscrições." },
      { status: 500 }
    );
  }
}
