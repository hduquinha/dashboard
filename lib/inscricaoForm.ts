export interface UpDayFormData {
  nome: string | null;
  rg: string | null;
  cpf: string | null;
  endereco: string | null;
  dataNascimento: string | null;
  email: string | null;
  estadoCivil: string | null;
  estadoCivilOutro: string | null;
  profissaoArea: string | null;
  cidade: string | null;
  telefone: string | null;
  contatoEmergencia: string | null;
  medicamentosTratamento: string | null;
  indicacao: string | null;
  tamanhoCamiseta: string | null;
  pagamentoInfoVisualizada: string | null;
  multaCiente: string | null;
  cancelamentoCiente: string | null;
  treinamentoNome: string | null;
  dataTreinamento: string | null;
  dataTreinamentoExtenso: string | null;
  treinamentoInicio: string | null;
  treinamentoFim: string | null;
  origem: string | null;
  timestamp: string | null;
  dataPreenchimento: string | null;
}

export interface FormFieldValue {
  key: string;
  label: string;
  value: unknown;
}

type UpDayKey = keyof UpDayFormData;

const DATA_EXTRAS_KEYS = ["dados_extras", "dadosExtras"] as const;

export const UP_DAY_FIELD_KEYS: Record<UpDayKey, string[]> = {
  nome: ["nome", "name"],
  rg: ["rg", "RG"],
  cpf: ["cpf", "CPF"],
  endereco: ["endereco", "endereço", "address"],
  dataNascimento: ["data_nascimento", "dataNascimento", "nascimento", "birth_date"],
  email: ["email", "e_mail"],
  estadoCivil: ["estado_civil", "estadoCivil"],
  estadoCivilOutro: ["estado_civil_outro", "estadoCivilOutro"],
  profissaoArea: ["profissao_area", "profissaoArea", "profissao", "profissão", "occupation", "job"],
  cidade: ["cidade", "city"],
  telefone: ["telefone", "phone", "celular", "whatsapp"],
  contatoEmergencia: ["contato_emergencia", "contatoEmergencia", "emergency_contact"],
  medicamentosTratamento: [
    "medicamentos_tratamento",
    "medicamentosTratamento",
    "medicamento_tratamento",
    "tratamento",
  ],
  indicacao: ["indicacao", "indicação", "indicado_por", "como_conheceu"],
  tamanhoCamiseta: ["tamanho_camiseta", "tamanhoCamiseta", "camiseta"],
  pagamentoInfoVisualizada: ["pagamento_info_visualizada", "pagamentoInfoVisualizada"],
  multaCiente: ["multa_ciente", "multaCiente"],
  cancelamentoCiente: ["cancelamento_ciente", "cancelamentoCiente"],
  treinamentoNome: ["treinamento_nome", "treinamentoNome", "treinamento", "training"],
  dataTreinamento: ["data_treinamento", "dataTreinamento", "training_date", "trainingDate"],
  dataTreinamentoExtenso: ["data_treinamento_extenso", "dataTreinamentoExtenso"],
  treinamentoInicio: ["treinamento_inicio", "treinamentoInicio"],
  treinamentoFim: ["treinamento_fim", "treinamentoFim"],
  origem: ["origem", "source", "origin"],
  timestamp: ["timestamp", "created_at", "createdAt", "dataHora"],
  dataPreenchimento: ["data_preenchimento", "dataPreenchimento", "timestamp", "created_at", "createdAt"],
};

export const UP_DAY_DISPLAY_FIELDS: Array<{ key: UpDayKey; label: string }> = [
  { key: "nome", label: "Nome" },
  { key: "telefone", label: "Telefone pessoal" },
  { key: "email", label: "E-mail" },
  { key: "cpf", label: "CPF" },
  { key: "rg", label: "RG" },
  { key: "cidade", label: "Cidade" },
  { key: "profissaoArea", label: "Profissao" },
  { key: "dataNascimento", label: "Data de nascimento" },
  { key: "estadoCivil", label: "Estado civil" },
  { key: "estadoCivilOutro", label: "Estado civil outro" },
  { key: "contatoEmergencia", label: "Contato familiar/amigo" },
  { key: "indicacao", label: "Indicacao" },
  { key: "tamanhoCamiseta", label: "Tamanho da camiseta" },
  { key: "medicamentosTratamento", label: "Medicamento/tratamento" },
  { key: "multaCiente", label: "Aceite da multa" },
  { key: "cancelamentoCiente", label: "Aceite do cancelamento" },
  { key: "pagamentoInfoVisualizada", label: "Pagamento visualizado" },
  { key: "dataTreinamentoExtenso", label: "Data do treinamento" },
  { key: "treinamentoNome", label: "Treinamento" },
  { key: "treinamentoInicio", label: "Inicio do treinamento" },
  { key: "treinamentoFim", label: "Fim do treinamento" },
  { key: "origem", label: "Origem" },
];

