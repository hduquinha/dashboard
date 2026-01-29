import { NextRequest, NextResponse } from "next/server";
import {
  parseZoomCSV,
  consolidateParticipants,
  analyzePresence,
  matchParticipantsToInscricoes,
  detectEndTime,
} from "@/lib/zoomPresence";
import { getPool } from "@/lib/db";
import type { PresenceConfig, InscricaoSimplificada } from "@/types/presence";
import type { InscricaoItem } from "@/types/inscricao";
import { parsePayload } from "@/lib/parsePayload";

const SCHEMA_NAME = "inscricoes";

interface InscricaoDbRow {
  id: number;
  payload: Record<string, unknown>;
  criado_em: Date | string;
  nome: string | null;
  telefone: string | null;
  cidade: string | null;
  profissao: string | null;
  treinamento: string | null;
  traffic_source: string | null;
}

/**
 * Extrai a data base (YYYY-MM-DD) de um valor de treinamento
 */
function extractDateFromTraining(value: string): string | null {
  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }
  
  const brMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }
  
  return null;
}

/**
 * Busca inscrições de um treinamento específico
 */
async function getInscricoesByTreinamento(treinamentoId: string): Promise<InscricaoItem[]> {
  const pool = getPool();

  const dateBase = extractDateFromTraining(treinamentoId);
  
  const trainingFields = [
    "i.payload->>'treinamento'",
    "i.payload->>'training'",
    "i.payload->>'training_date'",
    "i.payload->>'trainingDate'",
    "i.payload->>'data_treinamento'",
  ];
  
  const conditions: string[] = [];
  const params: string[] = [];
  let paramIndex = 1;

  for (const field of trainingFields) {
    conditions.push(`${field} = $${paramIndex}`);
    params.push(treinamentoId);
    paramIndex++;

    conditions.push(`${field} LIKE $${paramIndex}`);
    params.push(`%${treinamentoId}%`);
    paramIndex++;

    if (dateBase) {
      conditions.push(`${field} LIKE $${paramIndex}`);
      params.push(`%${dateBase}%`);
      paramIndex++;
      
      const [year, month, day] = dateBase.split('-');
      const brDate = `${day}/${month}/${year}`;
      conditions.push(`${field} LIKE $${paramIndex}`);
      params.push(`%${brDate}%`);
      paramIndex++;
    }
  }

  const query = `
    SELECT 
      i.id,
      i.payload,
      i.criado_em,
      i.payload->>'nome' AS nome,
      i.payload->>'telefone' AS telefone,
      i.payload->>'cidade' AS cidade,
      i.payload->>'profissao' AS profissao,
      COALESCE(
        NULLIF(TRIM(i.payload->>'treinamento'), ''),
        NULLIF(TRIM(i.payload->>'training'), ''),
        NULLIF(TRIM(i.payload->>'training_date'), ''),
        NULLIF(TRIM(i.payload->>'trainingDate'), ''),
        NULLIF(TRIM(i.payload->>'data_treinamento'), '')
      ) AS treinamento,
      i.payload->>'traffic_source' AS traffic_source
    FROM ${SCHEMA_NAME}.inscricoes i
    WHERE ${conditions.join(' OR ')}
    ORDER BY i.criado_em DESC
  `;

  const { rows } = await pool.query<InscricaoDbRow>(query, params);

  return rows.map((row: InscricaoDbRow) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const parsed = parsePayload(payload);

    return {
      id: Number(row.id),
      payload,
      criadoEm: row.criado_em instanceof Date 
        ? row.criado_em.toISOString() 
        : new Date(row.criado_em as string).toISOString(),
      parsedPayload: parsed,
      nome: row.nome ?? null,
      telefone: row.telefone ?? null,
      cidade: row.cidade ?? null,
      profissao: row.profissao ?? null,
      recrutadorCodigo: null,
      recrutadorNome: null,
      recrutadorUrl: null,
      treinamentoId: row.treinamento ?? null,
      treinamentoNome: null,
      treinamentoData: null,
    } as InscricaoItem;
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const file = formData.get("csvFile") as File | null;
    const treinamentoId = formData.get("treinamentoId") as string;
    const inicioLiveStr = formData.get("inicioLive") as string;
    const inicioDinamicaStr = formData.get("inicioDinamica") as string;
    const fimDinamicaStr = formData.get("fimDinamica") as string;
    const tempoMinimoStr = formData.get("tempoMinimo") as string;
    const percentualMinimoStr = formData.get("percentualMinimo") as string;

    // Validações
    if (!file || file.size === 0) {
      return NextResponse.json(
        { error: "Selecione um arquivo CSV do Zoom." },
        { status: 400 }
      );
    }

    if (!treinamentoId) {
      return NextResponse.json(
        { error: "Selecione um treinamento." },
        { status: 400 }
      );
    }

    if (!inicioLiveStr || !inicioDinamicaStr || !fimDinamicaStr) {
      return NextResponse.json(
        { error: "Preencha todos os horários obrigatórios." },
        { status: 400 }
      );
    }

    // Parse do CSV
    const csvContent = await file.text();
    const rawParticipants = parseZoomCSV(csvContent);

    if (rawParticipants.length === 0) {
      return NextResponse.json(
        { error: "Nenhum participante encontrado no CSV." },
        { status: 400 }
      );
    }

    // Consolida participantes (sem excluir ninguém - isso é feito manualmente no passo 2)
    const consolidated = consolidateParticipants(rawParticipants, []);

    // Parse das datas
    const inicioLive = new Date(inicioLiveStr);
    const inicioDinamica = new Date(inicioDinamicaStr);
    const fimDinamica = new Date(fimDinamicaStr);
    const fimLive = detectEndTime(rawParticipants) || fimDinamica;

    // Configuração
    const config: PresenceConfig = {
      treinamentoId,
      inicioLive,
      fimLive,
      inicioDinamica,
      fimDinamica,
      tempoMinimoMinutos: tempoMinimoStr ? parseInt(tempoMinimoStr, 10) : 60,
      percentualMinimoDinamica: percentualMinimoStr ? parseInt(percentualMinimoStr, 10) : 90,
    };

    // Busca inscrições do treinamento
    const inscricoes = await getInscricoesByTreinamento(treinamentoId);

    if (inscricoes.length === 0) {
      return NextResponse.json(
        { error: `Nenhuma inscrição encontrada para o treinamento "${treinamentoId}".` },
        { status: 400 }
      );
    }

    // Analisa presença de cada participante
    const participants = consolidated.map(participante => ({
      participante,
      analise: analyzePresence(participante, config),
    }));

    // Faz auto-match de participantes com inscrições
    const autoMatches = matchParticipantsToInscricoes(
      consolidated,
      inscricoes
    );

    // Prepara inscrições disponíveis para seleção manual
    const inscricoesDisponiveis: InscricaoSimplificada[] = inscricoes.map(i => ({
      id: i.id,
      nome: i.nome || "Sem nome",
      telefone: i.telefone,
      cidade: i.cidade,
    }));

    return NextResponse.json({
      participants,
      config,
      autoMatches,
      inscricoesDisponiveis,
      filename: file.name,
      totalRaw: rawParticipants.length,
      totalConsolidated: consolidated.length,
    });
  } catch (error) {
    console.error("Erro ao processar CSV:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao processar arquivo." },
      { status: 500 }
    );
  }
}
