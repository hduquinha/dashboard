import type { DashboardUser } from "@/lib/auth";
import { assignCommercialLead, ensureCommercialSchema, listCommercialSellers } from "@/lib/commercial";
import { analyzeInscricaoQuality } from "@/lib/inscricaoQuality";
import { pickFormString } from "@/lib/inscricaoForm";
import { FORM_NAME_KEYS, LANDING_PAGE_KEYS } from "@/lib/leadFields";
import { effectiveLeadOrigin, originTier } from "@/lib/leadOriginPriority";
import { isProductivityManager } from "@/lib/productivity";
import { getPool, listInscricoes, listInscricoesByIds } from "@/lib/db";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { listVozupLeadIdsByBlock } from "@/lib/vozupFolders";
import type { ArrivalQueueCounts, CommercialSeller } from "@/types/commercial";
import type { InscricaoItem, InscricaoStatus } from "@/types/inscricao";

export type ManualDistributionPresenceFilter =
  | "aprovada"
  | "validada"
  | "reprovada"
  | "nao-validada";

export type ManualDistributionStrategy = "single" | "round_robin";

export interface ManualDistributionFilters {
  treinamento?: string;
  campaignSource?: string;
  campaignName?: string;
  caracteristica?: string;
  presenca?: ManualDistributionPresenceFilter;
  status?: InscricaoStatus;
  unassignedOnly: boolean;
  produto?: "vozup" | "instituto";
}

export interface ManualDistributionCandidate {
  id: number;
  name: string | null;
  phone: string | null;
  city: string | null;
  profession: string | null;
  createdAt: string;
  trainingId: string | null;
  trainingLabel: string | null;
  campaignSource: string | null;
  campaignName: string | null;
  presenceLabel: string;
  assignedSellerName: string | null;
  assignedSellerEmail: string | null;
  businessUnit: string;
  entryChannel: string;
  entrySignal: string;
  leadPath: string[];
  sourceGroupKey: string;
  sourceGroupTitle: string;
}

export interface ManualDistributionCandidateResult {
  candidates: ManualDistributionCandidate[];
  total: number;
  limit: number;
}

export interface ExclusiveClassArrivalCandidateResult extends ManualDistributionCandidateResult {
  /** Marco persistente que separa o histórico da nova fila de aulas. */
  startsAt: string;
}

export interface ManualDistributionFolderBlockOption {
  bloco: string;
  subpasta: string;
  total: number;
  semana: number;
  mes: number;
  ultimaConversao: string | null;
}

export interface ManualDistributionFolderOption {
  key: string;
  label: string;
  emoji: string;
  description: string;
  blocks: ManualDistributionFolderBlockOption[];
}

export interface ManualDistributionInput {
  scope: "selected" | "filters" | "folder_block";
  leadIds?: number[];
  filters?: ManualDistributionFilters;
  folderKey?: string;
  block?: string;
  sellerIds: number[];
  strategy: ManualDistributionStrategy;
  overwriteAssigned?: boolean;
  limit?: number;
}

export interface ManualDistributionFolderCandidatesInput {
  folderKey?: string;
  block?: string;
  overwriteAssigned?: boolean;
  limit?: number;
}

export interface ManualDistributionResult {
  assigned: Array<{
    inscricaoId: number;
    sellerId: number;
    sellerName: string;
    sellerEmail: string;
  }>;
  skipped: Array<{
    inscricaoId: number;
    reason: string;
  }>;
  failed: Array<{
    inscricaoId: number;
    reason: string;
  }>;
}

const DEFAULT_LIMIT = 120;
const MAX_FILTER_DISTRIBUTION = 500;
/** Validade do cache de contagem das filas (ver countArrivalQueues). */
const ARRIVAL_COUNTS_TTL_MS = 20_000;
let arrivalCountsCache: { value: ArrivalQueueCounts; expiresAt: number } | null = null;
const EXCLUSIVE_CLASS_ARRIVAL_STREAM_KEY = "aula_exclusiva_experimental";
const STATUS_VALUES: InscricaoStatus[] = ["aguardando", "aprovado", "rejeitado"];
const PRESENCE_VALUES: ManualDistributionPresenceFilter[] = [
  "aprovada",
  "validada",
  "reprovada",
  "nao-validada",
];

const BUSINESS_UNIT_KEYS = [
  "unidade_negocio",
  "unidadeNegocio",
  "business_unit",
  "businessUnit",
  "lead_setor",
  "leadSetor",
  "lead_produto",
  "leadProduto",
  "produto_interesse",
  "produtoInteresse",
  "product",
  "produto",
  "brand",
  "marca",
];

