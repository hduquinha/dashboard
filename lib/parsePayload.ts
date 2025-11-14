import type { InscricaoPayload } from "@/types/inscricao";

function pickString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const TRAINING_FIELD_KEYS = [
  "treinamento",
  "training",
  "training_id",
  "trainingId",
  "training_code",
  "trainingCode",
  "training_date",
  "trainingDate",
  "training_option",
  "trainingOption",
  "data_treinamento",
  "treinamento_id",
  "treinamento_nome",
  "treinamentoNome",
  "treinamento_label",
  "treinamentoLabel",
];

const ALTERNATE_KEYS: Record<keyof InscricaoPayload, string[]> = {
  nome: ["name"],
  telefone: ["phone", "celular"],
  cidade: ["city"],
  estado: ["state"],
  email: [],
  origem: ["source", "origem_lead"],
  timestamp: ["created_at", "createdAt", "dataHora", "timestamp"],
  traffic_source: ["trafficSource", "codigo_indicador", "indicador", "ref", "referral"],
  profissao: ["occupation", "job", "profissao"],
  treinamento: TRAINING_FIELD_KEYS.filter((key) => key !== "treinamento"),
  tipo: ["type", "perfil", "papel", "role", "categoria"],
  codigoRecrutador: [
    "codigo_recrutador",
    "recruiter_code",
    "codigo",
    "codigoProprio",
    "own_code",
    "code",
    "indicador_codigo",
  ],
  recrutadorId: ["recrutador_id", "indicador_id", "parent_id", "parentId", "sponsor_id", "upline_id"],
  parentId: ["parent_id", "parentId", "upline_id"],
  indicadorId: ["indicador_id", "indicacao_id", "referencia_id"],
  sponsorId: ["sponsor_id"],
  nivel: ["nivel", "level", "hierarchy_level"],
  isRecruiter: ["is_recruiter", "recrutador", "recruiter", "isRecruiter", "eh_recrutador"],
};

export function parsePayload(payload: unknown): InscricaoPayload {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const normalized: InscricaoPayload = {};

  for (const [key, value] of Object.entries(record)) {
    normalized[key] = value;
  }

  for (const [target, alternateKeys] of Object.entries(ALTERNATE_KEYS) as Array<[
    keyof InscricaoPayload,
    string[]
  ]>) {
    const primary = pickString(record, target as string);
    if (primary) {
      normalized[target] = primary;
      continue;
    }

    for (const fallbackKey of alternateKeys) {
      const fallback = pickString(record, fallbackKey);
      if (fallback) {
        normalized[target] = fallback;
        break;
      }
    }
  }

  return normalized;
}
