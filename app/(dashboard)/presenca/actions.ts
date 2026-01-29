"use server";

import {
  parseZoomCSV,
  consolidateParticipants,
  processPresenceValidation,
  detectEndTime,
} from "@/lib/zoomPresence";
import { getPool } from "@/lib/db";
import type { PresenceConfig, PresenceValidationResult, PresenceFormState } from "@/types/presence";
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
  // Formato ISO: 2026-01-07T19:00:00-03:00
  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }
  
  // Formato BR: 07/01/2026
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

  // Extrai a data base para busca mais flexível
  const dateBase = extractDateFromTraining(treinamentoId);
  
  // Campos onde o treinamento pode estar armazenado
  const trainingFields = [
    "i.payload->>'treinamento'",
    "i.payload->>'training'",
    "i.payload->>'training_date'",
    "i.payload->>'trainingDate'",
    "i.payload->>'data_treinamento'",
  ];
  
  // Monta as condições de busca para cada campo
  const conditions: string[] = [];
  const params: string[] = [];
  let paramIndex = 1;

  for (const field of trainingFields) {
    // Busca exata
    conditions.push(`${field} = $${paramIndex}`);
    params.push(treinamentoId);
    paramIndex++;

    // Busca por LIKE com o ID completo
    conditions.push(`${field} LIKE $${paramIndex}`);
    params.push(`%${treinamentoId}%`);
    paramIndex++;

    // Se temos uma data base, busca também por ela
    if (dateBase) {
      conditions.push(`${field} LIKE $${paramIndex}`);
      params.push(`%${dateBase}%`);
      paramIndex++;
      
      // Formato BR da data
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

/**
 * Action para processar o CSV do Zoom e validar presença
 */
export async function processPresenceAction(
  prevState: PresenceFormState,
  formData: FormData
): Promise<PresenceFormState> {
  try {
    // Extrai dados do formulário
    const file = formData.get("csvFile") as File | null;
    const treinamentoId = formData.get("treinamentoId") as string;
    const inicioLiveStr = formData.get("inicioLive") as string;
    const inicioDinamicaStr = formData.get("inicioDinamica") as string;
    const fimDinamicaStr = formData.get("fimDinamica") as string;
    const tempoMinimoStr = formData.get("tempoMinimo") as string;
    const percentualMinimoStr = formData.get("percentualMinimo") as string;
    const excluirNomesStr = formData.get("excluirNomes") as string;

    // Validações básicas
    if (!file || file.size === 0) {
      return {
        status: "error",
        message: "Selecione um arquivo CSV do Zoom.",
        result: null,
        filename: null,
      };
    }

    if (!treinamentoId) {
      return {
        status: "error",
        message: "Selecione um treinamento.",
        result: null,
        filename: file.name,
      };
    }

    if (!inicioLiveStr || !inicioDinamicaStr || !fimDinamicaStr) {
      return {
        status: "error",
        message: "Preencha todos os horários obrigatórios.",
        result: null,
        filename: file.name,
      };
    }

    // Parse do arquivo CSV
    const csvContent = await file.text();
    const rawParticipants = parseZoomCSV(csvContent);

    if (rawParticipants.length === 0) {
      return {
        status: "error",
        message: "Nenhum participante encontrado no CSV.",
        result: null,
        filename: file.name,
      };
    }

    // Consolida participantes (excluindo equipe)
    const excludeNames = excluirNomesStr
      ? excluirNomesStr.split(/[,\n]/).map((n) => n.trim()).filter(Boolean)
      : [];
    const consolidated = consolidateParticipants(rawParticipants, excludeNames);

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
      return {
        status: "error",
        message: `Nenhuma inscrição encontrada para o treinamento "${treinamentoId}".`,
        result: null,
        filename: file.name,
      };
    }

    // Processa validação
    const result = processPresenceValidation(consolidated, inscricoes, config);

    return {
      status: "success",
      message: `Processados ${result.totalConsolidados} participantes. ${result.resumo.totalAprovados} aprovados, ${result.resumo.totalReprovados} reprovados.`,
      result,
      filename: file.name,
    };
  } catch (error) {
    console.error("Erro ao processar presença:", error);
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao processar arquivo.",
      result: null,
      filename: null,
    };
  }
}

/**
 * Action para confirmar associações e salvar no banco
 */
export async function confirmPresenceAction(
  associations: Array<{
    inscricaoId: number;
    participanteNome: string;
    aprovado: boolean;
    tempoTotal: number;
    tempoDinamica: number;
    percentualDinamica: number;
  }>,
  treinamentoId: string
): Promise<{ success: boolean; message: string; savedCount: number }> {
  try {
    const pool = getPool();
    let savedCount = 0;

    for (const assoc of associations) {
      if (!assoc.inscricaoId) continue;

      // Atualiza o payload da inscrição com informações de presença
      const presenceData = {
        presenca_validada: true,
        presenca_aprovada: assoc.aprovado,
        presenca_participante_nome: assoc.participanteNome,
        presenca_tempo_total_minutos: assoc.tempoTotal,
        presenca_tempo_dinamica_minutos: assoc.tempoDinamica,
        presenca_percentual_dinamica: assoc.percentualDinamica,
        presenca_treinamento_id: treinamentoId,
        presenca_validada_em: new Date().toISOString(),
      };

      await pool.query(
        `UPDATE ${SCHEMA_NAME}.inscricoes 
         SET payload = payload || $1::jsonb 
         WHERE id = $2`,
        [JSON.stringify(presenceData), assoc.inscricaoId]
      );

      savedCount++;
    }

    return {
      success: true,
      message: `${savedCount} associações salvas com sucesso.`,
      savedCount,
    };
  } catch (error) {
    console.error("Erro ao salvar associações:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Erro ao salvar.",
      savedCount: 0,
    };
  }
}