const CAMPAIGN_SOURCE_KEYS = [
  "campaign_source",
  "campaignSource",
  "utm_source",
  "utmSource",
  "lead_source",
  "leadSource",
  "origem_formulario",
  "origemFormulario",
  "lead_origem",
  "leadOrigem",
  "entrada_sinal",
  "entradaSinal",
  "lead_entrada",
  "leadEntrada",
  "platform",
  "plataforma",
  "publisher_platform",
  "publisherPlatform",
  "channel",
  "canal",
  "origem",
  "source",
  "traffic_source",
  "trafficSource",
];

const CAMPAIGN_NAME_KEYS = [
  "campaign_name",
  "campaignName",
  "utm_campaign",
  "utmCampaign",
  "utm_id",
  "utmId",
  "campaign",
  "campaign_id",
  "campaignId",
  "ad_campaign",
  "adCampaign",
  "campanha",
];

const CAMPAIGN_MEDIUM_KEYS = [
  "campaign_medium",
  "campaignMedium",
  "utm_medium",
  "utmMedium",
  "medium",
  "placement",
  "posicionamento",
];

const CAMPAIGN_TERM_KEYS = [
  "campaign_term",
  "campaignTerm",
  "utm_term",
  "utmTerm",
  "term",
  "keyword",
  "palavra_chave",
];

const CAMPAIGN_ID_KEYS = ["campaign_id", "campaignId", "utm_id", "utmId"];
const FORM_ID_KEYS = ["form_id", "formId", "lead_form_id", "leadFormId", "facebook_form_id", "google_form_id"];
const ADSET_ID_KEYS = ["adset_id", "adsetId", "ad_set_id", "adSetId", "conjunto_id", "conjuntoId"];
const ADSET_NAME_KEYS = [
  "adset_name",
  "adsetName",
  "ad_set_name",
  "adSetName",
  "conjunto_nome",
  "conjuntoNome",
];
const AD_ID_KEYS = ["ad_id", "adId", "creative_id", "creativeId", "anuncio_id", "anuncioId"];
const AD_NAME_KEYS = [
  "ad_name",
  "adName",
  "creative_name",
  "creativeName",
  "anuncio_nome",
  "anuncioNome",
];
const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid"];

interface CampaignSignals {
  source: string | null;
  medium: string | null;
  name: string | null;
  term: string | null;
  campaignId: string | null;
  formId: string | null;
  formName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  adId: string | null;
  adName: string | null;
  clickId: string | null;
  landingPage: string | null;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "sim", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "nao", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseStatus(value: unknown): InscricaoStatus | undefined {
  const candidate = cleanText(value)?.toLowerCase();
  return STATUS_VALUES.includes(candidate as InscricaoStatus) ? (candidate as InscricaoStatus) : undefined;
}

function parsePresence(value: unknown): ManualDistributionPresenceFilter | undefined {
  const candidate = cleanText(value)?.toLowerCase();
  return PRESENCE_VALUES.includes(candidate as ManualDistributionPresenceFilter)
    ? (candidate as ManualDistributionPresenceFilter)
    : undefined;
}

function parseIdList(values: unknown): number[] {
  const rawValues = Array.isArray(values) ? values : [values];
  const ids = rawValues
    .flatMap((value) => (typeof value === "string" ? value.split(/[,\s]+/) : [value]))
    .map((value) => Number.parseInt(String(value ?? ""), 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  return Array.from(new Set(ids));
}

function safeLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_FILTER_DISTRIBUTION, parsed));
}

function trainingLabel(item: InscricaoItem): string | null {
  if (item.treinamentoData) {
    return formatTrainingDateLabel(item.treinamentoData) ?? item.treinamentoNome ?? item.treinamentoId;
  }

  if (item.treinamentoId) {
    return formatTrainingDateLabel(item.treinamentoId) ?? item.treinamentoNome ?? item.treinamentoId;
  }

  return item.treinamentoNome ?? null;
}

