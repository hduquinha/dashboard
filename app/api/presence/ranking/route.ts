import { NextRequest, NextResponse } from "next/server";
import { getPool, loadRecruiterCache, getRecruiterFromCache } from "@/lib/db";
import { getRecruiterByCodeIfNamed } from "@/lib/recruiters";

const SCHEMA_NAME = "inscricoes";

/**
 * GET /api/presence/ranking?treinamento=...
 *
 * Returns individual presence records ranked by presence on the
 * DINÂMICA DAY. For multi-day trainings we detect which day had the
 * dinâmica (via presenca_dinamica_dias / presenca_dia{N}_tem_dinamica)
 * and use that day's data. People who were present on the dinâmica day
 * come first, ordered by time on that day.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const treinamentoId = searchParams.get("treinamento");

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "Parâmetro 'treinamento' é obrigatório." },
        { status: 400 }
      );
    }

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

    const recrutadorExpr = `TRIM(COALESCE(
      NULLIF(TRIM(payload->>'traffic_source'), ''),
      NULLIF(TRIM(payload->>'source'), ''),
      NULLIF(TRIM(payload->>'recrutador'), ''),
      NULLIF(TRIM(payload->>'recrutador_codigo'), ''),
      NULLIF(TRIM(payload->>'recruiter_code'), '')
    ))`;

    // Fetch all presence-validated records for this training, with per-day fields
    const query = `
      SELECT
        id AS inscricao_id,
        TRIM(COALESCE(NULLIF(TRIM(payload->>'nome'), ''), 'Sem Nome')) AS nome,
        TRIM(payload->>'telefone') AS telefone,
        TRIM(payload->>'cidade') AS cidade,
        TRIM(payload->>'email') AS email,
        ${treinamentoExpr} AS treinamento_id,
        ${recrutadorExpr} AS recrutador_codigo,
        payload->>'presenca_participante_nome' AS participante_nome_zoom,
        -- Top-level (single-day or aggregated)
        COALESCE((payload->>'presenca_tempo_total_minutos')::integer, 0) AS tempo_total_minutos,
        COALESCE((payload->>'presenca_tempo_dinamica_minutos')::integer, 0) AS tempo_dinamica_minutos,
        COALESCE((payload->>'presenca_percentual_dinamica')::integer, 0) AS percentual_dinamica,
        COALESCE((payload->>'presenca_aprovada')::boolean, false) AS aprovado,
        payload->>'presenca_validada_em' AS validado_em,
        -- Multi-day metadata
        COALESCE((payload->>'presenca_total_dias')::integer, 1) AS total_dias,
        COALESCE((payload->>'presenca_dia_processado')::integer, 1) AS dia_processado,
        payload->>'presenca_dinamica_dias' AS dinamica_dias,
        -- Day 1 fields
        (payload->>'presenca_dia1_tem_dinamica')::boolean AS dia1_tem_dinamica,
        (payload->>'presenca_dia1_aprovado')::boolean AS dia1_aprovado,
        COALESCE((payload->>'presenca_dia1_tempo_total')::integer, 0) AS dia1_tempo_total,
        COALESCE((payload->>'presenca_dia1_tempo_dinamica')::integer, 0) AS dia1_tempo_dinamica,
        COALESCE((payload->>'presenca_dia1_percentual_dinamica')::integer, 0) AS dia1_percentual_dinamica,
        -- Day 2 fields
        (payload->>'presenca_dia2_tem_dinamica')::boolean AS dia2_tem_dinamica,
        (payload->>'presenca_dia2_aprovado')::boolean AS dia2_aprovado,
        COALESCE((payload->>'presenca_dia2_tempo_total')::integer, 0) AS dia2_tempo_total,
        COALESCE((payload->>'presenca_dia2_tempo_dinamica')::integer, 0) AS dia2_tempo_dinamica,
        COALESCE((payload->>'presenca_dia2_percentual_dinamica')::integer, 0) AS dia2_percentual_dinamica,
        -- Single-day tem_dinamica
        (payload->>'presenca_tem_dinamica')::boolean AS tem_dinamica
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE payload->>'presenca_validada' = 'true'
        AND ${treinamentoExpr} = $1
      ORDER BY id
    `;

    const { rows } = await pool.query(query, [treinamentoId]);

    await loadRecruiterCache();

    // ── Detect which day had the dinâmica ───────────────

    // Heuristic: look at the first record to determine dinâmica day for this training
    let dinamicaDay: "day1" | "day2" | "both" | "single" | "none" = "single";

    if (rows.length > 0) {
      const sample = rows[0];
      const totalDias = sample.total_dias ?? 1;
      const dinamicaDiasField = sample.dinamica_dias as string | null;

      if (totalDias >= 2) {
        if (dinamicaDiasField === "day1") dinamicaDay = "day1";
        else if (dinamicaDiasField === "day2") dinamicaDay = "day2";
        else if (dinamicaDiasField === "both") dinamicaDay = "both";
        else if (dinamicaDiasField === "none") dinamicaDay = "none";
        else {
          // Fallback: check per-record flags
          if (sample.dia1_tem_dinamica && !sample.dia2_tem_dinamica) dinamicaDay = "day1";
          else if (!sample.dia1_tem_dinamica && sample.dia2_tem_dinamica) dinamicaDay = "day2";
          else if (sample.dia1_tem_dinamica && sample.dia2_tem_dinamica) dinamicaDay = "both";
          else dinamicaDay = "none";
        }
      }
    }

    // ── Build ranking entries ───────────────────────────

    interface RankingEntry {
      inscricaoId: number;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      email: string | null;
      recrutadorCodigo: string | null;
      recrutadorNome: string | null;
      participanteNomeZoom: string | null;
      // Dia da dinâmica
      presenteNaDinamica: boolean;
      tempoDinamicaDiaMinutos: number;
      tempoTotalDiaMinutos: number;
      percentualDinamicaDia: number;
      // Geral (todos os dias)
      tempoTotalGeralMinutos: number;
      tempoDinamicaGeralMinutos: number;
      aprovado: boolean;
      validadoEm: string | null;
      totalDias: number;
      dinamicaDay: string;
    }

    const ranking: RankingEntry[] = rows.map((row: Record<string, unknown>) => {
      const recruiterDb = getRecruiterFromCache(row.recrutador_codigo as string | null);
      const recruiterStatic = getRecruiterByCodeIfNamed(row.recrutador_codigo as string | null);
      const recrutadorNome = recruiterDb?.name ?? recruiterStatic?.name ?? null;

      const totalDias = (row.total_dias as number) ?? 1;

      // Determine dinâmica-day-specific metrics
      let tempoDinamicaDia = 0;
      let tempoTotalDia = 0;
      let percentualDia = 0;
      let presenteNaDinamica = false;

      if (totalDias === 1 || dinamicaDay === "single") {
        // Single-day training: use top-level data
        tempoDinamicaDia = (row.tempo_dinamica_minutos as number) ?? 0;
        tempoTotalDia = (row.tempo_total_minutos as number) ?? 0;
        percentualDia = (row.percentual_dinamica as number) ?? 0;
        presenteNaDinamica = tempoTotalDia > 0;
      } else if (dinamicaDay === "day1") {
        tempoDinamicaDia = (row.dia1_tempo_dinamica as number) ?? 0;
        tempoTotalDia = (row.dia1_tempo_total as number) ?? 0;
        percentualDia = (row.dia1_percentual_dinamica as number) ?? 0;
        presenteNaDinamica = tempoTotalDia > 0;
      } else if (dinamicaDay === "day2") {
        tempoDinamicaDia = (row.dia2_tempo_dinamica as number) ?? 0;
        tempoTotalDia = (row.dia2_tempo_total as number) ?? 0;
        percentualDia = (row.dia2_percentual_dinamica as number) ?? 0;
        presenteNaDinamica = tempoTotalDia > 0;
      } else if (dinamicaDay === "both") {
        // Both days had dinâmica — sum both
        const d1 = (row.dia1_tempo_dinamica as number) ?? 0;
        const d2 = (row.dia2_tempo_dinamica as number) ?? 0;
        tempoDinamicaDia = d1 + d2;
        tempoTotalDia = ((row.dia1_tempo_total as number) ?? 0) + ((row.dia2_tempo_total as number) ?? 0);
        percentualDia = Math.round(tempoTotalDia > 0 ? (tempoDinamicaDia / tempoTotalDia) * 100 : 0);
        presenteNaDinamica = tempoTotalDia > 0;
      } else {
        // No dinâmica day: fallback to general
        tempoDinamicaDia = (row.tempo_dinamica_minutos as number) ?? 0;
        tempoTotalDia = (row.tempo_total_minutos as number) ?? 0;
        percentualDia = (row.percentual_dinamica as number) ?? 0;
        presenteNaDinamica = tempoTotalDia > 0;
      }

      return {
        inscricaoId: row.inscricao_id as number,
        nome: row.nome as string,
        telefone: row.telefone as string | null,
        cidade: row.cidade as string | null,
        email: row.email as string | null,
        recrutadorCodigo: row.recrutador_codigo as string | null,
        recrutadorNome,
        participanteNomeZoom: row.participante_nome_zoom as string | null,
        presenteNaDinamica,
        tempoDinamicaDiaMinutos: tempoDinamicaDia,
        tempoTotalDiaMinutos: tempoTotalDia,
        percentualDinamicaDia: percentualDia,
        tempoTotalGeralMinutos: (row.tempo_total_minutos as number) ?? 0,
        tempoDinamicaGeralMinutos: (row.tempo_dinamica_minutos as number) ?? 0,
        aprovado: (row.aprovado as boolean) ?? false,
        validadoEm: row.validado_em as string | null,
        totalDias,
        dinamicaDay: dinamicaDay,
      };
    });

    // ── Sort: present on dinâmica day first, then by time on that day ──
    ranking.sort((a, b) => {
      // 1. Present on dinâmica day first
      if (a.presenteNaDinamica !== b.presenteNaDinamica) {
        return a.presenteNaDinamica ? -1 : 1;
      }
      // 2. By time on dinâmica day (descending)
      if (b.tempoTotalDiaMinutos !== a.tempoTotalDiaMinutos) {
        return b.tempoTotalDiaMinutos - a.tempoTotalDiaMinutos;
      }
      // 3. By dinâmica time on that day
      if (b.tempoDinamicaDiaMinutos !== a.tempoDinamicaDiaMinutos) {
        return b.tempoDinamicaDiaMinutos - a.tempoDinamicaDiaMinutos;
      }
      // 4. Alpha
      return a.nome.localeCompare(b.nome);
    });

    // Which day label to show
    let dinamicaDayLabel = "Dia Único";
    if (dinamicaDay === "day1") dinamicaDayLabel = "Dia 1";
    else if (dinamicaDay === "day2") dinamicaDayLabel = "Dia 2";
    else if (dinamicaDay === "both") dinamicaDayLabel = "Ambos os Dias";
    else if (dinamicaDay === "none") dinamicaDayLabel = "Sem Dinâmica";

    return NextResponse.json({
      success: true,
      total: ranking.length,
      totalPresentesDinamica: ranking.filter((r) => r.presenteNaDinamica).length,
      dinamicaDay,
      dinamicaDayLabel,
      ranking,
    });
  } catch (error) {
    console.error("Erro ao gerar ranking:", error);
    return NextResponse.json(
      { error: "Falha ao gerar ranking de presença." },
      { status: 500 }
    );
  }
}
