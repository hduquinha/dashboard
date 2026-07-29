import type { DashboardUser } from "@/lib/auth";
import { assignCommercialLead, ensureCommercialSchema, listCommercialSellers } from "@/lib/commercial";
import { analyzeInscricaoQuality } from "@/lib/inscricaoQuality";
import { pickFormString } from "@/lib/inscricaoForm";
import { FORM_NAME_KEYS, LANDING_PAGE_KEYS } from "@/lib/leadFields";
import { isProductivityManager } from "@/lib/productivity";
import { listInscricoes, listInscricoesByIds } from "@/lib/db";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { listVozupLeadIdsByBlock } from "@/lib/vozupFolders";
import type { CommercialSeller } from "@/types/commercial";
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
const ARRIVAL_CHANNELS = new Set(["Meta Ads", "Meta Forms", "Google Ads", "Google Forms"]);

// O produto de um lead vem do FORMULARIO onde ele se inscreveu, nunca do canal
// de trafego (ver docs/cartilha-formularios-produtos.md). Um lead da Aula
// Exclusiva que clicou num anuncio do Instagram chega com utm/fbclid e seria
// classificado como "Meta Ads" — mas continua sendo Aula Exclusiva e nao pode
// aparecer na Chegada. Estes termos identificam formularios de produto
// (aulas, workshop, Encontro Online, UP Day) que nunca entram aqui.
const EXCLUDED_PRODUCT_TERMS = [
  "aula exclusiva",
  "aula experimental",
  "workshop",
  "encontro online",
  "up day",
  "up-day",
  "landing-inscricao",
];

function isProductFormLead(item: InscricaoItem): boolean {
  const identity = compactParts([
    payloadText(item, ["origem", "lead_origem", "origem_formulario"]),
    payloadText(item, ["nome_evento"]),
    item.treinamentoNome,
    item.treinamentoId,
  ]).join(" ");
  if (identity && textIncludes(identity, EXCLUDED_PRODUCT_TERMS)) return true;

  // Data ISO em data_treinamento e exclusiva do Encontro Online.
  const dataTreinamento = payloadText(item, ["data_treinamento", "dataTreinamento"]);
  return Boolean(dataTreinamento && /^\d{4}-\d{2}-\d{2}/.test(dataTreinamento));
}

function isArrivalLead(item: InscricaoItem, candidate: ManualDistributionCandidate): boolean {
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

export async function listManualDistributionCandidates(
  filters: ManualDistributionFilters,
  limit = DEFAULT_LIMIT
): Promise<ManualDistributionCandidateResult> {
  const safePageSize = safeLimit(limit);
  const result = await listInscricoes({
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
  });

  const cleanData = result.data.filter((item) => !isTestLead(item));
  const arrivals = cleanData
    .map((item) => ({ item, candidate: candidateFromItem(item) }))
    .filter(({ item, candidate }) => isArrivalLead(item, candidate));

  return {
    candidates: arrivals.map(({ candidate }) => candidate),
    total: Math.max(0, result.total - (result.data.length - arrivals.length)),
    limit: safePageSize,
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

  return { assigned, skipped, failed };
}