function presenceLabel(item: InscricaoItem): string {
  if (item.presencaAprovada) return "Presente";
  if (item.presencaValidada) return "Presenca parcial";
  return "Nao validada";
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function payloadText(item: InscricaoItem, keys: string[]): string | null {
  const picked = pickFormString(item.payload, keys);
  if (picked) return picked;

  for (const key of keys) {
    const direct = stringValue(item.payload[key]);
    if (direct) return direct;

    const parsed = stringValue(item.parsedPayload[key]);
    if (parsed) return parsed;
  }

  return null;
}

function urlSearchParam(value: string | null, params: string[]): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const looksLikeQuery = /^[^=/?#]+=[^&]+(&|$)/.test(trimmed) || /^[?#]/.test(trimmed);
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (!looksLikeQuery && !looksLikeUrl && !trimmed.includes("?")) return null;

  try {
    const url = looksLikeUrl
      ? new URL(trimmed)
      : new URL(
          trimmed.startsWith("/")
            ? `https://lead.local${trimmed}`
            : `https://lead.local/${trimmed.startsWith("?") || looksLikeQuery ? `${trimmed.startsWith("?") ? "" : "?"}${trimmed}` : trimmed}`
        );

    for (const param of params) {
      const valueFromUrl = stringValue(url.searchParams.get(param));
      if (valueFromUrl) return valueFromUrl;
    }
  } catch {
    return null;
  }

  return null;
}

function payloadUrlParam(item: InscricaoItem, params: string[]): string | null {
  for (const key of LANDING_PAGE_KEYS) {
    const value = payloadText(item, [key]);
    const parsed = urlSearchParam(value, params);
    if (parsed) return parsed;
  }

  return null;
}

function campaignPayloadText(item: InscricaoItem, keys: string[], urlParams: string[] = []): string | null {
  return payloadText(item, keys) ?? (urlParams.length > 0 ? payloadUrlParam(item, urlParams) : null);
}

function clickId(item: InscricaoItem): string | null {
  for (const key of CLICK_ID_KEYS) {
    const value = payloadText(item, [key]) ?? payloadUrlParam(item, [key]);
    if (value) return key === "fbclid" ? "fbclid" : key;
  }

  return null;
}

function landingPage(item: InscricaoItem): string | null {
  return stringValue(item.commercial?.landingPage) ?? payloadText(item, LANDING_PAGE_KEYS);
}

function campaignSignals(item: InscricaoItem): CampaignSignals {
  return {
    source:
      stringValue(item.commercial?.campaignSource) ??
      campaignPayloadText(item, CAMPAIGN_SOURCE_KEYS, ["utm_source", "source"]),
    medium:
      stringValue(item.commercial?.campaignMedium) ??
      campaignPayloadText(item, CAMPAIGN_MEDIUM_KEYS, ["utm_medium", "medium"]),
    name:
      stringValue(item.commercial?.campaignName) ??
      campaignPayloadText(item, CAMPAIGN_NAME_KEYS, ["utm_campaign", "campaign", "campaign_name"]),
    term:
      stringValue(item.commercial?.campaignTerm) ??
      campaignPayloadText(item, CAMPAIGN_TERM_KEYS, ["utm_term", "term", "keyword"]),
    campaignId: campaignPayloadText(item, CAMPAIGN_ID_KEYS, ["utm_id", "campaign_id"]),
    formId: campaignPayloadText(item, FORM_ID_KEYS, ["form_id", "lead_form_id"]),
    formName: campaignPayloadText(item, FORM_NAME_KEYS, ["form_name", "lead_form_name"]),
    adSetId: campaignPayloadText(item, ADSET_ID_KEYS, ["adset_id", "ad_set_id"]),
    adSetName: campaignPayloadText(item, ADSET_NAME_KEYS, ["adset_name", "ad_set_name"]),
    adId: campaignPayloadText(item, AD_ID_KEYS, ["ad_id", "creative_id"]),
    adName: campaignPayloadText(item, AD_NAME_KEYS, ["ad_name", "creative_name"]),
    clickId: clickId(item),
    landingPage: landingPage(item),
  };
}

function textIncludes(text: string, values: string[]): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return values.some((value) => normalized.includes(value));
}

function compactParts(parts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const compacted: string[] = [];

  for (const part of parts) {
    const value = stringValue(part);
    if (!value) continue;

    const key = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    compacted.push(value);
  }

  return compacted;
}

function keyPart(value: string | null | undefined): string {
  const normalized = stringValue(value)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized || "sem-sinal";
}

function compactLabel(prefix: string, value: string | null): string | null {
  return value ? `${prefix} ${value}` : null;
}

function landingPageLabel(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `Pagina ${url.hostname}${path}`;
  } catch {
    return value.startsWith("/") ? `Pagina ${value}` : value;
  }
}

function inferBusinessUnit(item: InscricaoItem, signals: CampaignSignals): string {
  const source = compactParts([
    payloadText(item, BUSINESS_UNIT_KEYS),
    signals.name,
    signals.formName,
    item.treinamentoNome,
    item.treinamentoId,
  ]).join(" ");

  if (textIncludes(source, ["vozup", "voz up", "escola voz", "voz"])) return "Voz UP";
  return "Instituto UP";
}

