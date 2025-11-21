import * as XLSX from "xlsx";

type SpreadsheetBinary = ArrayBuffer | ArrayBufferView;

function toUint8Array(input: SpreadsheetBinary): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer);
  }
  return new Uint8Array(input);
}

export interface ImportPayload {
  nome: string | null;
  page: string | null;
  sono: string | null;
  _step: number;
  idade: string | null;
  _final: boolean;
  cidade: string | null;
  clientId: string | null;
  from_bio: string | null;
  telefone: string | null;
  ansiedade: string | null;
  timestamp: string | null;
  saude_fisica: string | null;
  como_conheceu: string | null;
  areas_melhoria: string[] | null;
  is_bio_traffic: string | null;
  profissao_area: string | null;
  relacionamento: string | null;
  traffic_source: string | null;
  vida_financeira: string | null;
  audience_segment: string | null;
  data_treinamento: string | null;
  sintomas_fisicos: string[] | null;
  data_preenchimento: string | null;
  gatilhos_ansiedade: string[] | null;
  is_whatsapp_traffic: string | null;
  landing_first_visit: string | null;
  sintomas_emocionais: string[] | null;
  tentativas_anteriores: string[] | null;
  comentarios_adicionais: string | null;
  relacionamentos_familiares: string | null;
}

export interface ImportError {
  linha: number;
  mensagem: string;
  raw: Record<string, unknown>;
}

export interface ImportResult {
  importados: ImportPayload[];
  comErros: ImportError[];
  duplicados: ImportPayload[];
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const casted = String(value).trim();
  return casted.length > 0 ? casted : null;
}

function parseList(value: unknown): string[] | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  return normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "sim", "yes"].includes(normalized);
  }
  return false;
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((value) => normalizeString(value) === null);
}

function buildPayload(row: Record<string, unknown>): ImportPayload {
  const dataTreinamento = normalizeString(row.data) ?? normalizeString(row.data_treinamento);

  return {
    nome: normalizeString(row.nome),
    page: normalizeString(row.page),
    sono: normalizeString(row.sono),
    _step: toNumber(row._step),
    idade: normalizeString(row.idade),
    _final: toBoolean(row._final),
    cidade: normalizeString(row.cidade),
    clientId: normalizeString(row.clientId),
    from_bio: normalizeString(row.from_bio),
    telefone: normalizeString(row.telefone),
    ansiedade: normalizeString(row.ansiedade),
    timestamp: normalizeString(row.timestamp),
    saude_fisica: normalizeString(row.saude_fisica),
    como_conheceu: normalizeString(row.como_conheceu),
    areas_melhoria: parseList(row.areas_melhoria),
    is_bio_traffic: normalizeString(row.is_bio_traffic),
    profissao_area: normalizeString(row.profissao_area),
    relacionamento: normalizeString(row.relacionamento),
    traffic_source: normalizeString(row.traffic_source),
    vida_financeira: normalizeString(row.vida_financeira),
    audience_segment: normalizeString(row.audience_segment),
    data_treinamento: dataTreinamento,
    sintomas_fisicos: parseList(row.sintomas_fisicos),
    data_preenchimento: normalizeString(row.data_preenchimento),
    gatilhos_ansiedade: parseList(row.gatilhos_ansiedade),
    is_whatsapp_traffic: normalizeString(row.is_whatsapp_traffic),
    landing_first_visit: normalizeString(row.landing_first_visit),
    sintomas_emocionais: parseList(row.sintomas_emocionais),
    tentativas_anteriores: parseList(row.tentativas_anteriores),
    comentarios_adicionais: normalizeString(row.comentarios_adicionais),
    relacionamentos_familiares: normalizeString(row.relacionamentos_familiares),
  };
}

export function importSpreadsheet(data: SpreadsheetBinary): ImportResult {
  const workbook = XLSX.read(toUint8Array(data), {
    type: "array",
    cellDates: false,
    cellNF: false,
    raw: false,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      importados: [],
      comErros: [
        {
          linha: 0,
          mensagem: "Planilha sem abas ou vazia",
          raw: {},
        },
      ],
      duplicados: [],
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    blankrows: false,
  });

  const importados: ImportPayload[] = [];
  const comErros: ImportError[] = [];
  const duplicados: ImportPayload[] = [];

  const seenClientIds = new Set<string>();
  const seenPhones = new Set<string>();

  rows.forEach((row: Record<string, unknown>, index: number) => {
    const currentLine = index + 2; // considerando a linha de cabeçalho
    if (isRowEmpty(row)) {
      return;
    }

    try {
      const payload = buildPayload(row);

      let isDuplicate = false;
      if (payload.clientId) {
        if (seenClientIds.has(payload.clientId)) {
          isDuplicate = true;
        } else {
          seenClientIds.add(payload.clientId);
        }
      }

      if (!isDuplicate && payload.telefone) {
        if (seenPhones.has(payload.telefone)) {
          isDuplicate = true;
        } else {
          seenPhones.add(payload.telefone);
        }
      }

      if (isDuplicate) {
        duplicados.push(payload);
      } else {
        importados.push(payload);
      }
    } catch (error) {
      comErros.push({
        linha: currentLine,
        mensagem: error instanceof Error ? error.message : "Erro ao processar linha",
        raw: row,
      });
    }
  });

  return {
    importados,
    comErros,
    duplicados,
  };
}
