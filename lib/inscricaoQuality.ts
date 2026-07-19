import type { DuplicateReason, InscricaoItem } from "@/types/inscricao";

export type InscricaoQualitySeverity = "low" | "medium" | "high";

export type InscricaoQualityIssueCode =
  | "fantasma"
  | "nome-suspeito"
  | "telefone-invalido"
  | "email-suspeito"
  | "dados-incompletos"
  | "payload-teste"
  | "treinamento-ausente";

export interface InscricaoQualityIssue {
  code: InscricaoQualityIssueCode;
  label: string;
  description: string;
  severity: InscricaoQualitySeverity;
}

export interface InscricaoQualityAnalysis {
  score: number;
  isGhostCandidate: boolean;
  primaryLabel: string | null;
  issues: InscricaoQualityIssue[];
}

const TEST_WORDS = [
  "teste",
  "test",
  "fake",
  "falso",
  "falsa",
  "fulano",
  "ciclano",
  "beltrano",
  "lorem",
  "ipsum",
  "random",
  "aleatorio",
  "aleatoria",
  "temporario",
  "temporaria",
  "demo",
  "exemplo",
  "anonimo",
  "anonima",
  "bot",
];

const KEYBOARD_PATTERNS = [
  "asdf",
  "qwer",
  "qwerty",
  "zxcv",
  "abcd",
  "abcde",
  "xxxxx",
  "yyyyy",
  "zzzzz",
  "12345",
  "123456",
  "98765",
  "00000",
  "11111",
  "99999",
];

const SUSPICIOUS_EMAIL_DOMAINS = [
  "example.com",
  "example.com.br",
  "teste.com",
  "test.com",
  "fake.com",
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "yopmail.com",
  "guerrillamail.com",
  "trashmail.com",
];

const SCORE_BY_SEVERITY: Record<InscricaoQualitySeverity, number> = {
  high: 40,
  medium: 22,
  low: 8,
};

const TECHNICAL_PAYLOAD_KEYS = new Set([
  "clientid",
  "client_id",
  "sessionid",
  "session_id",
  "timestamp",
  "page",
  "url",
  "from_bio",
  "traffic_source",
  "source",
  "audience_segment",
  "landing_first_visit",
  "data_treinamento",
  "training_id",
  "trainingid",
  "treinamento_id",
  "presenca_treinamento_id",
]);

// Rotulos/metadados escolhidos pela equipe (nome de campanha, anuncio,
// formulario, origem etc.) — nao sao conteudo digitado pelo participante,
// entao nao devem ser varridos pela deteccao de "teste/aleatorio". Sem isso,
// uma campanha real chamada "... TESTE DE CRIATIVO ..." (nome interno comum
// em times de trafego pago) ou um timestamp que termina em "+0000" (bate no
// padrao de teclado "00000") derrubavam leads legitimos do Facebook Lead Ads
// para fora da Chegada de Leads.
const LABEL_METADATA_KEYS = new Set([
  "campaign_name",
  "campaignname",
  "campaign_source",
  "campaignsource",
  "ad_name",
  "adname",
  "adset_name",
  "adsetname",
  "form_name",
  "formname",
  "facebook_form_name",
  "facebookformname",
  "facebook_platform",
  "facebookplatform",
  "facebook_created_time",
  "facebookcreatedtime",
  "origem",
  "treinamento_nome",
  "treinamentonome",
  "unidade_negocio",
  "unidadenegocio",
  "utm_campaign",
  "utmcampaign",
  "utm_source",
  "utmsource",
  "utm_medium",
  "utmmedium",
  "utm_term",
  "utmterm",
  "utm_content",
  "utmcontent",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function compactText(value: string | null | undefined): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function asText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function readPayloadText(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = asText(payload[key]);
    if (direct) {
      return direct;
    }

    for (const nestedKey of ["dados_extras", "dadosExtras"]) {
      const nested = payload[nestedKey];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const nestedValue = asText((nested as Record<string, unknown>)[key]);
        if (nestedValue) {
          return nestedValue;
        }
      }
    }
  }

  return null;
}

function containsSuspiciousWord(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  const compact = compactText(value);
  if (!normalized) {
    return false;
  }

  if (TEST_WORDS.some((word) => new RegExp(`(^|\\W)${word}(\\W|$)`, "i").test(normalized))) {
    return true;
  }

  return KEYBOARD_PATTERNS.some((pattern) => compact.includes(pattern));
}

function looksRandomText(value: string | null | undefined): boolean {
  const compact = compactText(value);
  if (compact.length < 5) {
    return false;
  }

  const letters = compact.replace(/[^a-z]/g, "");
  if (letters.length < 3) {
    return false;
  }

  if (/^(.)\1{4,}$/.test(letters)) {
    return true;
  }

  if (/([a-z0-9]{2,3})\1{2,}/.test(compact)) {
    return true;
  }

  if (letters.length >= 6 && !/[aeiou]/.test(letters)) {
    return true;
  }

  return false;
}

function hasValidEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInvalidPhone(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) {
    return true;
  }

  if (digits.length < 10 || digits.length > 13) {
    return true;
  }

  if (/^(\d)\1+$/.test(digits)) {
    return true;
  }

  const compact = digits.slice(-11);
  if (
    compact.includes("123456789") ||
    compact.includes("012345678") ||
    compact.includes("987654321")
  ) {
    return true;
  }

  return /(\d{2,3})\1{3,}/.test(compact);
}