function inferEntryChannel(item: InscricaoItem, signals: CampaignSignals): string {
  const source = compactParts([
    signals.source,
    signals.medium,
    signals.name,
    signals.formName,
    signals.clickId,
    payloadText(item, CAMPAIGN_SOURCE_KEYS),
    item.recrutadorCodigo,
    item.treinamentoNome,
    item.treinamentoId,
  ]).join(" ");

  const hasForm = Boolean(signals.formId || signals.formName) || textIncludes(source, ["form", "formulario", "lead ads", "instant form"]);
  // A Chat Ads e uma pagina propria (origem "Chat Ads VozUP") e precisa ser um
  // balde separado na Chegada. Vem ANTES de Google/Meta de proposito: o clique
  // chega com fbclid/gclid e seria absorvido pelo canal do trafego, que e
  // exatamente o que se quer evitar. Segue a regra 1 da cartilha — quem manda
  // e o formulario, nao o trafego.
  if (textIncludes(source, ["chat ads org"])) return "Chat Ads Organico";
  if (textIncludes(source, ["chat ads"])) return "Chat Ads";
  if (textIncludes(source, ["google", "gclid", "adwords", "youtube"]) || signals.clickId === "gclid") {
    return hasForm ? "Google Forms" : "Google Ads";
  }
  if (textIncludes(source, ["meta", "facebook", "instagram", "fbclid", "ig", "fb"]) || signals.clickId === "fbclid") {
    return hasForm ? "Meta Forms" : "Meta Ads";
  }
  if (textIncludes(source, ["up day plus", "upday plus"])) return "UP Day Plus";
  if (textIncludes(source, ["encontro online"])) return "Encontro Online";
  if (hasForm) return "Formulario";
  if (textIncludes(source, ["whatsapp", "wpp"])) return "WhatsApp";
  if (textIncludes(source, ["indicacao", "recrutador", "rede"]) || stringValue(item.recrutadorCodigo)) return "Rede";
  return "Entrada direta";
}

function entrySignal(item: InscricaoItem, signals: CampaignSignals): string {
  const source = signals.source ?? payloadText(item, CAMPAIGN_SOURCE_KEYS);
  if (source && /^\d+$/.test(source)) return `Sinal ${source}`;
  if (source) return source;

  const recruiterCode = stringValue(item.recrutadorCodigo);
  if (recruiterCode) return `Sinal ${recruiterCode}`;

  return signals.clickId ?? "Sem sinal";
}

function sourceGroupTitle(
  signals: CampaignSignals,
  trainingLabelValue: string | null,
  entryChannel: string
): string {
  const campaignName = signals.name;
  const formName = signals.formName ?? (signals.formId ? `Formulario ${signals.formId}` : null);

  if (campaignName && trainingLabelValue && keyPart(campaignName) !== keyPart(trainingLabelValue)) {
    return `${campaignName} - ${trainingLabelValue}`;
  }

  return campaignName ?? formName ?? trainingLabelValue ?? entryChannel;
}

function sourceGroupKey(
  businessUnit: string,
  entryChannel: string,
  signals: CampaignSignals,
  trainingId: string | null,
  trainingLabelValue: string | null
): string {
  return [
    businessUnit,
    entryChannel,
    signals.campaignId,
    signals.name,
    signals.formId,
    signals.formName,
    trainingId,
    trainingLabelValue,
  ].map(keyPart).join(":");
}

function leadPathParts(
  businessUnit: string,
  entryChannel: string,
  groupTitle: string,
  signals: CampaignSignals,
  signal: string
): string[] {
  return compactParts([
    businessUnit,
    entryChannel,
    groupTitle,
    compactLabel("Formulario", signals.formName ?? signals.formId),
    compactLabel("Conjunto", signals.adSetName ?? signals.adSetId),
    compactLabel("Anuncio", signals.adName ?? signals.adId),
    landingPageLabel(signals.landingPage),
    signal,
  ]);
}

function isTestLead(item: InscricaoItem): boolean {
  const quality = analyzeInscricaoQuality(item);
  return quality.issues.some((issue) => issue.code === "payload-teste");
}

// Canais que "chegam" na Chegada de Leads: trafego pago da Meta e leads das
// landing pages (Google). Aula exclusiva, workshop, encontro online etc. nao
// entram aqui — esses leads seguem outros fluxos.
const ARRIVAL_CHANNELS = new Set([
  "Meta Ads", "Meta Forms", "Google Ads", "Google Forms",
  // O organico do ChatGPT entra tambem: antes ele chegava aqui como landing
  // page comum, e tira-lo agora esvaziaria a fila do SDR sem ninguem pedir.
  "Chat Ads", "Chat Ads Organico",
]);

