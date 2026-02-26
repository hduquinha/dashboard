import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken, UnauthorizedError } from "@/lib/auth";
import { getPool, loadRecruiterCache, getRecruiterFromCache } from "@/lib/db";
import { getRecruiterByCodeIfNamed } from "@/lib/recruiters";

const SCHEMA_NAME = "inscricoes";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("dashboardToken")?.value;
    assertToken(token);

    const url = new URL(request.url);
    const treinamentoId = url.searchParams.get("treinamento");
    const section = url.searchParams.get("section") || "all"; // "detalhes", "nao-associados", "all"

    if (!treinamentoId) {
      return NextResponse.json({ error: "Treinamento não informado." }, { status: 400 });
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

    // Buscar todas as presenças validadas
    const { rows } = await pool.query<{
      inscricao_id: number;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      treinamento_id: string;
      recrutador_codigo: string | null;
      participante_nome_zoom: string | null;
      tempo_total_minutos: number;
      aprovado: boolean;
      total_dias: number;
      dia_processado: number;
      dia1_aprovado: boolean | null;
      dia2_aprovado: boolean | null;
      dia1_tempo: number | null;
      dia2_tempo: number | null;
    }>(`
      SELECT
        id AS inscricao_id,
        TRIM(COALESCE(NULLIF(TRIM(payload->>'nome'), ''), 'Sem Nome')) AS nome,
        TRIM(payload->>'telefone') AS telefone,
        TRIM(payload->>'cidade') AS cidade,
        ${treinamentoExpr} AS treinamento_id,
        ${recrutadorExpr} AS recrutador_codigo,
        payload->>'presenca_participante_nome' AS participante_nome_zoom,
        COALESCE((payload->>'presenca_tempo_total_minutos')::integer, 0) AS tempo_total_minutos,
        COALESCE((payload->>'presenca_aprovada')::boolean, false) AS aprovado,
        COALESCE((payload->>'presenca_total_dias')::integer, 1) AS total_dias,
        COALESCE((payload->>'presenca_dia_processado')::integer, 1) AS dia_processado,
        (payload->>'presenca_dia1_aprovado')::boolean AS dia1_aprovado,
        (payload->>'presenca_dia2_aprovado')::boolean AS dia2_aprovado,
        (payload->>'presenca_dia1_tempo_total')::integer AS dia1_tempo,
        (payload->>'presenca_dia2_tempo_total')::integer AS dia2_tempo
      FROM ${SCHEMA_NAME}.inscricoes
      WHERE payload->>'presenca_validada' = 'true'
      ORDER BY payload->>'presenca_validada_em' DESC NULLS LAST, id DESC
    `);

    // Filtrar client-side (mesma strategy do TrainingDetailsClient)
    const normalize = (id: string) => {
      let n = id.trim().toLowerCase();
      try { n = decodeURIComponent(n); } catch { /* ok */ }
      return n;
    };
    const targetNorm = normalize(treinamentoId);

    interface PresenceRow {
      inscricao_id: number;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      treinamento_id: string;
      recrutador_codigo: string | null;
      participante_nome_zoom: string | null;
      tempo_total_minutos: number;
      aprovado: boolean;
      total_dias: number;
      dia_processado: number;
      dia1_aprovado: boolean | null;
      dia2_aprovado: boolean | null;
      dia1_tempo: number | null;
      dia2_tempo: number | null;
    }

    const filteredRows = rows.filter((r: PresenceRow) => normalize(r.treinamento_id) === targetNorm);

    await loadRecruiterCache();

    const presences = filteredRows.map((row: PresenceRow) => {
      const recruiterDb = getRecruiterFromCache(row.recrutador_codigo);
      const recruiterStatic = getRecruiterByCodeIfNamed(row.recrutador_codigo);
      const recrutadorNome = recruiterDb?.name ?? recruiterStatic?.name ?? null;
      return {
        ...row,
        recrutador_nome: recrutadorNome,
      };
    });

    // Buscar pendentes
    let pendingRows: Array<{
      id: number;
      participante_nome: string;
      aprovado: boolean;
      tempo_total_minutos: number;
      status: string;
      inscricao_nome_1: string | null;
      inscricao_id_1: number | null;
      inscricao_nome_2: string | null;
      inscricao_id_2: number | null;
    }> = [];
    try {
      const pendingRes = await pool.query<{
        id: number;
        participante_nome: string;
        treinamento_id: string;
        aprovado: boolean;
        tempo_total_minutos: number;
        status: string;
        inscricao_nome_1: string | null;
        inscricao_id_1: number | null;
        inscricao_nome_2: string | null;
        inscricao_id_2: number | null;
      }>(
        `SELECT id, participante_nome, treinamento_id, aprovado, tempo_total_minutos,
                status, inscricao_nome_1, inscricao_id_1, inscricao_nome_2, inscricao_id_2
         FROM ${SCHEMA_NAME}.presencas_pendentes
         WHERE resolvido_em IS NULL
         ORDER BY criado_em DESC`
      );
      pendingRows = pendingRes.rows.filter((r: { treinamento_id: string }) => normalize(r.treinamento_id) === targetNorm);
    } catch {
      // Tabela pode não existir
    }

    type PresenceEntry = typeof presences[number];
    const hasMultiDay = presences.some((p: PresenceEntry) => p.total_dias > 1);
    const totalAprovados = presences.filter((p: PresenceEntry) => p.aprovado).length;
    const totalParciais = presences.filter((p: PresenceEntry) => p.total_dias === 2 && p.dia_processado < 2 && !p.aprovado).length;
    const totalReprovados = presences.filter((p: PresenceEntry) => !p.aprovado && !(p.total_dias === 2 && p.dia_processado < 2)).length;

    const now = new Date();
    const dateStr = `${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR")}`;
    const safeTitle = escapeHtml(treinamentoId);

    const showDetalhes = section === "detalhes" || section === "all";
    const showPending = section === "nao-associados" || section === "all";

    // Gerar status badge (texto)
    function statusLabel(aprovado: boolean, totalDias: number, diaProcessado: number): string {
      if (aprovado) return "✅ Aprovado";
      if (totalDias === 2 && diaProcessado < 2) return "⏳ Parcial";
      return "❌ Reprovado";
    }

    function dia1Label(row: PresenceRow): string {
      if (row.dia1_aprovado === true) return `✅ ${row.dia1_tempo != null ? formatMinutes(row.dia1_tempo) : ""}`;
      if (row.dia1_aprovado === false) return `❌ ${row.dia1_tempo != null ? formatMinutes(row.dia1_tempo) : ""}`;
      return "⏳ Pendente";
    }

    function dia2Label(row: PresenceRow): string {
      if (row.dia2_aprovado === true) return `✅ ${row.dia2_tempo != null ? formatMinutes(row.dia2_tempo) : ""}`;
      if (row.dia2_aprovado === false) return `❌ ${row.dia2_tempo != null ? formatMinutes(row.dia2_tempo) : ""}`;
      return "⏳ Pendente";
    }

    // ========== CONSTRUIR HTML ==========
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presenças - ${safeTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      line-height: 1.4;
      color: #1f2937;
      background: white;
    }

    .header {
      padding: 12px 0;
      border-bottom: 2px solid #2DBDC2;
      margin-bottom: 12px;
    }

    .header h1 {
      font-size: 16px;
      font-weight: bold;
      color: #111827;
      margin-bottom: 4px;
    }

    .header .subtitle {
      font-size: 11px;
      color: #6b7280;
    }

    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .stat-box {
      padding: 8px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      text-align: center;
      min-width: 90px;
    }

    .stat-box .value {
      font-size: 18px;
      font-weight: bold;
    }

    .stat-box .label {
      font-size: 9px;
      color: #6b7280;
      text-transform: uppercase;
    }

    .stat-approved .value { color: #059669; }
    .stat-partial .value { color: #d97706; }
    .stat-rejected .value { color: #dc2626; }
    .stat-pending .value { color: #f59e0b; }
    .stat-total .value { color: #2DBDC2; }

    .section-title {
      font-size: 13px;
      font-weight: bold;
      color: #111827;
      margin: 16px 0 8px 0;
      padding-bottom: 4px;
      border-bottom: 1px solid #e5e7eb;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
      margin-bottom: 16px;
    }

    th, td {
      padding: 4px 6px;
      text-align: left;
      border: 1px solid #d1d5db;
    }

    th {
      background-color: #f3f4f6;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 8px;
      color: #374151;
    }

    tr:nth-child(even) { background-color: #f9fafb; }
    tr { page-break-inside: avoid; }

    .text-center { text-align: center; }

    .badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 600;
    }

    .badge-approved { background: #d1fae5; color: #065f46; }
    .badge-partial { background: #fef3c7; color: #92400e; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    .badge-not-found { background: #fee2e2; color: #991b1b; }
    .badge-doubt { background: #fef3c7; color: #92400e; }

    .footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
      font-size: 8px;
      color: #9ca3af;
      text-align: center;
    }

    @media print {
      @page {
        size: A4 landscape;
        margin: 8mm;
      }

      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .print-btn { display: none !important; }

      /* Repetir cabeçalho em todas as páginas */
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    }

    @media screen {
      body {
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
      }

      .print-btn {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #2DBDC2;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        z-index: 100;
      }

      .print-btn:hover { background: #1a9a9e; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimir / PDF</button>

  <div class="header">
    <h1>Relatório de Presenças — ${safeTitle}</h1>
    <p class="subtitle">${presences.length} presenças confirmadas${pendingRows.length > 0 ? ` • ${pendingRows.length} não associados` : ""} • Gerado em ${dateStr}</p>
  </div>

  <div class="stats">
    <div class="stat-box stat-total">
      <div class="value">${presences.length}</div>
      <div class="label">Total</div>
    </div>
    <div class="stat-box stat-approved">
      <div class="value">${totalAprovados}</div>
      <div class="label">Aprovados</div>
    </div>
    ${totalParciais > 0 ? `
    <div class="stat-box stat-partial">
      <div class="value">${totalParciais}</div>
      <div class="label">Parciais</div>
    </div>` : ""}
    <div class="stat-box stat-rejected">
      <div class="value">${totalReprovados}</div>
      <div class="label">Reprovados</div>
    </div>
    ${pendingRows.length > 0 ? `
    <div class="stat-box stat-pending">
      <div class="value">${pendingRows.length}</div>
      <div class="label">Não Associados</div>
    </div>` : ""}
  </div>

  ${showDetalhes ? `
  <h2 class="section-title">📋 Presenças Detalhadas</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Nome</th>
        <th>Nome Zoom</th>
        <th>Cidade</th>
        <th>Recrutador</th>
        ${hasMultiDay ? `<th class="text-center">Dia 1</th><th class="text-center">Dia 2</th>` : `<th class="text-center">Tempo</th>`}
        <th class="text-center">Status</th>
      </tr>
    </thead>
    <tbody>
      ${presences.map((p: PresenceEntry, i: number) => {
        const isPartial = p.total_dias === 2 && p.dia_processado < 2;
        const badgeClass = p.aprovado ? "badge-approved" : isPartial ? "badge-partial" : "badge-rejected";
        return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.nome)}</td>
        <td>${p.participante_nome_zoom ? escapeHtml(p.participante_nome_zoom) : "—"}</td>
        <td>${p.cidade ? escapeHtml(p.cidade) : "—"}</td>
        <td>${p.recrutador_nome ? escapeHtml(p.recrutador_nome) : (p.recrutador_codigo ? escapeHtml(p.recrutador_codigo) : "—")}</td>
        ${hasMultiDay ? `<td class="text-center">${dia1Label(p)}</td><td class="text-center">${dia2Label(p)}</td>` : `<td class="text-center">${formatMinutes(p.tempo_total_minutos)}</td>`}
        <td class="text-center"><span class="badge ${badgeClass}">${statusLabel(p.aprovado, p.total_dias, p.dia_processado)}</span></td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>
  ` : ""}

  ${showPending && pendingRows.length > 0 ? `
  <h2 class="section-title">⚠️ Participantes Não Associados</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Nome no Zoom</th>
        <th class="text-center">Tempo Total</th>
        <th class="text-center">Presença</th>
        <th class="text-center">Status</th>
        <th>Sugestões</th>
      </tr>
    </thead>
    <tbody>
      ${pendingRows.map((p: typeof pendingRows[number], i: number) => {
        const badgeClass = p.status === "not-found" ? "badge-not-found" : "badge-doubt";
        const statusText = p.status === "not-found" ? "Não encontrado" : "Dúvida";
        const suggestions: string[] = [];
        if (p.inscricao_nome_1) suggestions.push(`${escapeHtml(p.inscricao_nome_1)}${p.inscricao_id_1 ? ` (#${p.inscricao_id_1})` : ""}`);
        if (p.inscricao_nome_2) suggestions.push(`${escapeHtml(p.inscricao_nome_2)}${p.inscricao_id_2 ? ` (#${p.inscricao_id_2})` : ""}`);
        return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.participante_nome)}</td>
        <td class="text-center">${formatMinutes(p.tempo_total_minutos)}</td>
        <td class="text-center">${p.aprovado ? "✅ OK" : "❌ Insuficiente"}</td>
        <td class="text-center"><span class="badge ${badgeClass}">${statusText}</span></td>
        <td>${suggestions.length > 0 ? suggestions.join("; ") : "<em>Sem sugestões</em>"}</td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>
  ` : ""}

  ${showPending && pendingRows.length === 0 ? `
  <h2 class="section-title">⚠️ Participantes Não Associados</h2>
  <p style="padding: 12px 0; color: #6b7280;">Todos os participantes do Zoom foram associados a inscrições. ✅</p>
  ` : ""}

  <div class="footer">
    Dashboard de Treinamentos — Relatório gerado automaticamente em ${dateStr}
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
    };
  </script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Presence print error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
