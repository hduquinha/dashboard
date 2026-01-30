import { NextRequest, NextResponse } from "next/server";
import { getPool, loadRecruiterCache, getRecruiterFromCache } from "@/lib/db";
import { getRecruiterByCodeIfNamed } from "@/lib/recruiters";

const SCHEMA_NAME = "inscricoes";

interface PresenceRecord {
  inscricaoId: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  email: string | null;
  treinamentoId: string;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  participanteNomeZoom: string | null;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  aprovado: boolean;
  validadoEm: string | null;
}

interface PendingRecord {
  id: number;
  participanteNome: string;
  treinamentoId: string;
  aprovado: boolean;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  status: "not-found" | "doubt";
  inscricaoId1: number | null;
  inscricaoNome1: string | null;
  inscricaoId2: number | null;
  inscricaoNome2: string | null;
  criadoEm: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const treinamentoId = searchParams.get("treinamento");
    const apenasAprovados = searchParams.get("aprovados") !== "false";

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

    let query = `
      SELECT
        id AS inscricao_id,
        TRIM(COALESCE(NULLIF(TRIM(payload->>'nome'), ''), 'Sem Nome')) AS nome,
        TRIM(payload->>'telefone') AS telefone,
        TRIM(payload->>'cidade') AS cidade,
        TRIM(payload->>'email') AS email,
        ${treinamentoExpr} AS treinamento_id,
        ${recrutadorExpr} AS recrutador_codigo,
        payload->>'presenca_participante_nome' AS participante_nome_zoom,
        COALESCE((payload->>'presenca_tempo_total_minutos')::integer, 0) AS tempo_total_minutos,
        COALESCE((payload->>'presenca_tempo_dinamica_minutos')::integer, 0) AS tempo_dinamica_minutos,
        COALESCE((payload->>'presenca_percentual_dinamica')::integer, 0) AS percentual_dinamica,
        COALESCE((payload->>'presenca_aprovada')::boolean, false) AS aprovado,
        payload->>'presenca_validada_em' AS validado_em
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE payload->>'presenca_validada' = 'true'
    `;

    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (treinamentoId) {
      query += ` AND ${treinamentoExpr} = $${paramIndex}`;
      params.push(treinamentoId);
      paramIndex++;
    }

    if (apenasAprovados) {
      query += ` AND (payload->>'presenca_aprovada')::boolean = true`;
    }

    query += ` ORDER BY payload->>'presenca_validada_em' DESC NULLS LAST, id DESC`;

    const { rows } = await pool.query<{
      inscricao_id: number;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      email: string | null;
      treinamento_id: string;
      recrutador_codigo: string | null;
      participante_nome_zoom: string | null;
      tempo_total_minutos: number;
      tempo_dinamica_minutos: number;
      percentual_dinamica: number;
      aprovado: boolean;
      validado_em: string | null;
    }>(query, params);

    // Carrega cache de recrutadores do banco de dados
    await loadRecruiterCache();

    type PresenceRow = typeof rows[number];
    const presences: PresenceRecord[] = rows.map((row: PresenceRow) => {
      // Prioridade: banco de dados > lista estática (sem placeholders)
      const recruiterDb = getRecruiterFromCache(row.recrutador_codigo);
      const recruiterStatic = getRecruiterByCodeIfNamed(row.recrutador_codigo);
      const recrutadorNome = recruiterDb?.name ?? recruiterStatic?.name ?? null;
      return {
        inscricaoId: row.inscricao_id,
        nome: row.nome,
        telefone: row.telefone,
        cidade: row.cidade,
        email: row.email,
        treinamentoId: row.treinamento_id,
        recrutadorCodigo: row.recrutador_codigo,
        recrutadorNome,
        participanteNomeZoom: row.participante_nome_zoom,
        tempoTotalMinutos: row.tempo_total_minutos,
        tempoDinamicaMinutos: row.tempo_dinamica_minutos,
        percentualDinamica: row.percentual_dinamica,
        aprovado: row.aprovado,
        validadoEm: row.validado_em,
      };
    });

    // Buscar presenças pendentes (not-found e doubt)
    let pendingRecords: PendingRecord[] = [];
    try {
      const pendingQuery = `
        SELECT 
          id,
          participante_nome,
          treinamento_id,
          aprovado,
          tempo_total_minutos,
          tempo_dinamica_minutos,
          percentual_dinamica,
          status,
          inscricao_id_1,
          inscricao_nome_1,
          inscricao_id_2,
          inscricao_nome_2,
          criado_em,
          resolvido_em,
          inscricao_final_id
        FROM ${SCHEMA_NAME}.presencas_pendentes
        WHERE resolvido_em IS NULL
        ${treinamentoId ? "AND treinamento_id = $1" : ""}
        ORDER BY criado_em DESC
      `;
      
      const pendingResult = await pool.query<{
        id: number;
        participante_nome: string;
        treinamento_id: string;
        aprovado: boolean;
        tempo_total_minutos: number;
        tempo_dinamica_minutos: number;
        percentual_dinamica: number;
        status: string;
        inscricao_id_1: number | null;
        inscricao_nome_1: string | null;
        inscricao_id_2: number | null;
        inscricao_nome_2: string | null;
        criado_em: string;
        resolvido_em: string | null;
        inscricao_final_id: number | null;
      }>(pendingQuery, treinamentoId ? [treinamentoId] : []);

      pendingRecords = pendingResult.rows.map((row) => ({
        id: row.id,
        participanteNome: row.participante_nome,
        treinamentoId: row.treinamento_id,
        aprovado: row.aprovado,
        tempoTotalMinutos: row.tempo_total_minutos,
        tempoDinamicaMinutos: row.tempo_dinamica_minutos,
        percentualDinamica: row.percentual_dinamica,
        status: row.status as "not-found" | "doubt",
        inscricaoId1: row.inscricao_id_1,
        inscricaoNome1: row.inscricao_nome_1,
        inscricaoId2: row.inscricao_id_2,
        inscricaoNome2: row.inscricao_nome_2,
        criadoEm: row.criado_em,
      }));
    } catch {
      // Tabela pode não existir ainda, ignorar erro
    }

    // Estatísticas
    const totalAprovados = presences.filter((p) => p.aprovado).length;
    const totalReprovados = presences.filter((p) => !p.aprovado).length;

    return NextResponse.json({
      success: true,
      total: presences.length,
      totalAprovados,
      totalReprovados,
      presences,
      pending: pendingRecords,
      totalPending: pendingRecords.length,
    });
  } catch (error) {
    console.error("Erro ao listar presenças:", error);
    return NextResponse.json(
      { error: "Falha ao carregar presenças confirmadas." },
      { status: 500 }
    );
  }
}