// O produto de um lead vem do FORMULARIO onde ele se inscreveu, nunca do canal
// de trafego (ver docs/cartilha-formularios-produtos.md). Um lead da Aula
// Exclusiva que clicou num anuncio do Instagram chega com utm/fbclid e seria
// classificado como "Meta Ads", mas precisa seguir a fila exclusiva de aulas.
// Estes termos identificam formularios de produto (aulas, workshop, Encontro
// Online, UP Day).
const EXCLUDED_PRODUCT_TERMS = [
  "aula exclusiva",
  "aula experimental",
  "workshop",
  "encontro online",
  "up day",
  "up-day",
  "landing-inscricao",
];

const EXCLUSIVE_CLASS_TERMS = ["aula exclusiva", "aula experimental"];

function productFormIdentity(item: InscricaoItem): string {
  return compactParts([
    payloadText(item, ["origem", "lead_origem", "origem_formulario"]),
    payloadText(item, ["nome_evento"]),
    payloadText(item, ["treinamento_nome", "treinamentoNome"]),
    payloadText(item, ["data_treinamento", "dataTreinamento"]),
    payloadText(item, ["modalidade"]),
    item.treinamentoNome,
    item.treinamentoData,
    item.treinamentoId,
  ]).join(" ");
}

function isExclusiveClassLead(item: InscricaoItem): boolean {
  const identity = productFormIdentity(item);
  return Boolean(identity && textIncludes(identity, EXCLUSIVE_CLASS_TERMS));
}

function isProductFormLead(item: InscricaoItem): boolean {
  const identity = productFormIdentity(item);
  if (identity && textIncludes(identity, EXCLUDED_PRODUCT_TERMS)) return true;

  // Data ISO em data_treinamento e exclusiva do Encontro Online.
  const dataTreinamento = payloadText(item, ["data_treinamento", "dataTreinamento"]);
  return Boolean(dataTreinamento && /^\d{4}-\d{2}-\d{2}/.test(dataTreinamento));
}

function isArrivalLead(item: InscricaoItem, candidate: ManualDistributionCandidate): boolean {
  // Canal de captação tem prioridade sobre o formulário de produto: quem tem
  // um vínculo Meta/Google/landing page entra na fila mesmo tendo preenchido
  // também um formulário de aula. Decisão da operação em 04/08/2026 — ver
  // lib/leadOriginPriority.ts e a cartilha §10.
  if (originTier(effectiveLeadOrigin(item.payload as Record<string, unknown>).origem) <= 3) return true;
  if (isProductFormLead(item)) return false;
  const aguardaDistribuicao = payloadText(item, ["aguarda_distribuicao", "aguardaDistribuicao"]);
  if (aguardaDistribuicao?.toLowerCase() === "true") return true;
  if (ARRIVAL_CHANNELS.has(candidate.entryChannel)) return true;

  const origem = payloadText(item, ["origem", "lead_origem", "origem_formulario"]);
  // Leads adicionados manualmente na Chegada (sem dono) — a origem "Chegada
  // Manual" os coloca na fila pro SDR distribuir, mesmo sem canal Meta/Google.
  if (origem && textIncludes(origem, ["chegada manual"])) return true;

  // Landing pages sem UTM identificavel: a origem gravada no payload ainda
  // denuncia a landing page.
  return Boolean(origem && textIncludes(origem, ["landing"]));
}

function isOnOrAfter(item: InscricaoItem, startsAt: string): boolean {
  const createdAt = new Date(item.criadoEm).getTime();
  const cutoff = new Date(startsAt).getTime();
  return Number.isFinite(createdAt) && Number.isFinite(cutoff) && createdAt >= cutoff;
}

