import { getInscricaoById, getPool, listPresenceInscricoes } from "@/lib/db";
import type { InscricaoItem, PresencaDia } from "@/types/inscricao";

const SCHEMA_NAME = "inscricoes";

export interface PresenceRecord {
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
  totalDias: number;
  diaProcessado: number;
  dinamicaDias: string | null;
  dia1Aprovado: boolean | null;
  dia2Aprovado: boolean | null;
  dia1Tempo: number | null;
  dia2Tempo: number | null;
  dia1TempoDinamica: number | null;
  dia2TempoDinamica: number | null;
  dia1PercentualDinamica: number | null;
  dia2PercentualDinamica: number | null;
  dia1TemDinamica: boolean | null;
  dia2TemDinamica: boolean | null;
}

export interface PendingPresenceRecord {
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
  inscricaoTelefone1: string | null;
  inscricaoId2: number | null;
  inscricaoNome2: string | null;
  inscricaoTelefone2: string | null;
  criadoEm: string;
}

export interface PresenceListResult {
  presences: PresenceRecord[];
  pending: PendingPresenceRecord[];
  total: number;
  totalAprovados: number;
  totalReprovados: number;
  totalParciais: number;
  totalPending: number;
}

export interface PresenceRankingRecord {
  inscricaoId: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  email: string | null;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  participanteNomeZoom: string | null;
  presenteNaDinamica: boolean;
  tempoDinamicaDiaMinutos: number;
  tempoTotalDiaMinutos: number;
  percentualDinamicaDia: number;
  tempoTotalGeralMinutos: number;
  tempoDinamicaGeralMinutos: number;
  aprovado: boolean;
  validadoEm: string | null;
  totalDias: number;
  dinamicaDay: string;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getEmail(inscricao: InscricaoItem): string | null {
  return inscricao.upDay.email ?? asText(inscricao.parsedPayload.email) ?? asText(inscricao.payload?.email);
}

function dayBoolean(day: PresencaDia | null | undefined): boolean | null {
  return typeof day?.aprovado === "boolean" ? day.aprovado : null;
}

function getPresenceTrainingId(inscricao: InscricaoItem): string {
  return asText(inscricao.payload?.presenca_treinamento_id) ?? inscricao.treinamentoId ?? "Sem Treinamento";
}

export function buildPresenceRecord(inscricao: InscricaoItem): PresenceRecord {
  const dia1 = inscricao.presencaDia1 ?? null;
  const dia2 = inscricao.presencaDia2 ?? null;

  return {
    inscricaoId: inscricao.id,
    nome: inscricao.nome ?? `Inscricao #${inscricao.id}`,
    telefone: inscricao.telefone,
    cidade: inscricao.cidade,
    email: getEmail(inscricao),
    treinamentoId: getPresenceTrainingId(inscricao),
    recrutadorCodigo: inscricao.recrutadorCodigo ?? null,
    recrutadorNome: inscricao.recrutadorNome ?? null,
    participanteNomeZoom: inscricao.presencaParticipanteNome ?? null,
    tempoTotalMinutos: asNumber(inscricao.presencaTempoTotalMinutos),
    tempoDinamicaMinutos: asNumber(inscricao.presencaTempoDinamicaMinutos),
    percentualDinamica: asNumber(inscricao.presencaPercentualDinamica),
    aprovado: Boolean(inscricao.presencaAprovada),
    validadoEm: inscricao.presencaValidadaEm ?? null,
    totalDias: inscricao.presencaTotalDias ?? 1,
    diaProcessado: inscricao.presencaDiaProcessado ?? 1,
    dinamicaDias: inscricao.presencaDinamicaDias ?? null,
    dia1Aprovado: dayBoolean(dia1),
    dia2Aprovado: dayBoolean(dia2),
    dia1Tempo: dia1?.tempoTotal ?? null,
    dia2Tempo: dia2?.tempoTotal ?? null,
    dia1TempoDinamica: dia1?.tempoDinamica ?? null,
    dia2TempoDinamica: dia2?.tempoDinamica ?? null,
    dia1PercentualDinamica: dia1?.percentualDinamica ?? null,
    dia2PercentualDinamica: dia2?.percentualDinamica ?? null,
    dia1TemDinamica: typeof dia1?.temDinamica === "boolean" ? dia1.temDinamica : null,
    dia2TemDinamica: typeof dia2?.temDinamica === "boolean" ? dia2.temDinamica : null,
  };
}

export async function listPendingPresenceRecords(treinamentoId?: string | null): Promise<PendingPresenceRecord[]> {
  const pool = getPool();
  const values: string[] = [];
  const trainingFilter = treinamentoId?.trim();

  let query = `
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
      criado_em
    FROM ${SCHEMA_NAME}.presencas_pendentes
    WHERE resolvido_em IS NULL
  `;

  if (trainingFilter) {
    values.push(trainingFilter);
    query += ` AND treinamento_id = $${values.length}`;
  }

  query += " ORDER BY criado_em DESC";

  try {
    const { rows } = await pool.query<{
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
      criado_em: Date | string;
    }>(query, values);

    const candidateIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.inscricao_id_1, row.inscricao_id_2])
          .filter((id): id is number => typeof id === "number" && id > 0)
      )
    );
    const candidates = new Map(
      await Promise.all(
        candidateIds.map(async (id) => {
          const inscricao = await getInscricaoById(id);
          return [id, inscricao] as const;
        })
      )
    );

    return rows.map((row) => ({
      id: row.id,
      participanteNome: row.participante_nome,
      treinamentoId: row.treinamento_id,
      aprovado: row.aprovado,
      tempoTotalMinutos: row.tempo_total_minutos,
      tempoDinamicaMinutos: row.tempo_dinamica_minutos,
      percentualDinamica: row.percentual_dinamica,
      status: row.status === "doubt" ? "doubt" : "not-found",
      inscricaoId1: row.inscricao_id_1,
      inscricaoNome1: row.inscricao_nome_1,
      inscricaoTelefone1: row.inscricao_id_1 ? candidates.get(row.inscricao_id_1)?.telefone ?? null : null,
      inscricaoId2: row.inscricao_id_2,
      inscricaoNome2: row.inscricao_nome_2,
      inscricaoTelefone2: row.inscricao_id_2 ? candidates.get(row.inscricao_id_2)?.telefone ?? null : null,
      criadoEm: row.criado_em instanceof Date ? row.criado_em.toISOString() : String(row.criado_em),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("presencas_pendentes")) {
      return [];
    }
    throw error;
  }
}