export const PREVIOUS_FORM_FIELD_KEYS: Array<{ key: string; label: string; aliases?: string[] }> = [
  { key: "ansiedade", label: "Ansiedade" },
  { key: "sono", label: "Sono" },
  { key: "vida_financeira", label: "Vida financeira" },
  { key: "areas_melhoria", label: "Areas de melhoria" },
  { key: "sintomas_fisicos", label: "Sintomas fisicos" },
  { key: "sintomas_emocionais", label: "Sintomas emocionais" },
  { key: "gatilhos_ansiedade", label: "Gatilhos de ansiedade" },
  { key: "tentativas_anteriores", label: "Tentativas anteriores" },
  { key: "saude_fisica", label: "Saude fisica" },
  { key: "relacionamento", label: "Relacionamento" },
  { key: "relacionamentos_familiares", label: "Relacionamentos familiares" },
  { key: "comentarios_adicionais", label: "Comentarios adicionais" },
];

export const UP_DAY_CSV_COLUMNS: Array<{ header: string; key: UpDayKey }> = [
  { header: "nome", key: "nome" },
  { header: "rg", key: "rg" },
  { header: "cpf", key: "cpf" },
  { header: "endereco", key: "endereco" },
  { header: "data_nascimento", key: "dataNascimento" },
  { header: "email", key: "email" },
  { header: "estado_civil", key: "estadoCivil" },
  { header: "estado_civil_outro", key: "estadoCivilOutro" },
  { header: "profissao_area", key: "profissaoArea" },
  { header: "cidade", key: "cidade" },
  { header: "telefone", key: "telefone" },
  { header: "contato_emergencia", key: "contatoEmergencia" },
  { header: "medicamentos_tratamento", key: "medicamentosTratamento" },
  { header: "indicacao", key: "indicacao" },
  { header: "tamanho_camiseta", key: "tamanhoCamiseta" },
  { header: "multa_ciente", key: "multaCiente" },
  { header: "cancelamento_ciente", key: "cancelamentoCiente" },
  { header: "data_treinamento_extenso", key: "dataTreinamentoExtenso" },
  { header: "treinamento_nome", key: "treinamentoNome" },
  { header: "timestamp", key: "timestamp" },
  { header: "data_preenchimento", key: "dataPreenchimento" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordsForPayload(payload: Record<string, unknown>): Record<string, unknown>[] {
  const records = [payload];

  for (const key of DATA_EXTRAS_KEYS) {
    const nested = payload[key];
    if (isRecord(nested)) {
      records.push(nested);
    }
  }

  const pessoa = payload.pessoa;
  if (isRecord(pessoa)) {
    records.push(pessoa);
  }

  return records;
}

function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

export function pickFormValue(payload: Record<string, unknown>, keys: string[]): unknown {
  const records = recordsForPayload(payload);

  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (!isBlankValue(value)) {
        return value;
      }
    }
  }

  return null;
}

