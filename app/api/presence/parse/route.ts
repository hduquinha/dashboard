import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { getPool, listInscricoes } from "@/lib/db";
import {
  analyzePresence,
  consolidateParticipants,
  detectEndTime,
  matchParticipantsToInscricoes,
  parseZoomCSV,
} from "@/lib/zoomPresence";
import type { InscricaoSimplificada, PresenceConfig } from "@/types/presence";

const SCHEMA_NAME = "inscricoes";

function parsePositiveInteger(value: FormDataEntryValue | null, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadInscricoesForTraining(treinamentoId: string) {
  const { data } = await listInscricoes({
    page: 1,
    pageSize: 10000,
    filters: {
      treinamento: treinamentoId,
    },
  });

  return data;
}

async function loadExistingDay1(treinamentoId: string) {
  const pool = getPool();
  const { rows } = await pool.query<{ id: number; payload: Record<string, unknown> }>(
    `SELECT id, payload
     FROM ${SCHEMA_NAME}.inscricoes
     WHERE LOWER(TRIM(COALESCE(payload->>'presenca_validada', ''))) IN ('true', '1', 'sim', 'yes')
       AND COALESCE(NULLIF(TRIM(payload->>'presenca_treinamento_id'), ''), NULLIF(TRIM(payload->>'treinamento'), '')) = $1
       AND COALESCE(NULLIF(payload->>'presenca_dia_processado', '')::int, 1) >= 1`,
    [treinamentoId]
  );

  const existing: Record<number, { aprovado: boolean; tempoTotal: number; participanteNome: string }> = {};
  for (const row of rows) {
    existing[row.id] = {
      aprovado: row.payload.presenca_dia1_aprovado === true || row.payload.presenca_dia1_aprovado === "true",
      tempoTotal:
        typeof row.payload.presenca_dia1_tempo_total === "number"
          ? row.payload.presenca_dia1_tempo_total
          : Number.parseInt(String(row.payload.presenca_dia1_tempo_total ?? "0"), 10) || 0,
      participanteNome:
        typeof row.payload.presenca_dia1_participante_nome === "string"
          ? row.payload.presenca_dia1_participante_nome
          : "",
    };
  }

  return Object.keys(existing).length > 0 ? existing : null;
}

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("csvFile");
    const treinamentoId = typeof formData.get("treinamentoId") === "string" ? String(formData.get("treinamentoId")) : "";
    const inicioLiveStr = typeof formData.get("inicioLive") === "string" ? String(formData.get("inicioLive")) : "";
    const inicioDinamicaStr =
      typeof formData.get("inicioDinamica") === "string" ? String(formData.get("inicioDinamica")) : "";
    const fimDinamicaStr =
      typeof formData.get("fimDinamica") === "string" ? String(formData.get("fimDinamica")) : "";
    const totalDays = parsePositiveInteger(formData.get("totalDays"), 1);
    const currentDay = parsePositiveInteger(formData.get("currentDay"), 1);
    const hasDinamica = formData.get("hasDinamica") === "true";
    const dinamicaDays = String(formData.get("dinamicaDays") ?? (hasDinamica ? "both" : "none")) as PresenceConfig["dinamicaDays"];

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Selecione um arquivo CSV do Zoom." }, { status: 400 });
    }

    if (!treinamentoId.trim()) {
      return NextResponse.json({ error: "Selecione um treinamento." }, { status: 400 });
    }

    if (!inicioLiveStr) {
      return NextResponse.json({ error: `Preencha o horario de inicio da live (Dia ${currentDay}).` }, { status: 400 });
    }

    if (hasDinamica && (!inicioDinamicaStr || !fimDinamicaStr)) {
      return NextResponse.json({ error: `Preencha os horarios da dinamica (Dia ${currentDay}).` }, { status: 400 });
    }

    const csvContent = await file.text();
    const rawParticipants = parseZoomCSV(csvContent);
    if (rawParticipants.length === 0) {
      return NextResponse.json({ error: `Nenhum participante encontrado no CSV (Dia ${currentDay}).` }, { status: 400 });
    }

    const consolidated = consolidateParticipants(rawParticipants, []);
    const inicioLive = new Date(inicioLiveStr);
    const fimLive = detectEndTime(rawParticipants) ?? inicioLive;
    const inicioDinamica = hasDinamica ? new Date(inicioDinamicaStr) : undefined;
    const fimDinamica = hasDinamica ? new Date(fimDinamicaStr) : undefined;

    const config: PresenceConfig = {
      treinamentoId,
      inicioLive,
      fimLive,
      hasDinamica,
      inicioDinamica,
      fimDinamica,
      tempoMinimoMinutos: parsePositiveInteger(formData.get("tempoMinimo"), 60),
      percentualMinimoDinamica: parsePositiveInteger(formData.get("percentualMinimo"), 90),
      totalDays,
      currentDay,
      dinamicaDays,
    };

    const inscricoes = await loadInscricoesForTraining(treinamentoId);
    if (inscricoes.length === 0) {
      return NextResponse.json(
        { error: `Nenhuma inscricao encontrada para o treinamento "${treinamentoId}".` },
        { status: 400 }
      );
    }

    const participants = consolidated.map((participante) => ({
      participante,
      analise: analyzePresence(participante, config),
    }));

    const inscricoesDisponiveis: InscricaoSimplificada[] = inscricoes.map((inscricao) => ({
      id: inscricao.id,
      nome: inscricao.nome ?? `Inscricao #${inscricao.id}`,
      telefone: inscricao.telefone,
      cidade: inscricao.cidade,
      recrutadorCodigo: inscricao.recrutadorCodigo,
    }));

    return NextResponse.json({
      participants,
      config,
      autoMatches: matchParticipantsToInscricoes(consolidated, inscricoes),
      inscricoesDisponiveis,
      filename: file.name,
      totalRaw: rawParticipants.length,
      totalConsolidated: consolidated.length,
      existingDay1: currentDay === 2 && totalDays === 2 ? await loadExistingDay1(treinamentoId) : null,
    });
  } catch (error) {
    console.error("Erro ao processar CSV:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao processar arquivo." },
      { status: 500 }
    );
  }
}