async function getExclusiveClassArrivalStartAt(): Promise<string> {
  const pool = getPool();
  let rows: Array<{ starts_at: Date | string }>;

  try {
    ({ rows } = await pool.query<{ starts_at: Date | string }>(
      `SELECT starts_at FROM dashboard.arrival_streams WHERE stream_key = $1`,
      [EXCLUSIVE_CLASS_ARRIVAL_STREAM_KEY]
    ));
  } catch (error) {
    // Compatibilidade com o primeiro deploy caso a migração ainda não tenha
    // sido executada. Em funcionamento normal, a leitura acima é a única
    // consulta feita para recuperar o marco.
    if (!(typeof error === "object" && error && "code" in error && error.code === "42P01")) {
      throw error;
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard.arrival_streams (
        stream_key TEXT PRIMARY KEY,
        starts_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    rows = [];
  }

  if (rows.length === 0) {
    const inserted = await pool.query<{ starts_at: Date | string }>(
      `
        INSERT INTO dashboard.arrival_streams (stream_key, starts_at)
        VALUES ($1, NOW())
        ON CONFLICT (stream_key) DO NOTHING
        RETURNING starts_at
      `,
      [EXCLUSIVE_CLASS_ARRIVAL_STREAM_KEY]
    );
    rows = inserted.rows;
    if (rows.length === 0) {
      ({ rows } = await pool.query<{ starts_at: Date | string }>(
        `SELECT starts_at FROM dashboard.arrival_streams WHERE stream_key = $1`,
        [EXCLUSIVE_CLASS_ARRIVAL_STREAM_KEY]
      ));
    }
  }

  const raw = rows[0]?.starts_at;
  if (!raw) {
    throw new Error("Marco de início da fila de aulas não encontrado.");
  }
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Marco de início da fila de aulas inválido.");
  }
  return date.toISOString();
}

function normalizeSellerIds(input: unknown): number[] {
  return parseIdList(input).slice(0, 50);
}

function candidateFromItem(item: InscricaoItem): ManualDistributionCandidate {
  const trainingLabelValue = trainingLabel(item);
  const signals = campaignSignals(item);
  const campaignSource = signals.source ?? item.recrutadorCodigo ?? null;
  const campaignName = signals.name ?? item.treinamentoNome ?? item.treinamentoId ?? null;
  const businessUnit = inferBusinessUnit(item, signals);
  const channel = inferEntryChannel(item, signals);
  const signal = entrySignal(item, signals);
  const groupTitle = sourceGroupTitle(signals, trainingLabelValue, channel);
  const leadPath = leadPathParts(businessUnit, channel, groupTitle, signals, signal);

  return {
    id: item.id,
    name: item.nome,
    phone: item.telefone,
    city: item.cidade,
    profession: item.profissao,
    createdAt: item.criadoEm,
    trainingId: item.treinamentoId,
    trainingLabel: trainingLabelValue,
    campaignSource,
    campaignName,
    presenceLabel: presenceLabel(item),
    assignedSellerName: item.commercial?.assignedSellerName ?? null,
    assignedSellerEmail: item.commercial?.assignedSellerEmail ?? null,
    businessUnit,
    entryChannel: channel,
    entrySignal: signal,
    leadPath,
    sourceGroupKey: sourceGroupKey(
      businessUnit,
      channel,
      signals,
      item.treinamentoId,
      trainingLabelValue
    ),
    sourceGroupTitle: groupTitle,
  };
}

function parseProduto(value: unknown): "vozup" | "instituto" | undefined {
  const candidate = cleanText(value)?.toLowerCase();
  if (candidate === "vozup" || candidate === "instituto") return candidate;
  return undefined;
}

export function normalizeManualDistributionFilters(input: Record<string, unknown>): ManualDistributionFilters {
  const statusInput = cleanText(input.status)?.toLowerCase();

  return {
    treinamento: cleanText(input.treinamento),
    campaignSource: cleanText(input.campaignSource),
    campaignName: cleanText(input.campaignName ?? input.campanha),
    caracteristica: cleanText(input.caracteristica ?? input.q),
    presenca: parsePresence(input.presenca),
    status: statusInput === "todos" ? undefined : parseStatus(input.status) ?? "aguardando",
    unassignedOnly: parseBoolean(input.unassignedOnly, true),
    produto: parseProduto(input.produto),
  };
}

interface ArrivalPage {
  items: InscricaoItem[];
  total: number;
  limit: number;
  startsAt: string;
}

/**
 * A pagina de leads que alimenta as DUAS filas da Chegada. As duas listas
 * (geral e Aula Exclusiva) partem exatamente da mesma consulta: separa-las aqui
 * evita que uma delas mude de criterio sozinha e passe a discordar da outra —
 * e permite contar as duas com uma consulta so.
 */
async function loadArrivalPage(
  filters: ManualDistributionFilters,
  limit: number
): Promise<ArrivalPage> {
  const safePageSize = safeLimit(limit);
  const [result, startsAt] = await Promise.all([
    listInscricoes({
      page: 1,
      pageSize: safePageSize,
      orderBy: "criado_em",
      orderDirection: "desc",
      filters: {
        caracteristica: filters.caracteristica,
        treinamento: filters.treinamento,
        campaignSource: filters.campaignSource,
        campaignName: filters.campaignName,
        presenca: filters.presenca,
        status: filters.status,
        unassignedOnly: filters.unassignedOnly,
        produto: filters.produto,
      },
    }),
    getExclusiveClassArrivalStartAt(),
  ]);

  return { items: result.data, total: result.total, limit: safePageSize, startsAt };
}

/**
 * Em qual fila cada lead da pagina cai. Um lead de Aula Exclusiva recebido
 * depois do marco vai para a fila dedicada; o resto so entra na chegada geral
 * se for lead de captacao (ver isArrivalLead e a cartilha).
 */
function splitArrivalQueues(
  page: ArrivalPage
): { general: ManualDistributionCandidate[]; exclusiveClass: ManualDistributionCandidate[] } {
  const general: ManualDistributionCandidate[] = [];
  const exclusiveClass: ManualDistributionCandidate[] = [];

  for (const item of page.items) {
    if (isTestLead(item)) continue;

    const candidate = candidateFromItem(item);
    if (isOnOrAfter(item, page.startsAt) && isExclusiveClassLead(item)) {
      exclusiveClass.push(candidate);
      continue;
    }

    if (isArrivalLead(item, candidate)) general.push(candidate);
  }

  return { general, exclusiveClass };
}

export async function listManualDistributionCandidates(
  filters: ManualDistributionFilters,
  limit = DEFAULT_LIMIT
): Promise<ManualDistributionCandidateResult> {
  const page = await loadArrivalPage(filters, limit);
  const { general } = splitArrivalQueues(page);

  return {
    candidates: general,
    total: Math.max(0, page.total - (page.items.length - general.length)),
    limit: page.limit,
  };
}

/**
 * Quantos leads estao esperando distribuicao agora, por fila. E o numero que a
 * tela mostra nas abas ("Chegada geral" / "Aula Exclusiva"), usado no menu
 * lateral para acender o aviso no item Chegada de Leads.
 *
 * Contar e a mesma consulta de listar: nao existe COUNT barato equivalente,
 * porque "isto e lead de chegada?" depende de regras de payload (canal, origem
 * efetiva, formulario de produto) que so rodam em JS. Como o numero e igual
 * para todo gestor e a tela nao muda de segundo em segundo, o resultado fica
 * em cache curto — assim varios gestores com a aba aberta nao multiplicam a
 * consulta no banco. O cache vive no processo, e o servidor roda com
 * DASHBOARD_WEB_CONCURRENCY workers: na pratica sao ate N consultas por
 * janela, nao uma, e o aviso pode demorar um ciclo a mais para apagar no
 * worker que nao distribuiu.
 */
export async function countArrivalQueues(): Promise<ArrivalQueueCounts> {
  const now = Date.now();
  if (arrivalCountsCache && arrivalCountsCache.expiresAt > now) {
    return arrivalCountsCache.value;
  }

  const page = await loadArrivalPage(normalizeManualDistributionFilters({}), DEFAULT_LIMIT);
  const { general, exclusiveClass } = splitArrivalQueues(page);
  const value: ArrivalQueueCounts = {
    general: general.length,
    exclusiveClass: exclusiveClass.length,
    total: general.length + exclusiveClass.length,
  };

  arrivalCountsCache = { value, expiresAt: now + ARRIVAL_COUNTS_TTL_MS };
  return value;
}

/**
 * Nova fila de Chegada dedicada à Aula Exclusiva/Experimental. O marco é
 * persistido na primeira ativação; por isso nenhuma aula recebida antes dele
 * aparece aqui, mesmo que seja reenviada ou fique sem responsável.
 */
export async function listExclusiveClassArrivalCandidates(
  filters: ManualDistributionFilters,
  limit = DEFAULT_LIMIT
): Promise<ExclusiveClassArrivalCandidateResult> {
  const page = await loadArrivalPage(filters, limit);
  const { exclusiveClass } = splitArrivalQueues(page);

  return {
    candidates: exclusiveClass,
    total: Math.max(0, page.total - (page.items.length - exclusiveClass.length)),
    limit: page.limit,
    startsAt: page.startsAt,
  };
}

function validateSellerMap(sellers: CommercialSeller[], sellerIds: number[]): Map<number, CommercialSeller> {
  if (sellerIds.length === 0) {
    throw new Error("Selecione pelo menos um usuario para receber os leads.");
  }

  const sellerMap = new Map(sellers.map((seller) => [seller.chatwootUserId, seller]));
  for (const sellerId of sellerIds) {
    if (!sellerMap.has(sellerId)) {
      throw new Error(`Usuario ${sellerId} nao encontrado na equipe.`);
    }
  }

  return sellerMap;
}

async function loadItemsByIds(ids: number[], max = MAX_FILTER_DISTRIBUTION): Promise<InscricaoItem[]> {
  const uniqueIds = Array.from(new Set(ids)).slice(0, max);
  const batches: number[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    batches.push(uniqueIds.slice(index, index + 100));
  }

  const items = (await Promise.all(batches.map((batch) => listInscricoesByIds(batch)))).flat();
  const byId = new Map(items.map((item) => [item.id, item]));
  return uniqueIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export async function listManualDistributionFolderCandidates(
  user: DashboardUser | null | undefined,
  input: ManualDistributionFolderCandidatesInput
): Promise<ManualDistributionCandidateResult> {
  if (!isProductivityManager(user)) {
    throw new Error("Apenas usuarios master podem distribuir leads.");
  }

  const folderKey = cleanText(input.folderKey);
  const block = cleanText(input.block);
  if (!folderKey || !block) {
    throw new Error("Informe a pasta e o bloco de leads.");
  }

  const limit = safeLimit(input.limit, MAX_FILTER_DISTRIBUTION);
  await ensureCommercialSchema();
  const ids = await listVozupLeadIdsByBlock(folderKey, block, {
    limit,
    unassignedOnly: !Boolean(input.overwriteAssigned),
  });
  const items = await loadItemsByIds(ids, limit);
  const candidates = items.filter((item) => !isTestLead(item)).map(candidateFromItem);

  return { candidates, total: candidates.length, limit };
}

async function loadItemsForDistribution(input: ManualDistributionInput): Promise<InscricaoItem[]> {
  if (input.scope === "filters") {
    const filters = input.filters ?? normalizeManualDistributionFilters({});
    const result = await listManualDistributionCandidates(filters, safeLimit(input.limit, MAX_FILTER_DISTRIBUTION));
    const ids = result.candidates.map((candidate) => candidate.id);
    return ids.length > 0 ? loadItemsByIds(ids) : [];
  }

  if (input.scope === "folder_block") {
    const folderKey = cleanText(input.folderKey);
    const block = cleanText(input.block);
    if (!folderKey || !block) {
      throw new Error("Informe a pasta e o bloco de leads para distribuir.");
    }

    await ensureCommercialSchema();
    const ids = await listVozupLeadIdsByBlock(folderKey, block, {
      limit: safeLimit(input.limit, MAX_FILTER_DISTRIBUTION),
      unassignedOnly: !Boolean(input.overwriteAssigned),
    });
    const items = ids.length > 0 ? await loadItemsByIds(ids) : [];
    return items.filter((item) => !isTestLead(item));
  }

  const leadIds = parseIdList(input.leadIds).slice(0, MAX_FILTER_DISTRIBUTION);
  const items = leadIds.length > 0 ? await loadItemsByIds(leadIds) : [];
  return items.filter((item) => !isTestLead(item));
}

export async function distributeManualLeads(
  user: DashboardUser | null | undefined,
  input: ManualDistributionInput
): Promise<ManualDistributionResult> {
  if (!isProductivityManager(user)) {
    throw new Error("Apenas usuarios master podem distribuir leads.");
  }

  const sellerIds = normalizeSellerIds(input.sellerIds);
  const sellers = await listCommercialSellers();
  const sellerMap = validateSellerMap(sellers, sellerIds);
  const items = await loadItemsForDistribution(input);
  const strategy: ManualDistributionStrategy = input.strategy === "round_robin" ? "round_robin" : "single";
  const overwriteAssigned = Boolean(input.overwriteAssigned);
  const sortedItems = [...items].sort(
    (left, right) => new Date(left.criadoEm).getTime() - new Date(right.criadoEm).getTime()
  );
  const assigned: ManualDistributionResult["assigned"] = [];
  const skipped: ManualDistributionResult["skipped"] = [];
  const failed: ManualDistributionResult["failed"] = [];

  for (const item of sortedItems) {
    if (!overwriteAssigned && item.commercial?.assignedSellerId) {
      skipped.push({ inscricaoId: item.id, reason: "Lead ja tem responsavel." });
      continue;
    }

    const sellerId = strategy === "single" ? sellerIds[0] : sellerIds[assigned.length % sellerIds.length];
    const seller = sellerMap.get(sellerId);
    if (!seller) {
      failed.push({ inscricaoId: item.id, reason: "Usuario de destino nao encontrado." });
      continue;
    }

    try {
      const sourcePreview = candidateFromItem(item);
      const result = await assignCommercialLead(user, item.id, seller.chatwootUserId, {
        sourceGroupTitle: sourcePreview.sourceGroupTitle,
        leadPath: sourcePreview.leadPath,
      });
      assigned.push({
        inscricaoId: item.id,
        sellerId: result.seller.chatwootUserId,
        sellerName: result.seller.name,
        sellerEmail: result.seller.email,
      });
    } catch (error) {
      failed.push({
        inscricaoId: item.id,
        reason: error instanceof Error ? error.message : "Falha ao distribuir lead.",
      });
    }
  }

  // A fila acabou de encolher: derruba o cache para o aviso do menu apagar no
  // próximo ciclo, e não até 20s depois.
  if (assigned.length > 0) arrivalCountsCache = null;

  return { assigned, skipped, failed };
}