function hasTraining(inscricao: InscricaoItem): boolean {
  return Boolean(
    inscricao.treinamentoId ||
      inscricao.treinamentoNome ||
      inscricao.treinamentoData ||
      readPayloadText(inscricao.payload, [
        "treinamento",
        "training",
        "training_id",
        "trainingId",
        "data_treinamento",
        "treinamento_id",
      ])
  );
}

function collectPayloadStrings(value: unknown, output: string[], depth = 0): void {
  if (output.length >= 80 || depth > 4) {
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) {
      output.push(text);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPayloadStrings(item, output, depth + 1);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = normalizeText(key);
      const compactKey = compactText(key);
      if (
        normalizedKey.startsWith("_") ||
        normalizedKey.startsWith("dashboard_") ||
        normalizedKey.startsWith("presenca_") ||
        normalizedKey.startsWith("is_") ||
        normalizedKey.endsWith("_id") ||
        normalizedKey.endsWith("_time") ||
        TECHNICAL_PAYLOAD_KEYS.has(normalizedKey) ||
        LABEL_METADATA_KEYS.has(normalizedKey) ||
        LABEL_METADATA_KEYS.has(compactKey)
      ) {
        continue;
      }
      collectPayloadStrings(nestedValue, output, depth + 1);
    }
  }
}

function addIssue(
  issues: InscricaoQualityIssue[],
  code: InscricaoQualityIssueCode,
  label: string,
  description: string,
  severity: InscricaoQualitySeverity
): void {
  if (issues.some((issue) => issue.code === code)) {
    return;
  }

  issues.push({ code, label, description, severity });
}

export function hasQualityDismissed(inscricao: InscricaoItem): boolean {
  return inscricao.payload?.dashboard_quality_dismissed === true;
}

export function issueCodeToDuplicateReason(code: InscricaoQualityIssueCode): DuplicateReason {
  return code;
}

export function analyzeInscricaoQuality(inscricao: InscricaoItem): InscricaoQualityAnalysis {
  const issues: InscricaoQualityIssue[] = [];
  const name = inscricao.nome ?? readPayloadText(inscricao.payload, ["nome", "name"]);
  const phone = inscricao.telefone ?? readPayloadText(inscricao.payload, ["telefone", "phone", "celular", "whatsapp"]);
  const email = readPayloadText(inscricao.payload, ["email"]);
  const city = inscricao.cidade ?? readPayloadText(inscricao.payload, ["cidade", "city"]);
  const profession =
    inscricao.profissao ?? readPayloadText(inscricao.payload, ["profissao", "profissao_area", "occupation", "job"]);
  // Formularios nativos do Facebook Lead Ads sao configurados pela propria
  // equipe de trafego e, nesses formularios, normalmente nao ha pergunta de
  // cidade/profissao — cobrar isso aqui gera falso positivo em todo lead
  // desse canal, nao um sinal real de cadastro incompleto.
  const isFacebookLeadAd = Boolean(readPayloadText(inscricao.payload, ["facebook_lead_id"]));

  if (!name || !phone) {
    addIssue(
      issues,
      "dados-incompletos",
      "Dados incompletos",
      "Nome ou telefone ausente, que sao campos essenciais para identificar o participante.",
      "high"
    );
  } else if (!city && !profession && !isFacebookLeadAd) {
    addIssue(
      issues,
      "dados-incompletos",
      "Dados incompletos",
      "Cadastro sem cidade e sem profissao para apoiar a validacao manual.",
      "low"
    );
  }

  if (name && (containsSuspiciousWord(name) || looksRandomText(name))) {
    addIssue(
      issues,
      "nome-suspeito",
      "Nome suspeito",
      "Nome parece teste, placeholder ou texto aleatorio.",
      "high"
    );
  }

  if (phone && isInvalidPhone(phone)) {
    addIssue(
      issues,
      "telefone-invalido",
      "Telefone invalido",
      "Telefone com quantidade de digitos ou padrao improvavel.",
      "high"
    );
  }

  if (email) {
    const normalizedEmail = normalizeText(email);
    const [localPart, domain] = normalizedEmail.split("@");
    if (
      !hasValidEmailShape(email) ||
      SUSPICIOUS_EMAIL_DOMAINS.includes(domain ?? "") ||
      containsSuspiciousWord(localPart) ||
      looksRandomText(localPart)
    ) {
      addIssue(
        issues,
        "email-suspeito",
        "E-mail suspeito",
        "E-mail invalido, temporario ou com padrao de teste.",
        "medium"
      );
    }
  }

  if (!hasTraining(inscricao)) {
    addIssue(
      issues,
      "treinamento-ausente",
      "Treinamento ausente",
      "Inscricao sem etiqueta clara de treinamento.",
      "medium"
    );
  }

  const payloadStrings: string[] = [];
  collectPayloadStrings(inscricao.payload, payloadStrings);
  const suspiciousPayloadHits = payloadStrings.filter((value) => containsSuspiciousWord(value) || looksRandomText(value));
  if (suspiciousPayloadHits.length >= 2) {
    addIssue(
      issues,
      "payload-teste",
      "Teste/Aleatorio",
      "Varios campos do formulario parecem conter testes, exemplos ou aleatoriedades.",
      "high"
    );
  }

  const rawScore = issues.reduce((total, issue) => total + SCORE_BY_SEVERITY[issue.severity], 0);
  const score = Math.min(100, rawScore);
  const hasHigh = issues.some((issue) => issue.severity === "high");
  const isGhostCandidate = score >= 45 || (hasHigh && issues.length >= 2);

  return {
    score,
    isGhostCandidate,
    primaryLabel: issues[0]?.label ?? null,
    issues,
  };
}