export function pickFormString(payload: Record<string, unknown>, keys: string[]): string | null {
  const value = pickFormValue(payload, keys);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function extractUpDayFormData(payload: Record<string, unknown>): UpDayFormData {
  return {
    nome: pickFormString(payload, UP_DAY_FIELD_KEYS.nome),
    rg: pickFormString(payload, UP_DAY_FIELD_KEYS.rg),
    cpf: pickFormString(payload, UP_DAY_FIELD_KEYS.cpf),
    endereco: pickFormString(payload, UP_DAY_FIELD_KEYS.endereco),
    dataNascimento: pickFormString(payload, UP_DAY_FIELD_KEYS.dataNascimento),
    email: pickFormString(payload, UP_DAY_FIELD_KEYS.email),
    estadoCivil: pickFormString(payload, UP_DAY_FIELD_KEYS.estadoCivil),
    estadoCivilOutro: pickFormString(payload, UP_DAY_FIELD_KEYS.estadoCivilOutro),
    profissaoArea: pickFormString(payload, UP_DAY_FIELD_KEYS.profissaoArea),
    cidade: pickFormString(payload, UP_DAY_FIELD_KEYS.cidade),
    telefone: pickFormString(payload, UP_DAY_FIELD_KEYS.telefone),
    contatoEmergencia: pickFormString(payload, UP_DAY_FIELD_KEYS.contatoEmergencia),
    medicamentosTratamento: pickFormString(payload, UP_DAY_FIELD_KEYS.medicamentosTratamento),
    indicacao: pickFormString(payload, UP_DAY_FIELD_KEYS.indicacao),
    tamanhoCamiseta: pickFormString(payload, UP_DAY_FIELD_KEYS.tamanhoCamiseta),
    pagamentoInfoVisualizada: pickFormString(payload, UP_DAY_FIELD_KEYS.pagamentoInfoVisualizada),
    multaCiente: pickFormString(payload, UP_DAY_FIELD_KEYS.multaCiente),
    cancelamentoCiente: pickFormString(payload, UP_DAY_FIELD_KEYS.cancelamentoCiente),
    treinamentoNome: pickFormString(payload, UP_DAY_FIELD_KEYS.treinamentoNome),
    dataTreinamento: pickFormString(payload, UP_DAY_FIELD_KEYS.dataTreinamento),
    dataTreinamentoExtenso: pickFormString(payload, UP_DAY_FIELD_KEYS.dataTreinamentoExtenso),
    treinamentoInicio: pickFormString(payload, UP_DAY_FIELD_KEYS.treinamentoInicio),
    treinamentoFim: pickFormString(payload, UP_DAY_FIELD_KEYS.treinamentoFim),
    origem: pickFormString(payload, UP_DAY_FIELD_KEYS.origem),
    timestamp: pickFormString(payload, UP_DAY_FIELD_KEYS.timestamp),
    dataPreenchimento: pickFormString(payload, UP_DAY_FIELD_KEYS.dataPreenchimento),
  };
}

export function hasUpDayFormData(data: UpDayFormData): boolean {
  const strongSignals = [
    data.cpf,
    data.rg,
    data.tamanhoCamiseta,
    data.contatoEmergencia,
    data.multaCiente,
    data.cancelamentoCiente,
  ];
  if (strongSignals.some((value) => Boolean(value))) {
    return true;
  }

  const treinamentoNome = data.treinamentoNome?.toLowerCase() ?? "";
  const origem = data.origem?.toLowerCase() ?? "";
  return treinamentoNome.includes("up day") || origem === "landing-inscricao-agosto-2026";
}

export function extractPreviousFormFields(payload: Record<string, unknown>): FormFieldValue[] {
  return PREVIOUS_FORM_FIELD_KEYS.flatMap((field) => {
    const value = pickFormValue(payload, [field.key, ...(field.aliases ?? [])]);
    if (isBlankValue(value)) {
      return [];
    }
    return [{ key: field.key, label: field.label, value }];
  });
}

export function formatFormValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Nao informado";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Nao informado";
    }

    const date = new Date(trimmed);
    if (/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/.test(trimmed) && !Number.isNaN(date.getTime())) {
      return date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-");
      return `${day}/${month}/${year}`;
    }

    return trimmed;
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Nao";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const formatted = value.map((entry) => formatFormValue(entry)).filter((entry) => entry !== "Nao informado");
    return formatted.length > 0 ? formatted.join(", ") : "Nao informado";
  }

  if (isRecord(value)) {
    const formatted = Object.values(value)
      .map((entry) => formatFormValue(entry))
      .filter((entry) => entry !== "Nao informado");
    return formatted.length > 0 ? formatted.join(", ") : "Nao informado";
  }

  return String(value);
}