export async function listPresenceRecords(options: {
  treinamentoId?: string | null;
  apenasAprovados?: boolean;
} = {}): Promise<PresenceListResult> {
  const inscricoes = await listPresenceInscricoes({
    treinamento: options.treinamentoId,
    apenasAprovados: options.apenasAprovados,
  });
  const presences = inscricoes.map(buildPresenceRecord);
  const pending = await listPendingPresenceRecords(options.treinamentoId);

  const totalAprovados = presences.filter((presence) => presence.aprovado).length;
  const totalParciais = presences.filter(
    (presence) => presence.totalDias >= 2 && presence.diaProcessado < presence.totalDias && !presence.aprovado
  ).length;
  const totalReprovados = presences.filter(
    (presence) => !presence.aprovado && !(presence.totalDias >= 2 && presence.diaProcessado < presence.totalDias)
  ).length;

  return {
    presences,
    pending,
    total: presences.length,
    totalAprovados,
    totalReprovados,
    totalParciais,
    totalPending: pending.length,
  };
}

export function buildPresenceRanking(records: PresenceRecord[]): {
  dinamicaDay: string;
  dinamicaDayLabel: string;
  ranking: PresenceRankingRecord[];
  totalPresentesDinamica: number;
} {
  let dinamicaDay: "day1" | "day2" | "both" | "single" | "none" = "single";
  const sample = records[0];

  if (sample && sample.totalDias >= 2) {
    if (sample.dinamicaDias === "day1" || sample.dinamicaDias === "day2" || sample.dinamicaDias === "both") {
      dinamicaDay = sample.dinamicaDias;
    } else if (sample.dinamicaDias === "none") {
      dinamicaDay = "none";
    } else if (sample.dia1TemDinamica && !sample.dia2TemDinamica) {
      dinamicaDay = "day1";
    } else if (!sample.dia1TemDinamica && sample.dia2TemDinamica) {
      dinamicaDay = "day2";
    } else if (sample.dia1TemDinamica && sample.dia2TemDinamica) {
      dinamicaDay = "both";
    } else {
      dinamicaDay = "none";
    }
  }

  const ranking = records.map((record) => {
    let tempoDinamicaDia = 0;
    let tempoTotalDia = 0;
    let percentualDia = 0;

    if (record.totalDias === 1 || dinamicaDay === "single") {
      tempoDinamicaDia = record.tempoDinamicaMinutos;
      tempoTotalDia = record.tempoTotalMinutos;
      percentualDia = record.percentualDinamica;
    } else if (dinamicaDay === "day1") {
      tempoDinamicaDia = record.dia1TempoDinamica ?? 0;
      tempoTotalDia = record.dia1Tempo ?? 0;
      percentualDia = record.dia1PercentualDinamica ?? 0;
    } else if (dinamicaDay === "day2") {
      tempoDinamicaDia = record.dia2TempoDinamica ?? 0;
      tempoTotalDia = record.dia2Tempo ?? 0;
      percentualDia = record.dia2PercentualDinamica ?? 0;
    } else if (dinamicaDay === "both") {
      tempoDinamicaDia = (record.dia1TempoDinamica ?? 0) + (record.dia2TempoDinamica ?? 0);
      tempoTotalDia = (record.dia1Tempo ?? 0) + (record.dia2Tempo ?? 0);
      percentualDia = tempoTotalDia > 0 ? Math.round((tempoDinamicaDia / tempoTotalDia) * 100) : 0;
    } else {
      tempoDinamicaDia = record.tempoDinamicaMinutos;
      tempoTotalDia = record.tempoTotalMinutos;
      percentualDia = record.percentualDinamica;
    }

    return {
      inscricaoId: record.inscricaoId,
      nome: record.nome,
      telefone: record.telefone,
      cidade: record.cidade,
      email: record.email,
      recrutadorCodigo: record.recrutadorCodigo,
      recrutadorNome: record.recrutadorNome,
      participanteNomeZoom: record.participanteNomeZoom,
      presenteNaDinamica: tempoTotalDia > 0,
      tempoDinamicaDiaMinutos: tempoDinamicaDia,
      tempoTotalDiaMinutos: tempoTotalDia,
      percentualDinamicaDia: percentualDia,
      tempoTotalGeralMinutos: record.tempoTotalMinutos,
      tempoDinamicaGeralMinutos: record.tempoDinamicaMinutos,
      aprovado: record.aprovado,
      validadoEm: record.validadoEm,
      totalDias: record.totalDias,
      dinamicaDay,
    };
  });

  ranking.sort((left, right) => {
    if (left.presenteNaDinamica !== right.presenteNaDinamica) {
      return left.presenteNaDinamica ? -1 : 1;
    }
    if (right.tempoTotalDiaMinutos !== left.tempoTotalDiaMinutos) {
      return right.tempoTotalDiaMinutos - left.tempoTotalDiaMinutos;
    }
    if (right.tempoDinamicaDiaMinutos !== left.tempoDinamicaDiaMinutos) {
      return right.tempoDinamicaDiaMinutos - left.tempoDinamicaDiaMinutos;
    }
    return left.nome.localeCompare(right.nome, "pt-BR");
  });

  const dinamicaDayLabel =
    dinamicaDay === "day1"
      ? "Dia 1"
      : dinamicaDay === "day2"
        ? "Dia 2"
        : dinamicaDay === "both"
        ? "Ambos os dias"
        : dinamicaDay === "none"
          ? "Encontro"
          : "Dia unico";

  return {
    dinamicaDay,
    dinamicaDayLabel,
    ranking,
    totalPresentesDinamica: ranking.filter((record) => record.presenteNaDinamica).length,
  };
}
